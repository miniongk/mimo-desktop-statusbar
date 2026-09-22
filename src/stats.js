// Session statistics, read straight from the engine's SQLite trajectory DB in
// read-only mode. The engine writes one `step-finish` part per model step and
// carries tokens + cost on the message row, so nothing here has to be estimated
// except the context window (looked up from the local model catalog).

import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_DB = join(
  homedir(),
  ".local",
  "share",
  "mimocode",
  "mimocode.db"
);

const CATALOG_CANDIDATES = [
  join(process.env.APPDATA ?? "", "Xiaomi MiMo", "models-with-claude.json"),
  join(process.env.APPDATA ?? "", "ai.mimo.desktop.dev", "models-with-claude.json"),
];

export function defaultDbPath() {
  return process.env.MIMOCODE_DB || DEFAULT_DB;
}

// ---------------------------------------------------------------- model limits

let catalogCache = null;

function loadCatalog() {
  if (catalogCache) return catalogCache;
  catalogCache = {};
  for (const p of CATALOG_CANDIDATES) {
    if (!p || !existsSync(p)) continue;
    try {
      const parsed = JSON.parse(readFileSync(p, "utf8"));
      // Two shapes are seen: a flat { "provider/model": {...} } map, and a
      // nested { providers: { p: { models: {...} } } } style catalog.
      const merge = (obj, provider) => {
        for (const [key, val] of Object.entries(obj)) {
          if (!val || typeof val !== "object") continue;
          if (val.models && typeof val.models === "object") {
            merge(val.models, key);
            continue;
          }
          if (val.id || val.limit) {
            const full = key.includes("/") ? key : provider ? `${provider}/${key}` : key;
            catalogCache[full] = val;
          }
        }
      };
      merge(parsed, null);
    } catch {
      /* a broken catalog must not take the bar down */
    }
  }
  return catalogCache;
}

// providerID/modelID is the canonical key, but the engine's alias may differ
// from the catalog id (e.g. `deepseek-flash` vs `deepseek/deepseek-v4-flash`),
// so fall back to family/name matching before giving up. A session with no
// model yet is normal (brand new conversation) and must yield null, not throw.
export function contextWindowFor(providerID, modelID, override) {
  if (override != null) return override;
  if (!modelID || typeof modelID !== "string") return null;
  const catalog = loadCatalog();

  const keys = [];
  if (typeof providerID === "string" && providerID) keys.push(`${providerID}/${modelID}`);
  keys.push(modelID);

  for (const key of keys) {
    const hit = catalog[key] ?? catalog[key.toLowerCase()];
    if (hit?.limit?.context) return hit.limit.context;
  }
  for (const val of Object.values(catalog)) {
    if (val?.limit?.context && (val.family === modelID || val.id === modelID)) {
      return val.limit.context;
    }
  }
  return null;
}

// ------------------------------------------------------------------- the store

export class Store {
  #db;
  #path;

  constructor(dbPath = defaultDbPath()) {
    this.#path = dbPath;
    // readOnly keeps us off the engine's write path entirely: no -wal/-shm
    // creation, no lock contention with the running agent.
    this.#db = new DatabaseSync(dbPath, { readOnly: true });
    this.#db.exec("PRAGMA query_only = 1");
  }

  get path() {
    return this.#path;
  }

  close() {
    try {
      this.#db.close();
    } catch {
      /* already closed */
    }
  }

