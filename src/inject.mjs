// Attaches to the running MiMo Desktop renderer over the Chrome DevTools
// Protocol and keeps a session-stats bar mounted under the composer.
//
// The app must have been started with --remote-debugging-port=<port>; bin/launch.cmd
// does that. Nothing in the app's install directory is touched.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { probePort, CDP } from "./cdp.js";
import { Store } from "./stats.js";
import { resolveSession, defaultComposerInputPath } from "./resolve.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// Must match the VERSION constant in src/page/bar.js: a lower one on the page
// means an older bar is installed and needs replacing.
const BAR_VERSION = 2;

const DEFAULTS = {
  port: 9222,
  refreshMs: 1000,
  busyRefreshMs: 250,
  contextWindowOverride: null,
  pinnedSessionId: null,
  // null = the desktop's real composer-input.json under %APPDATA%
  composerInputPath: null,
  showExpanded: false,
  log: true,
};

function loadConfig() {
  const file = process.env.MIMO_STATSBAR_CONFIG || join(ROOT, "config.json");
  if (!existsSync(file)) return { ...DEFAULTS };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return { ...DEFAULTS, ...parsed };
  } catch (err) {
    console.error(`[statusbar] config.json 解析失败,用默认值: ${err.message}`);
    return { ...DEFAULTS };
  }
}

const log = (cfg, ...a) => cfg.log && console.log("[statusbar]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pick the main app window rather than devtools, extension or popup pages.
// Several candidates can look like pages, so preference is by URL shape and the
// rest are tried in turn if injection fails.
function rankTargets(targets) {
  return targets
    .filter((t) => t.type === "page" && t.webSocketDebuggerUrl)
    .filter((t) => !/^devtools:\/\//.test(t.url))
    .sort((a, b) => score(b) - score(a));
}

function score(t) {
  let s = 0;
  if (/^app:/.test(t.url)) s += 100;
  if (/index\.html/.test(t.url)) s += 20;
  if (/app\.asar/.test(t.url)) s += 20;
  if (t.url === "about:blank") s -= 50;
  if (/extension|devtools|FloatingChat/i.test(t.url)) s -= 40;
  if (t.title && t.title.length) s += 5;
  return s;
}

function pct(used, window) {
  if (used == null || !window) return null;
  return Math.min(100, Math.max(0, (used / window) * 100));
}

// Turn the raw DB read into exactly what the page script renders.
function toViewModel(raw, cfg) {
  const t = raw.tokens ?? {};
  const billedInput = (t.input ?? 0) + (t.cacheRead ?? 0) + (t.cacheWrite ?? 0);
  const cacheable = (t.cacheRead ?? 0) + (t.cacheWrite ?? 0) + (t.input ?? 0);
  const busy =
    (raw.actors?.running ?? 0) > 0 ||
    (raw.timing?.lastAt != null && Date.now() - raw.timing.lastAt < 4000);

  return {
    at: raw.at,
    busy,
    session: { id: raw.session?.id, title: raw.session?.title },
    model: raw.model,
    tokens: {
      input: billedInput,
      output: t.output ?? 0,
      reasoning: t.reasoning ?? 0,
      cacheRead: t.cacheRead ?? 0,
      cacheWrite: t.cacheWrite ?? 0,
      steps: t.steps ?? 0,
    },
    cache: { hitRate: cacheable > 0 ? (t.cacheRead ?? 0) / cacheable : null },
    context: {
      used: raw.context?.used ?? null,
      window: raw.context?.window ?? null,
      pct: pct(raw.context?.used, raw.context?.window),
    },
    cost: { total: raw.cost?.total ?? 0 },
    speed: { tps: raw.timing?.outputTps ?? null },
    timing: { spanMs: raw.timing?.spanMs ?? 0, genMs: raw.timing?.genMs ?? 0 },
    tools: raw.tools,
    actors: raw.actors,
    tasks: raw.tasks,
    messages: raw.messages,
  };
}

async function assertRuntime() {
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 5)) {
    throw new Error(
      `需要 Node >= 22.5(当前 ${process.versions.node}):内置的 node:sqlite 与 WebSocket 是零依赖的前提`
    );
  }
  try {
    await import("node:sqlite");
  } catch {
    throw new Error("当前 Node 缺少 node:sqlite,请升级 Node 到 22.5 以上");
  }
  if (typeof globalThis.WebSocket !== "function") {
    throw new Error("当前 Node 没有内置 WebSocket,请升级 Node 到 22 以上");
  }
}

