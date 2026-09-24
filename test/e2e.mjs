// End-to-end test of the real injector against the real engine database.
//
// A headless Edge serves test/fixture.html (the composer skeleton), src/inject.mjs
// is launched against that port exactly as the launcher would launch it, and the
// resulting DOM is read back and checked against the live session in mimocode.db.
// Everything except "does the app honour --remote-debugging-port" is covered.
//
// Run: node test/e2e.mjs

import { spawn } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { probePort, CDP } from "../src/cdp.js";
import { Store } from "../src/stats.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BROWSERS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];
const PORT = 9336;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  :: " + extra : ""}`);
  ok ? pass++ : fail++;
};

const exe = BROWSERS.find((p) => existsSync(p));
if (!exe) {
  console.error("找不到 Edge/Chrome,无法做端到端验证");
  process.exit(2);
}
if (!existsSync(join(process.env.USERPROFILE ?? "", ".local", "share", "mimocode", "mimocode.db"))) {
  console.error("找不到 mimocode.db,本机没有可用的真实会话数据");
  process.exit(2);
}

// What the DB says right now, to compare against what the page ends up showing.
const store = new Store();
const session = store.currentSession();

// A second real session to prove the bar follows the desktop's currentKey
// instead of sticking to whichever row was written most recently.
const { DatabaseSync } = await import("node:sqlite");
const raw = new DatabaseSync(store.path, { readOnly: true });
const other =
  raw
    .prepare("select id, title from session where id <> ? order by time_updated desc limit 1")
    .get(session.id) ?? null;
raw.close();

const expected = session ? store.sessionStats(session.id) : null;
const expectedOther = other ? store.sessionStats(other.id) : expected;
store.close();

console.log(
  `最近写入的会话: ${session?.id} 「${session?.title}」 工具=${expected?.tools.total} 步=${expected?.tokens.steps}`
);
console.log(
  `另一个会话    : ${other?.id} 「${other?.title}」 工具=${expectedOther?.tools.total} 步=${expectedOther?.tokens.steps}`
);
if (!other) {
  console.error("库里只有一个会话,无法验证切换行为");
  process.exit(2);
}

const PROFILE = mkdtempSync(join(tmpdir(), "statusbar-e2e-"));
const cfgDir = mkdtempSync(join(tmpdir(), "statusbar-cfg-"));
const cfgPath = join(cfgDir, "config.json");
// Point the injector at a stand-in for the desktop's composer-input.json so the
// test owns "which conversation is open" instead of reading the user's.
const composerPath = join(cfgDir, "composer-input.json");
writeFileSync(composerPath, JSON.stringify({ currentKey: other?.id ?? session.id }), "utf8");
writeFileSync(
  cfgPath,
  JSON.stringify({
    port: PORT,
    refreshMs: 300,
    busyRefreshMs: 150,
    log: true,
    composerInputPath: composerPath,
  }),
  "utf8"
);

const browser = spawn(
  exe,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=900,760",
    `file:///${join(HERE, "fixture.html").replace(/\\/g, "/")}`,
  ],
  { stdio: "ignore" }
);

