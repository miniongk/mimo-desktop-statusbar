// One-shot snapshot of the live renderer: which composer variant is mounted,
// whether the stats bar script/host/style are present, and what the bar thinks
// it is showing.
//
// Run: node test/inspect-page.mjs

import { probePort, CDP } from "../src/cdp.js";

const port = Number(process.env.MIMO_STATSBAR_PORT || 9222);
const probe = await probePort(port);
if (!probe.up) {
  console.error(`端口 ${port} 没开`);
  process.exit(1);
}
console.log("targets:");
for (const t of probe.targets) console.log(" -", t.type, t.url, "|", t.title);

const page = probe.targets.find((t) => t.type === "page" && /^app:/.test(t.url));
if (!page) {
  console.error("没有 app:// 页面");
  process.exit(1);
}

const cdp = await CDP.attach(page.webSocketDebuggerUrl);
await cdp.send("Runtime.enable");

const info = await cdp.eval(
  `JSON.stringify({
     href: location.href,
     barVersion: window.__mimoStatsBar ? window.__mimoStatsBar.version : null,
     conversationView: window.__mimoStatsBar
       ? window.__mimoStatsBar.isConversationView()
       : null,
     hasHost: !!document.getElementById('mimo-statusbar-host'),
     hasStyle: !!document.getElementById('mimo-statusbar-style'),
     composers: [...document.querySelectorAll('.composer-wrap')].map((n) => ({
       id: n.id || null,
       cls: n.className,
       inert: !!n.closest('[inert]'),
     })),
     hasDisclaimer: !!document.querySelector('.composer-ai-disclaimer'),
     barText: (document.getElementById('mimo-statusbar-host') || {}).innerText || null,
     state: window.__mimoStatsBar && window.__mimoStatsBar.state
       ? (window.__mimoStatsBar.state.empty
           ? '(空状态)'
           : window.__mimoStatsBar.state.session)
       : null,
   })`,
  { swallow: true }
);
console.log(info);
cdp.close();
