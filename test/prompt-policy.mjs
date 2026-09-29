// Policy for the "restart MiMo to attach the bar?" prompt. No MessageBox here.

import { mayPrompt, declineActive, declineUntil } from "../src/prompt-policy.mjs";

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  :: " + extra : ""}`);
  ok ? pass++ : fail++;
};

check("交互式可弹窗", mayPrompt({ watch: false, autoYes: false }) === true);
check("--watch 不弹窗(keepalive/开机)", mayPrompt({ watch: true, autoYes: false }) === false);
check("--yes 不弹窗", mayPrompt({ watch: false, autoYes: true }) === false);
check("--watch --yes 也不弹窗", mayPrompt({ watch: true, autoYes: true }) === false);
check("interactive=false 不弹窗", mayPrompt({ watch: false, autoYes: false, interactive: false }) === false);

const now = 1_700_000_000_000;
check("冷却未到期仍算拒绝", declineActive(now + 1000, now) === true);
check("冷却已过期不再拦截", declineActive(now - 1, now) === false);
check("空/NaN 不拦截", declineActive(NaN, now) === false && declineActive(undefined, now) === false);
check("declineUntil 给未来时间", declineUntil(now, 60_000) === now + 60_000);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
