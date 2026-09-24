// Data-layer test for src/stats.js against a purpose-built SQLite fixture.
// Independent of the live session DB so it can assert exact numbers.
//
// Run: node test/stats.mjs

import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/stats.js";

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  :: " + extra : ""}`);
  ok ? pass++ : fail++;
};
const eq = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);

const dir = mkdtempSync(join(tmpdir(), "statusbar-stats-"));
const dbPath = join(dir, "fixture.db");

const db = new DatabaseSync(dbPath);
db.exec(`
  create table session (
    id text primary key, project_id text, parent_id text, slug text, directory text,
    title text, time_created integer, time_updated integer, context_watermark integer
  );
  create table message (
    id text primary key, session_id text, agent_id text,
    time_created integer, time_updated integer, data text
  );
  create table part (
    id text primary key, message_id text, session_id text, time_created integer, data text
  );
  create table task (
    id text primary key, session_id text, summary text, status text,
    time_created integer, parent_id text
  );
  create table actor_registry (
    session_id text, actor_id text, mode text, status text, agent text,
    turn_count integer, description text, background integer, time_created integer
  );
`);

const T0 = 1_700_000_000_000;
const insertSession = db.prepare(
  "insert into session (id, project_id, directory, title, time_created, time_updated) values (?,?,?,?,?,?)"
);
const insertMsg = db.prepare(
  "insert into message (id, session_id, agent_id, time_created, time_updated, data) values (?,?,?,?,?,?)"
);
const insertPart = db.prepare(
  "insert into part (id, message_id, session_id, time_created, data) values (?,?,?,?,?)"
);
const insertTask = db.prepare(
  "insert into task (id, session_id, summary, status, time_created) values (?,?,?,?,?)"
);
const insertActor = db.prepare(
  "insert into actor_registry (session_id, actor_id, mode, status, agent, turn_count, description, background, time_created) values (?,?,?,?,?,?,?,?,?)"
);

// --- session A: a normal, busy conversation
const A = "ses_aaaaaaaaaaaa";
insertSession.run(A, "global", "B:\\work", "正常会话", T0, T0 + 900_000);
for (const [i, spec] of [
  { in: 1000, out: 100, reas: 50, cr: 0, cw: 0, cost: 0.01 },
  { in: 200, out: 400, reas: 80, cr: 8000, cw: 100, cost: 0.002 },
  { in: 150, out: 250, reas: 20, cr: 9000, cw: 0, cost: 0.0015 },
].entries()) {
  const at = T0 + i * 1000;
  insertPart.run(
    `p-a-step-${i}`,
    `m-a-${i}`,
    A,
    at,
    JSON.stringify({
      type: "step-finish",
      reason: "tool-calls",
      tokens: {
        total: spec.in + spec.cr + spec.out,
        input: spec.in,
        output: spec.out,
        reasoning: spec.reas,
        cache: { read: spec.cr, write: spec.cw },
      },
      cost: spec.cost,
    })
  );
}
// newest main-agent message carries the live context size and the model
insertMsg.run(
  "m-a-2",
  A,
  "main",
  T0 + 2000,
  T0 + 2600,
  JSON.stringify({
    role: "assistant",
    mode: "build",
    agent: "build",
    modelID: "deepseek-flash",
    providerID: "deepseek",
    tokens: { total: 9500, output: 250, reasoning: 50 },
    time: { created: T0 + 2000, completed: T0 + 2600 },
  })
);
insertMsg.run(
  "m-a-1",
  A,
  "main",
  T0 + 1000,
  T0 + 1500,
  JSON.stringify({
    role: "assistant",
    modelID: "deepseek-flash",
    providerID: "deepseek",
    tokens: { total: 9000, output: 400, reasoning: 100 },
    time: { created: T0 + 1000, completed: T0 + 1500 },
  })
);
// Interrupted turn: completed stamp + multi-day duration + zero generated
// tokens. Must not drag genMs or tok/s (the live-DB bug that showed 2/s).
insertMsg.run(
  "m-a-zombie",
  A,
  "main",
  T0 + 100,
  T0 + 100 + 42 * 3600_000,
  JSON.stringify({
    role: "assistant",
    modelID: "deepseek-flash",
    providerID: "deepseek",
    tokens: { output: 0, reasoning: 0 },
    time: { created: T0 + 100, completed: T0 + 100 + 42 * 3600_000 },
  })
);
for (const t of ["bash", "bash", "read", "actor"]) {
  insertPart.run(
    `p-a-tool-${t}-${Math.random()}`,
    "m-a-1",
    A,
    T0 + 1200,
    JSON.stringify({ type: "tool", tool: t, state: { status: "completed" } })
  );
}
insertPart.run("p-a-compact", "m-a-1", A, T0 + 1300, JSON.stringify({ type: "compaction", auto: true }));
insertTask.run("T1", A, "第一个任务", "done", T0);
insertTask.run("T2", A, "第二个任务", "in_progress", T0 + 10);
insertActor.run(A, "main", "main", "pending", "main", 3, "main agent", 0, T0);
insertActor.run(A, "explore-1", "subagent", "running", "explore", 7, "侦察", 1, T0 + 20);
insertActor.run(A, "general-1", "subagent", "done", "general", 2, "实现", 0, T0 + 30);