async function main() {
  await assertRuntime();
  const cfg = loadConfig();
  const barSource = readFileSync(join(HERE, "page", "bar.js"), "utf8");
  const store = new Store();
  log(cfg, `db=${store.path} port=${cfg.port}`);

  let cdp = null;
  let attachedUrl = null;
  let lastRaw = null;
  let lastSessionId = null;
  let injectedVersion = null;
  let waitingSince = null;
  let lastWaitLog = 0;

  async function connect() {
    const probe = await probePort(cfg.port);
    if (!probe.up) {
      const now = Date.now();
      if (waitingSince == null) waitingSince = now;
      // Keep saying so: a silent wait looks identical to a broken plugin.
      if (now - lastWaitLog > 15000) {
        lastWaitLog = now;
        const secs = Math.round((now - waitingSince) / 1000);
        console.error(
          `[statusbar] 端口 ${cfg.port} 上还没有调试接口(已等 ${secs}s)。` +
            `应用必须用 bin\\launch.cmd 启动,且启动前旧进程要完全退出。`
        );
      }
      return false;
    }
    waitingSince = null;

    const candidates = rankTargets(probe.targets ?? []);
    if (!candidates.length) return false;

    for (const target of candidates) {
      try {
        const c = await CDP.attach(target.webSocketDebuggerUrl);
        await c.send("Runtime.enable");
        // A window without a composer is not the one we want.
        const hasComposer = await c.eval(
          "!!document.querySelector('.composer-wrap, .composer-dock-zone')"
        );
        if (!hasComposer) {
          c.close();
          continue;
        }
        c.on("close", () => {
          log(cfg, "调试连接断开,准备重连");
          if (cdp === c) {
            cdp = null;
            attachedUrl = null;
          }
        });
        cdp = c;
        attachedUrl = target.url;
        injectedVersion = null;
        log(cfg, `已附加到 ${target.url}`);
        return true;
      } catch (err) {
        log(cfg, `附加失败(${target.url}): ${err.message}`);
      }
    }
    return false;
  }

  async function ensureInjected() {
    if (!cdp) return false;
    const version = await cdp
      .eval("window.__mimoStatsBar ? window.__mimoStatsBar.version : 0", { swallow: true })
      .catch(() => 0);
    if (version >= BAR_VERSION) return true;
    if (version > 0) log(cfg, `页面上的统计条是 v${version},升级到 v${BAR_VERSION}`);
    // The script is an IIFE that replaces any older instance of itself.
    await cdp.eval(`${barSource}`, { swallow: true });
    const ok = await cdp
      .eval(
        `!!(window.__mimoStatsBar && window.__mimoStatsBar.version >= ${BAR_VERSION})`,
        { swallow: true }
      )
      .catch(() => false);
    injectedVersion = BAR_VERSION;
    if (ok) log(cfg, "已注入统计条");
    return !!ok;
  }

  async function tick() {
    if (!cdp) {
      await connect();
      if (!cdp) return false;
    }

    const ok = await ensureInjected().catch(() => false);
    if (!ok) {
      cdp?.close();
      cdp = null;
      return false;
    }

    // Whether a conversation is open comes from the composer variant, not from
    // composer-input.json: that file keeps the previous id when the user goes
    // back to the new-task page, so on its own it would report stale numbers.
    const conversationOpen = await cdp
      .eval("window.__mimoStatsBar.isConversationView()", { swallow: true })
      .catch(() => true);

    const resolved = resolveSession({
      pinnedSessionId: cfg.pinnedSessionId,
      conversationOpen,
      composerInputPath: cfg.composerInputPath ?? defaultComposerInputPath(),
      fallbackSessionId: store.currentSession()?.id ?? null,
    });

    const staleMs = Math.max(3000, cfg.refreshMs * 10);

    if (!resolved.sessionId) {
      // New-task page (or a conversation the engine has not materialised yet):
      // push an explicit empty state instead of leaving the last conversation's
      // numbers frozen on screen.
      if (lastSessionId !== null) {
        log(cfg, `当前会话 -> (新对话:${resolved.source})`);
        lastSessionId = null;
      }
      await cdp.eval(
        `window.__mimoStatsBar.update(${JSON.stringify({
          at: Date.now(),
          empty: true,
          busy: false,
          staleMs,
        })})`,
        { swallow: true }
      );
      return false;
    }

    const sessionId = resolved.sessionId;
    if (sessionId !== lastSessionId) {
      log(
        cfg,
        `当前会话 -> ${sessionId} [${resolved.source}]${lastSessionId ? ` (原 ${lastSessionId})` : ""}`
      );
      lastSessionId = sessionId;
    }

    const raw = store.sessionStats(sessionId, {
      contextOverride: cfg.contextWindowOverride,
    });
    if (!raw) return false;
    lastRaw = raw;

    const vm = toViewModel(raw, cfg);
    // Let the page decide when the feed has gone quiet; ten missed refreshes,
    // floored at 3s so a short test interval still yields a usable margin.
    vm.staleMs = staleMs;
    await cdp.eval(`window.__mimoStatsBar.update(${JSON.stringify(vm)})`, {
      swallow: true,
    });
    return vm.busy;
  }

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  log(cfg, "启动完成,开始轮询(按 Ctrl+C 退出)");
  while (!stopping) {
    let busy = false;
    try {
      busy = await tick();
    } catch (err) {
      log(cfg, `本轮失败: ${err.message}`);
      cdp?.close();
      cdp = null;
    }
    await sleep(busy ? cfg.busyRefreshMs : cfg.refreshMs);
  }

  log(cfg, "退出,清理注入的节点");
  try {
    await cdp?.eval("window.__mimoStatsBar && window.__mimoStatsBar.clear()", {
      swallow: true,
    });
  } catch {}
  cdp?.close();
  store.close();
}

main().catch((err) => {
  console.error("[statusbar] 致命错误:", err);
  process.exit(1);
});
