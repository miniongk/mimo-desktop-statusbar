// Verify a running instance: does the bar show the conversation the desktop
// currently has open, with numbers that match the engine DB?
//
// Polls briefly, because a switch can land between the desktop writing
// currentKey and the injector's next tick — a single snapshot can miss it.
//
// Run: node test/inspect-live.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { probePort, CDP } from "../src/cdp.js";
import { Store } from "../src/stats.js";

const port = Number(process.env.MIMO_STATSBAR_PORT || 9222);
const ciPath = join(process.env.APPDATA, "Xiaomi MiMo", "composer-input.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readKey = () => {
  try {
    return JSON.parse(readFileSync(ciPath, "utf8")).currentKey;
  } catch {
    return null;
  }
};

const probe = await probePort(port);
if (!probe.up) {
  console.error(`端口 ${port} 没开 —— 统计条没在跑,或应用不是用启动器起的`);
  process.exit(1);
}
const page = probe.targets.find((t) => t.type === "page" && /^app:/.test(t.url));
if (!page) {
  console.error("没有 app:// 页面");
  process.exit(1);
}

const cdp = await CDP.attach(page.webSocketDebuggerUrl);
await cdp.send("Runtime.enable");

let vm = null;
let key = readKey();
let agreed = false;
for (let i = 0; i < 20; i++) {
  key = readKey();
  const raw = await cdp.eval(
    `window.__mimoStatsBar && window.__mimoStatsBar.state
       ? JSON.stringify(window.__mimoStatsBar.state) : null`,
    { swallow: true }
  );
  vm = raw ? JSON.parse(raw) : null;
  if (vm?.session?.id && key && vm.session.id === key) {
    agreed = true;
    break;
  }
  await sleep(300);
}

const text = await cdp.eval(
  `(document.getElementById('mimo-statusbar-host')||{}).innerText || null`,
  { swallow: true }
);
cdp.close();

const store = new Store();
const stats = key ? store.sessionStats(key) : null;
store.close();

console.log("桌面 currentKey :", key);
console.log("统计条 session  :", vm?.session?.id ?? "(未挂载)");
console.log("统计条标题      :", vm?.session?.title ?? "-");
console.log("统计条渲染      :", (text || "(无)").replace(/\n/g, " | "));
console.log("DB 该会话       :", {
  id: stats?.session?.id,
  title: stats?.session?.title,
  tools: stats?.tools?.total,
  steps: stats?.tokens?.steps,
  model: stats?.model?.modelID,
});

const follow = agreed;
// The bar's main row is the *current model's* slice; session truth lives in
// totals, and models[] carries the per-model breakdown.
const numbersMatch =
  vm != null &&
  stats != null &&
  vm.totals?.tools === stats.tools?.total &&
  vm.totals?.steps === stats.tokens?.steps &&
  Array.isArray(vm.models) &&
  vm.models.length > 0 &&
  vm.models.filter((m) => m.isCurrent).length === 1;

console.log("\n跟随 currentKey :", follow ? "YES" : "NO");
console.log("会话总量一致    :", numbersMatch ? "YES" : "NO");
if (vm && vm.models) {
  console.log("当前模型        :", (vm.models.find((m) => m.isCurrent) || {}).modelID);
  console.log("模型行数        :", vm.models.length);
}
if (!follow) {
  console.log("提示:若你刚切换过对话,等 1-2 秒再跑一次;仍不一致说明注入器没在轮询。");
}
process.exit(follow && numbersMatch ? 0 : 1);