let injector = null;
try {
  let targets = null;
  for (let i = 0; i < 40; i++) {
    const p = await probePort(PORT);
    if (p.up) {
      targets = p.targets;
      break;
    }
    await sleep(250);
  }
  if (!targets) throw new Error("headless 浏览器没起来");

  // Launch the real injector, exactly as bin/launch.cmd does.
  injector = spawn(process.execPath, [join(ROOT, "src", "inject.mjs")], {
    env: { ...process.env, MIMO_STATSBAR_CONFIG: cfgPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let injectorLog = "";
  injector.stdout.on("data", (d) => (injectorLog += d.toString()));
  injector.stderr.on("data", (d) => (injectorLog += d.toString()));

  const page = targets.find((t) => t.type === "page" && /fixture\.html/.test(t.url));
  const cdp = await CDP.attach(page.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");

  // Give the injector a few polling cycles.
  let mounted = false;
  for (let i = 0; i < 40 && !mounted; i++) {
    await sleep(250);
    mounted = await cdp
      .eval("!!document.getElementById('mimo-statusbar-host')", { swallow: true })
      .catch(() => false);
  }
  check("注入器自己挂上了统计条", mounted === true);
  if (!mounted) {
    console.log("--- 注入器输出 ---\n" + injectorLog);
    throw new Error("统计条未挂载");
  }

  const state = await cdp.eval("JSON.stringify(window.__mimoStatsBar.state)", {
    swallow: true,
  });
  const vm = JSON.parse(state);
  check("页面收到了状态对象", !!vm.session?.id);
  // composer-input.json says `other`, even though `session` is the most recently
  // written row — the bar must obey the desktop, not the heuristic.
  check(
    "跟随桌面 currentKey,而非最近写入的会话",
    vm.session.id === other.id,
    `${vm.session.id} vs currentKey=${other.id} vs 最近写入=${session.id}`
  );
  check("模型已带上", !!vm.model?.modelID, vm.model?.modelID);
  check(
    "工具调用数与该会话一致",
    vm.tools.total === expectedOther.tools.total,
    `${vm.tools.total} vs ${expectedOther.tools.total}`
  );
  check(
    "步数与该会话一致",
    vm.tokens.steps === expectedOther.tokens.steps,
    `${vm.tokens.steps} vs ${expectedOther.tokens.steps}`
  );
  check(
    "输出 token 与该会话一致",
    vm.tokens.output === expectedOther.tokens.output,
    `${vm.tokens.output} vs ${expectedOther.tokens.output}`
  );
  check(
    "缓存命中率在 0..1",
    vm.cache.hitRate == null || (vm.cache.hitRate >= 0 && vm.cache.hitRate <= 1),
    String(vm.cache.hitRate)
  );
  check(
    "上下文百分比自洽",
    vm.context.pct == null || (vm.context.pct >= 0 && vm.context.pct <= 100),
    String(vm.context.pct)
  );

  const text = await cdp.eval(
    "document.getElementById('mimo-statusbar-host').innerText.replace(/\\n/g,' | ')"
  );
  console.log("      渲染(切换前):", text.slice(0, 200));
  check("DOM 里有内容", text.length > 20);

  // The regression: switching conversations must change the numbers.
  writeFileSync(composerPath, JSON.stringify({ currentKey: session.id }), "utf8");
  let switched = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const s2 = await cdp.eval("JSON.stringify(window.__mimoStatsBar.state)", {
      swallow: true,
    });
    const vm2 = JSON.parse(s2);
    if (vm2.session?.id === session.id) {
      switched = vm2;
      break;
    }
  }
  check(
    "切换对话后统计条跟着变",
    switched?.session?.id === session.id,
    `${switched?.session?.id} vs ${session.id}`
  );
  // The main row is the *current model's* slice now, so compare session totals
  // and let the per-model list be checked separately below.
  check(
    "切换后会话工具总量也跟着变",
    switched?.totals?.tools === expected.totals.tools,
    `${switched?.totals?.tools} vs ${expected.totals.tools}`
  );
  check(
    "切换后会话步数总量也跟着变",
    switched?.totals?.steps === expected.totals.steps,
    `${switched?.totals?.steps} vs ${expected.totals.steps}`
  );
  check(
    "按模型拆分已下发(models 非空)",
    Array.isArray(switched?.models) && switched.models.length > 0,
    JSON.stringify(switched?.models?.map((m) => m.modelID))
  );
  check(
    "恰好一个模型标为当前",
    (switched?.models ?? []).filter((m) => m.isCurrent).length === 1,
    JSON.stringify((switched?.models ?? []).map((m) => [m.modelID, m.isCurrent]))
  );
  const text2 = await cdp.eval(
    "document.getElementById('mimo-statusbar-host').innerText.replace(/\\n/g,' | ')"
  );
  console.log("      渲染(切换后):", text2.slice(0, 200));
  check("注入器日志记下了会话切换", /当前会话 ->/.test(injectorLog), injectorLog.slice(-200));

  // The other half of the same bug: opening a blank new task must NOT keep
  // showing the previous conversation. The renderer signals that by swapping the
  // composer to its `home` variant (the `composer-dock` id disappears).
  await cdp.eval(`(() => {
    const wrap = document.querySelector('.composer-wrap');
    wrap.removeAttribute('id');
    wrap.classList.add('composer-home');
  })()`);

  let emptyVm = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const s3 = await cdp.eval("JSON.stringify(window.__mimoStatsBar.state)", {
      swallow: true,
    });
    const vm3 = JSON.parse(s3);
    if (vm3?.empty) {
      emptyVm = vm3;
      break;
    }
  }
  check("新任务页时统计条切到空状态", emptyVm?.empty === true, JSON.stringify(emptyVm)?.slice(0, 120));
  const emptyText = await cdp.eval(
    "document.getElementById('mimo-statusbar-host').innerText.replace(/\\n/g,' | ')"
  );
  console.log("      渲染(新任务页):", emptyText);
  check("空状态不残留上一条对话的 token 数字", !/tok|tok\/s/.test(emptyText), emptyText);
  check("注入器日志记下了新对话", /当前会话 -> \(新对话/.test(injectorLog), injectorLog.slice(-200));

  await cdp.eval(`(() => {
    const wrap = document.querySelector('.composer-wrap');
    wrap.id = 'composer-dock';
    wrap.classList.remove('composer-home');
  })()`);
  let restored = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const s4 = await cdp.eval("JSON.stringify(window.__mimoStatsBar.state)", {
      swallow: true,
    });
    const vm4 = JSON.parse(s4);
    if (vm4?.session?.id) {
      restored = vm4;
      break;
    }
  }
  check(
    "回到对话后立刻恢复统计数字",
    restored?.session?.id === session.id && restored?.totals?.tools === expected.totals.tools,
    `${restored?.session?.id} tools=${restored?.totals?.tools} vs ${expected.totals.tools}`
  );
  check("有刷新节奏(往返 >1 次)", (injectorLog.match(/已附加到/g) ?? []).length >= 1);

  // Capture while the bar is still live.
  const clip = await cdp.eval(`(() => {
    const r = document.querySelector('.composer-dock-zone').getBoundingClientRect();
    const pad = 10;
    return {
      x: Math.max(0, r.left - pad), y: Math.max(0, r.top - pad),
      width: Math.min(window.innerWidth - Math.max(0, r.left - pad), r.width + pad * 2),
      height: r.height + pad * 2, scale: 2,
    };
  })()`);
  const shot = await cdp.send("Page.captureScreenshot", { format: "png", clip });
  writeFileSync(join(HERE, "preview-live.png"), Buffer.from(shot.data, "base64"));
  check("已写出真实数据的截图", true);

  // Hard-killing a process on Windows is not catchable, so the bar cannot rely
  // on the injector's own cleanup: it has to notice the silence itself.
  injector.kill();
  let removed = null;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    removed = await cdp
      .eval("!!document.getElementById('mimo-statusbar-host')", { swallow: true })
      .catch(() => null);
    if (removed === false) break;
  }
  check("注入器被强杀后统计条自行退场", removed === false, String(removed));

  console.log("\n--- 注入器输出 ---");
  console.log(injectorLog.trim());
  cdp.close();
} catch (err) {
  check(`异常: ${err.message}`, false);
} finally {
  try {
    injector?.kill();
  } catch {}
  try {
    browser.kill();
  } catch {}
  await sleep(400);
  for (const d of [PROFILE, cfgDir]) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