// --- session B: brand new, nothing but a session row
const B = "ses_bbbbbbbbbbbb";
insertSession.run(B, "global", "B:\\work", "空会话", T0 + 100_000, T0 + 950_000);

// --- session D: usage split across several models, including the same model
// name under two providers. Kept separate so session A's numbers stay pinned.
const D = "ses_dddddddddddd";
insertSession.run(D, "global", "B:\\work", "多模型会话", T0 + 300_000, T0 + 310_000);
// Newest message decides the "current" model: deepseek-flash.
insertMsg.run("m-d-2", D, "main", T0 + 302_000, T0 + 302_500, JSON.stringify({
  role: "assistant", modelID: "deepseek-flash", providerID: "deepseek",
  tokens: { total: 9000, output: 400 },
  time: { created: T0 + 302_000, completed: T0 + 302_500 },
}));
insertPart.run("p-d-2", "m-d-2", D, T0 + 302_000, JSON.stringify({
  type: "step-finish", reason: "tool-calls",
  tokens: { total: 9000, input: 400, output: 300, reasoning: 50, cache: { read: 3000, write: 0 } },
  cost: 0.02,
}));
insertPart.run("p-d-tool-2", "m-d-2", D, T0 + 302_100,
  JSON.stringify({ type: "tool", tool: "bash", state: { status: "completed" } }));

// A different model earlier in the session.
insertMsg.run("m-d-1", D, "main", T0 + 301_000, T0 + 301_400, JSON.stringify({
  role: "assistant", modelID: "mimo-v2.6-pro", providerID: "mimo-desktop",
  tokens: { total: 2000, output: 300 },
  time: { created: T0 + 301_000, completed: T0 + 301_400 },
}));
insertPart.run("p-d-1", "m-d-1", D, T0 + 301_000, JSON.stringify({
  type: "step-finish", reason: "tool-calls",
  tokens: { total: 5000, input: 700, output: 300, reasoning: 50, cache: { read: 3000, write: 0 } },
  cost: 0.02,
}));
insertPart.run("p-d-tool-1", "m-d-1", D, T0 + 301_100,
  JSON.stringify({ type: "tool", tool: "bash", state: { status: "completed" } }));

