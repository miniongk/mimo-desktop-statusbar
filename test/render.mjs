// Renders src/page/bar.js inside test/fixture.html (a stand-in for the real
// composer skeleton) with a payload shaped like a live session, asserts the DOM
// it produced, and screenshots both themes for visual review.
//
// Run: node test/render.mjs

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { probePort, CDP } from "../src/cdp.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BROWSERS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];
const PORT = 9334;

const SAMPLE = {
  busy: true,
  session: { id: "ses_ffe5f42c22d92ffeHi1jVTVIO7", title: "制作一个类似dsh的会话统计的插件" },
  model: { providerID: "deepseek", modelID: "deepseek-flash", mode: "build", agent: "build" },
  tokens: {
    input: 11290435,
    output: 59365,
    reasoning: 37932,
    cacheRead: 10645632,
    cacheWrite: 0,
    steps: 103,
  },
  cache: { hitRate: 0.943 },
  context: { used: 140861, window: 1000000, pct: 14.1 },
  cost: { total: 0.187185546 },
  speed: { tps: 41.6 },
  timing: { spanMs: 1287000, genMs: 1427000 },
  tools: {
    total: 184,
    byName: [
      { tool: "bash", n: 120 },
      { tool: "webfetch", n: 20 },
      { tool: "write", n: 16 },
      { tool: "read", n: 11 },
    ],
  },
  actors: {
    total: 2,
    running: 2,
    list: [
      { id: "explore-1", agent: "explore", status: "running", turns: 39 },
      { id: "explore-2", agent: "explore", status: "running", turns: 31 },
    ],
  },
  tasks: {
    total: 5,
    done: 2,
    inProgress: 2,
    open: 1,
    blocked: 0,
    list: [
      { id: "T3", status: "in_progress" },
      { id: "T4", status: "in_progress" },
      { id: "T5", status: "open" },
    ],
  },
  messages: { total: 111, compacted: 1 },
};

const HOT = JSON.parse(JSON.stringify(SAMPLE));
HOT.busy = false;
HOT.context = { used: 952000, window: 1000000, pct: 95.2 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  :: " + extra : ""}`);
  ok ? pass++ : fail++;
};

const exe = BROWSERS.find((p) => existsSync(p));
if (!exe) {
  console.error("找不到 Edge/Chrome,无法做渲染验证");
  process.exit(2);
}