  #all(sql, ...args) {
    try {
      return this.#db.prepare(sql).all(...args);
    } catch (err) {
      // A schema drift or a half-written row must degrade, not crash the bar.
      return [];
    }
  }

  #one(sql, ...args) {
    return this.#all(sql, ...args)[0] ?? null;
  }

  // The conversation the user is looking at is the one most recently written to.
  // parent_id is not filtered on: subagent sessions are their own rows and the
  // main conversation is what we want.
  currentSession() {
    return this.#one(
      `select id, title, directory, project_id, time_created, time_updated
         from session
        order by time_updated desc, time_created desc
        limit 1`
    );
  }

  sessionStats(sessionId, { contextOverride } = {}) {
    const session =
      this.#one(
        `select id, title, directory, project_id, time_created, time_updated
           from session where id = ?`,
        sessionId
      ) ?? null;
    if (!session) return null;

    const steps = this.#one(
      `select
         count(*)                                                    as steps,
         coalesce(sum(json_extract(data,'$.tokens.input')),0)        as input,
         coalesce(sum(json_extract(data,'$.tokens.output')),0)       as output,
         coalesce(sum(json_extract(data,'$.tokens.reasoning')),0)    as reasoning,
         coalesce(sum(json_extract(data,'$.tokens.cache.read')),0)   as cacheRead,
         coalesce(sum(json_extract(data,'$.tokens.cache.write')),0)  as cacheWrite,
         coalesce(sum(json_extract(data,'$.cost')),0)                as cost
       from part
      where session_id = ?
        and json_extract(data,'$.type') = 'step-finish'`,
      sessionId
    );

    // The main agent's newest message is the authoritative view: the model in
    // use, the mode, and (via tokens.total) how big the context has grown.
    // Subagent rows are excluded — they carry their own separate context, and
    // letting one win would mislabel the mode.
    const lastMsg =
      this.#one(
        `select
           json_extract(data,'$.modelID')    as modelID,
           json_extract(data,'$.providerID') as providerID,
           json_extract(data,'$.mode')       as mode,
           json_extract(data,'$.agent')      as agent,
           json_extract(data,'$.tokens.total') as ctxTokens,
           json_extract(data,'$.time.completed') as completedAt,
           time_created
         from message
        where session_id = ?
          and json_extract(data,'$.role') = 'assistant'
          and agent_id = 'main'
          and json_extract(data,'$.tokens.total') is not null
        order by time_created desc
        limit 1`,
        sessionId
      ) ??
      // A session whose only traffic so far came from subagents still deserves a
      // model label rather than blanks.
      this.#one(
        `select
           json_extract(data,'$.modelID')    as modelID,
           json_extract(data,'$.providerID') as providerID,
           json_extract(data,'$.mode')       as mode,
           json_extract(data,'$.agent')      as agent,
           json_extract(data,'$.tokens.total') as ctxTokens,
           json_extract(data,'$.time.completed') as completedAt,
           time_created
         from message
        where session_id = ?
          and json_extract(data,'$.role') = 'assistant'
          and json_extract(data,'$.providerID') is not null
        order by time_created desc
        limit 1`,
        sessionId
      );

    const toolRows = this.#all(
      `select json_extract(data,'$.tool') as tool, count(*) as n
         from part
        where session_id = ?
          and json_extract(data,'$.type') = 'tool'
        group by tool order by n desc`,
      sessionId
    );
    const toolTotal = toolRows.reduce((a, r) => a + (r.n ?? 0), 0);

    const actors = this.#all(
      `select actor_id, agent, status, turn_count, description
         from actor_registry
        where session_id = ? and mode = 'subagent'
        order by time_created`,
      sessionId
    );

    const taskRows = this.#all(
      `select status, count(*) as n from task where session_id = ? group by status`,
      sessionId
    );
    const taskList = this.#all(
      `select id, summary, status from task
        where session_id = ?
        order by case status
                   when 'in_progress' then 0 when 'blocked' then 1
                   when 'open' then 2 else 3 end,
                 time_created
        limit 12`,
      sessionId
    );
    const tasks = {
      total: 0,
      done: 0,
      inProgress: 0,
      open: 0,
      blocked: 0,
      abandoned: 0,
      list: taskList.map((t) => ({ id: t.id, status: t.status, summary: t.summary })),
    };
    for (const r of taskRows) {
      const n = r.n ?? 0;
      tasks.total += n;
      if (r.status === "done") tasks.done += n;
      else if (r.status === "in_progress") tasks.inProgress += n;
      else if (r.status === "open") tasks.open += n;
      else if (r.status === "blocked") tasks.blocked += n;
      else if (r.status === "abandoned") tasks.abandoned += n;
    }

    const msgCount = this.#one(
      `select count(*) as n from message where session_id = ?`,
      sessionId
    );
    const compacted = this.#one(
      `select count(*) as n from part
        where session_id = ? and json_extract(data,'$.type') = 'compaction'`,
      sessionId
    );
    const span = this.#one(
      `select min(time_created) as firstAt, max(time_created) as lastAt
         from part where session_id = ?`,
      sessionId
    );

    // Generation speed: sum the completed-message durations rather than wall
    // clock, so idle time between turns doesn't drag tok/s toward zero.
    const gen = this.#one(
      `select
         coalesce(sum(json_extract(data,'$.time.completed')
                    - json_extract(data,'$.time.created')),0) as ms,
         coalesce(sum(json_extract(data,'$.tokens.output')),0)    as out
       from message
      where session_id = ?
        and json_extract(data,'$.time.completed') is not null`,
      sessionId
    );

    const modelID = lastMsg?.modelID ?? null;
    const providerID = lastMsg?.providerID ?? null;
    const ctxUsed = lastMsg?.ctxTokens ?? null;
    const ctxWindow = contextWindowFor(providerID, modelID, contextOverride);

    const genMs = gen?.ms ?? 0;
    const genOut = gen?.out ?? 0;

    const running = actors.filter((a) => a.status === "running").length;

    return {
      at: Date.now(),
      session: {
        id: session.id,
        title: session.title,
        directory: session.directory,
      },
      model: { providerID, modelID, mode: lastMsg?.mode ?? null, agent: lastMsg?.agent ?? null },
      tokens: {
        input: steps?.input ?? 0,
        output: steps?.output ?? 0,
        reasoning: steps?.reasoning ?? 0,
        cacheRead: steps?.cacheRead ?? 0,
        cacheWrite: steps?.cacheWrite ?? 0,
        total: (steps?.input ?? 0) + (steps?.output ?? 0) + (steps?.reasoning ?? 0),
        steps: steps?.steps ?? 0,
      },
      context: { used: ctxUsed, window: ctxWindow },
      cost: { total: steps?.cost ?? 0, currency: "USD" },
      tools: { total: toolTotal, byName: toolRows.slice(0, 6) },
      actors: {
        total: actors.length,
        running,
        list: actors.map((a) => ({
          id: a.actor_id,
          agent: a.agent,
          status: a.status,
          turns: a.turn_count,
        })),
      },
      tasks,
      messages: { total: msgCount?.n ?? 0, compacted: compacted?.n ?? 0 },
      timing: {
        firstAt: span?.firstAt ?? null,
        lastAt: span?.lastAt ?? null,
        spanMs: span?.firstAt ? (span.lastAt ?? Date.now()) - span.firstAt : 0,
        genMs,
        outputTps: genMs > 0 ? (genOut / genMs) * 1000 : null,
        lastStepAt: lastMsg?.completedAt ?? null,
      },
    };
  }
}