// Same model NAME under a second provider — must not be marked current.
insertMsg.run("m-d-0", D, "main", T0 + 300_500, T0 + 300_600, JSON.stringify({
  role: "assistant", modelID: "mimo-v2.6-pro", providerID: "xiaomi",
  tokens: { total: 100, output: 10 },
  time: { created: T0 + 300_500, completed: T0 + 300_600 },
}));
insertPart.run("p-d-0", "m-d-0", D, T0 + 300_500, JSON.stringify({
  type: "step-finish", reason: "text",
  tokens: { total: 1000, input: 400, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
  cost: 0.004,
}));
const C = "ses_cccccccccccc";
insertSession.run(C, "global", "B:\\work", "只有子代理", T0 + 200_000, T0 + 205_000);
insertMsg.run(
  "m-c-0",
  C,
  "explore-1",
  T0 + 201_000,
  T0 + 201_500,
  JSON.stringify({
    role: "assistant",
    modelID: "mimo-x-flash-preview",
    providerID: "mimo",
    tokens: { total: 1234 },
    time: { created: T0 + 201_000, completed: T0 + 201_500 },
  })
);
db.close();

const store = new Store(dbPath);
let store2 = null;

try {
  const cur = store.currentSession();
  eq("当前会话 = 最近更新的一条", cur.id, B);

  const a = store.sessionStats(A);
  check("会话 A 命中", !!a);
  eq("会话元信息", [a.session.title, a.session.directory], ["正常会话", "B:\\work"]);
  eq("步数", a.tokens.steps, 3);
  eq("输入 token 求和", a.tokens.input, 1350);
  eq("输出 token 求和", a.tokens.output, 750);
  eq("思考 token 求和", a.tokens.reasoning, 150);
  eq("缓存读求和", a.tokens.cacheRead, 17000);
  eq("缓存写求和", a.tokens.cacheWrite, 100);
  eq("总 token = 输入+输出+思考", a.tokens.total, 1350 + 750 + 150);
  check("费用求和", Math.abs(a.cost.total - 0.0135) < 1e-9, String(a.cost.total));

  eq("上下文取最近一条主代理消息", a.context.used, 9500);
  eq("模型取自最近一条主代理消息", [a.model.providerID, a.model.modelID], ["deepseek", "deepseek-flash"]);
  eq("模式", a.model.mode, "build");

  eq("工具调用计数", a.tools.total, 4);
  eq("工具分布首位", a.tools.byName[0], { tool: "bash", n: 2 });
  eq("子代理数量", [a.actors.total, a.actors.running], [2, 1]);
  eq("任务统计", [a.tasks.total, a.tasks.done, a.tasks.inProgress], [2, 1, 1]);
  eq("消息数", a.messages.total, 3);
  eq("压缩次数", a.messages.compacted, 1);
  // 400+100 over 500ms + 250+50 over 600ms; 42h zero-token zombie excluded.
  eq("生成耗时排除零 token 僵尸消息", a.timing.genMs, 500 + 600);
  eq(
    "生成速度 = 近期 (output+reasoning)/时长",
    Math.round(a.timing.outputTps * 1000) / 1000,
    Math.round(((800 / 1100) * 1000) * 1000) / 1000
  );

  const b = store.sessionStats(B);
  eq("空会话: 步数为 0", b.tokens.steps, 0);
  eq("空会话: 无上下文", b.context.used, null);
  eq("空会话: 无模型", b.model.modelID, null);
  eq("空会话: 速度为空", b.timing.outputTps, null);
  eq("空会话: 任务为空", [b.tasks.total, b.tasks.list.length], [0, 0]);

  const c = store.sessionStats(C);
  eq("只有子代理时仍能给出模型", c.model.modelID, "mimo-x-flash-preview");
  eq("只有子代理时也读到上下文用量", c.context.used, 1234);
  eq("只有子代理时模式为空", c.model.mode, null);

  check("查不到的会话返回 null", store.sessionStats("ses_nope") === null);

  // --- per-model attribution (session D) ---------------------------------
  const d = store.sessionStats(D);
  eq("按 provider/model 拆出 3 个模型", d.models.length, 3);
  eq("恰好一个模型标为当前", d.models.filter((m) => m.isCurrent).length, 1);
  const curModel = d.models.find((m) => m.isCurrent);
  eq("当前模型是最近主代理消息用的那个", [curModel.providerID, curModel.modelID], ["deepseek", "deepseek-flash"]);
  eq("当前模型的步数", curModel.steps, 1);
  eq("当前模型的输出 token", curModel.tokens.output, 300);
  eq("当前模型的工具调用", curModel.tools, 1);
  eq("当前模型的费用", curModel.cost, 0.02);

  const other = d.models.find((m) => m.modelID === "mimo-v2.6-pro" && m.providerID === "mimo-desktop");
  eq("另一模型的步数", other.steps, 1);
  eq("另一模型的输入 token", other.tokens.input, 700);
  eq("另一模型的费用", other.cost, 0.02);

  // Same model name under two providers must be two rows, only one current.
  const twins = d.models.filter((m) => m.modelID === "mimo-v2.6-pro");
  eq("同名不同 provider 拆成两行", twins.length, 2);
  eq("同名两行都不得标当前", twins.filter((m) => m.isCurrent).length, 0);

  const shareSum = d.models.reduce((s, m) => s + m.share, 0);
  check("份额之和约为 1", Math.abs(shareSum - 1) < 1e-9, String(shareSum));
  eq("会话总步数 = 各模型之和", d.totals.steps, d.models.reduce((s, m) => s + m.steps, 0));
  eq("会话总工具 = 各模型之和", d.totals.tools, d.models.reduce((s, m) => s + m.tools, 0));
  eq("会话总费用 = 各模型之和", d.totals.cost, d.models.reduce((s, m) => s + m.cost, 0));
  check("份额按大小排在前面的模型费用更高", d.models[0].cost >= d.models[d.models.length - 1].cost);

  // Context window comes from the local model catalog when available; an
  // override must always win.
  const { contextWindowFor } = await import("../src/stats.js");
  const overridden = store.sessionStats(A, { contextOverride: 4096 });
  eq("上下文窗口可被覆盖", overridden.context.window, 4096);
  check("未知模型返回 null 而不是瞎猜", contextWindowFor("nope", "nope", null) === null);

  // Read-only guarantee: the fixture must be untouched by opening it.
  store2 = new Store(dbPath);
  const before = store2.currentSession();
  eq("只读打开可重复读取", before.id, B);
} catch (err) {
  check(`异常: ${err.message}`, false);
} finally {
  store.close();
  store2?.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