const PROFILE = mkdtempSync(join(tmpdir(), "statusbar-render-"));
const child = spawn(
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

const barSource = readFileSync(join(HERE, "..", "src", "page", "bar.js"), "utf8");

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
  const page = targets.find((t) => t.type === "page" && /fixture\.html/.test(t.url));
  if (!page) throw new Error("找不到 fixture 页面");

  const cdp = await CDP.attach(page.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");

  await cdp.eval(barSource);
  check("bar.js 注入后暴露 API", await cdp.eval("!!window.__mimoStatsBar"));

  const mounted = await cdp.eval(
    "window.__mimoStatsBar.update(" + JSON.stringify(SAMPLE) + ")"
  );
  check("update() 成功挂载", mounted === true);

  const place = await cdp.eval(`(() => {
    const host = document.getElementById('mimo-statusbar-host');
    if (!host) return null;
    return {
      parent: host.parentElement.className,
      next: host.nextElementSibling ? host.nextElementSibling.className : null,
      prev: host.previousElementSibling ? host.previousElementSibling.className : null,
    };
  })()`);
  check(
    "插在 composer 卡片与 ai-disclaimer 之间",
    place?.parent === "composer-wrap" && /composer-ai-disclaimer/.test(place?.next ?? ""),
    JSON.stringify(place)
  );

  const text = await cdp.eval(
    "document.getElementById('mimo-statusbar-host').innerText.replace(/\\n/g,' | ')"
  );
  console.log("      渲染结果:", text);
  check("显示上下文占用", /14%/.test(text) && /141k\/1M/.test(text));
  check("显示 token 用量", /11\.29M/.test(text) && /59k/.test(text));
  check("显示缓存命中率", /94%/.test(text));
  check("显示费用", text.includes("$0.187"));
  check("显示生成速度", /42 tok\/s/.test(text));
  check("显示工具调用数与子代理", text.includes("184") && text.includes("2/2"));
  check("显示任务进度", text.includes("2/5"));
  check("显示模型与模式", /deepseek\/deepseek-flash/.test(text) && /build/.test(text));

  await cdp.eval("window.__mimoStatsBar.update(" + JSON.stringify(HOT) + ")");
  const ctxAttr = await cdp.eval("document.getElementById('mimo-statusbar-host').dataset.ctx");
  check("上下文 95% 时切到告警态", ctxAttr === "hot", ctxAttr);

  await cdp.eval("window.__mimoStatsBar.toggleExpanded()");
  const expandedVisible = await cdp.eval(
    "getComputedStyle(document.querySelector('#mimo-statusbar-host .msb-panel')).display"
  );
  check("展开面板可见", expandedVisible === "block", expandedVisible);
  const panelText = await cdp.eval(
    "document.querySelector('#mimo-statusbar-host .msb-panel').innerText.replace(/\\n/g,' | ')"
  );
  console.log("      明细面板:", panelText);
  check("明细含工具分布", panelText.includes("bash"));
  check("明细含子代理状态", panelText.includes("explore-1") && panelText.includes("running"));
  check("明细含任务清单", panelText.includes("T3") && panelText.includes("in_progress"));

  // The composer subtree is rebuilt on route/session switches; the bar must come
  // back on the next tick instead of vanishing.
  await cdp.eval(`(() => {
    const zone = document.querySelector('.composer-dock-zone');
    const clone = zone.cloneNode(true);
    clone.querySelectorAll('#mimo-statusbar-host').forEach(n => n.remove());
    zone.replaceWith(clone);
    return !!document.getElementById('mimo-statusbar-host');
  })()`);
  check(
    "composer 重建后节点消失(符合预期)",
    (await cdp.eval("!!document.getElementById('mimo-statusbar-host')")) === false
  );
  await cdp.eval("window.__mimoStatsBar.update(" + JSON.stringify(SAMPLE) + ")");
  const restored = await cdp.eval(`(() => {
    const host = document.getElementById('mimo-statusbar-host');
    const next = host && host.nextElementSibling;
    return !!(host && next && next.className.includes('composer-ai-disclaimer'));
  })()`);
  check("下一次 tick 自动重挂到正确位置", restored === true);

  const styles = await cdp.eval(`(() => ({
    styleTags: document.querySelectorAll('#mimo-statusbar-style').length,
    opacity: getComputedStyle(document.getElementById('mimo-statusbar-host')).opacity,
  }))()`);
  check("样式只注入一次", styles.styleTags === 1, JSON.stringify(styles));

  check(
    "统计条实际占据布局空间",
    (await cdp.eval(
      "document.getElementById('mimo-statusbar-host').getBoundingClientRect().height"
    )) > 10
  );

  // ---- new-task page handling -------------------------------------------
  check(
    "版本号已暴露(供注入器判断是否需要升级)",
    (await cdp.eval("window.__mimoStatsBar.version")) === 2
  );
  check(
    "挂载在对话里的 composer 上时判定为对话视图",
    (await cdp.eval("window.__mimoStatsBar.isConversationView()")) === true
  );

  await cdp.eval("window.__mimoStatsBar.update(" + JSON.stringify({ empty: true }) + ")");
  const emptyText = await cdp.eval(
    "document.getElementById('mimo-statusbar-host').innerText.replace(/\\n/g,' | ')"
  );
  console.log("      空状态渲染:", emptyText);
  check("空状态提示是新对话", emptyText.includes("新对话"));
  check("空状态不再残留上一条对话的数字", !/184|tok/.test(emptyText), emptyText);

  // The renderer swaps the composer to the `home` variant on the new-task page:
  // the dock id disappears and `composer-home` appears in its place.
  const asHome = await cdp.eval(`(() => {
    const wrap = document.querySelector('.composer-wrap');
    wrap.removeAttribute('id');
    wrap.classList.add('composer-home');
    return window.__mimoStatsBar.isConversationView();
  })()`);
  check("切到新任务页的 composer 变体后判定为非对话视图", asHome === false);

  const backToDock = await cdp.eval(`(() => {
    const wrap = document.querySelector('.composer-wrap');
    wrap.id = 'composer-dock';
    wrap.classList.remove('composer-home');
    return window.__mimoStatsBar.isConversationView();
  })()`);
  check("切回对话后判定恢复", backToDock === true);

  const inertCheck = await cdp.eval(`(() => {
    const zone = document.querySelector('.composer-dock-zone');
    zone.setAttribute('inert', '');
    const r = window.__mimoStatsBar.isConversationView();
    zone.removeAttribute('inert');
    return r;
  })()`);
  check("dock 被置为 inert 时也不算对话视图", inertCheck === false);

  // Clean capture: collapse, then rebuild the zone honestly and re-render.
  await cdp.eval("window.__mimoStatsBar.toggleExpanded()");
  await cdp.eval(`(() => {
    const z = document.querySelector('.composer-dock-zone');
    const c = z.cloneNode(true);
    c.querySelectorAll('#mimo-statusbar-host').forEach(n => n.remove());
    z.replaceWith(c);
  })()`);
  await cdp.eval("window.__mimoStatsBar.update(" + JSON.stringify(SAMPLE) + ")");
  await sleep(500);

  const clip = await cdp.eval(`(() => {
    const r = document.querySelector('.composer-dock-zone').getBoundingClientRect();
    const pad = 10;
    return {
      x: Math.max(0, r.left - pad),
      y: Math.max(0, r.top - pad),
      width: Math.min(window.innerWidth - Math.max(0, r.left - pad), r.width + pad * 2),
      height: r.height + pad * 2,
      scale: 2,
    };
  })()`);

  const light = await cdp.send("Page.captureScreenshot", { format: "png", clip });
  writeFileSync(join(HERE, "preview-light.png"), Buffer.from(light.data, "base64"));

  await cdp.eval("document.documentElement.dataset.theme='dark'");
  await sleep(500);
  const dark = await cdp.send("Page.captureScreenshot", { format: "png", clip });
  writeFileSync(join(HERE, "preview-darktheme.png"), Buffer.from(dark.data, "base64"));

  // Expanded, for reviewing the detail panel.
  await cdp.eval("window.__mimoStatsBar.toggleExpanded()");
  await sleep(500);
  const expClip = await cdp.eval(`(() => {
    const r = document.querySelector('.composer-dock-zone').getBoundingClientRect();
    const pad = 10;
    return {
      x: Math.max(0, r.left - pad),
      y: Math.max(0, r.top - pad),
      width: Math.min(window.innerWidth - Math.max(0, r.left - pad), r.width + pad * 2),
      height: r.height + pad * 2,
      scale: 2,
    };
  })()`);
  const expandedShot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    clip: expClip,
  });
  writeFileSync(
    join(HERE, "preview-expanded.png"),
    Buffer.from(expandedShot.data, "base64")
  );

  check("三张预览图已写出", true);
  cdp.close();
} catch (err) {
  check(`异常: ${err.message}`, false);
} finally {
  try {
    child.kill();
  } catch {}
  await sleep(400);
  try {
    rmSync(PROFILE, { recursive: true, force: true });
  } catch {}
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
