// Keep MiMo Desktop running with the debug switch the bar needs.
//
// Normal launches are already covered: install patches every MiMo shortcut to
// pass --remote-debugging-port. What is left is the app restarting itself after
// an update — that comes up without the switch and the bar silently dies. The
// watch loop calls this and it puts things right once.

import { spawn } from "node:child_process";
import {
  findApp,
  isRunning,
  debugPortReady,
  killApp,
  waitForExit,
  sleep,
} from "./host.mjs";
import { askYesNo } from "./dialog.mjs";

const COOLDOWN_MS = 3 * 60 * 1000;
let lastAttempt = 0;

// mode: "auto" | "ask" | "off"
export async function recoverMiMo({ port, mode = "auto", log = () => {}, interactive = true }) {
  if (mode === "off") return "off";
  if (await debugPortReady(port)) return "ok";
  if (!isRunning()) return "no-app";

  // MiMo is up but cannot be reached — the post-update state.
  if (Date.now() - lastAttempt < COOLDOWN_MS) return "cooldown";

  if (mode === "ask" && interactive) {
    const answer = askYesNo(
      "MiMo 正在运行,但没带调试端口(应用更新后重启会导致),统计条挂不上去。\n\n" +
        "现在关闭并重启 MiMo 吗?\n\n" +
        "· 重启会关掉当前对话窗口,会话记录会保留\n" +
        "· 选「否」则本次不动,统计条保持不可用",
      "会话统计条"
    );
    if (answer !== "yes") return "declined";
  }

  lastAttempt = Date.now();
  const app = findApp();
  if (!app) return "no-app-binary";

  log(`[*] 检测到 MiMo 未带调试端口,正在恢复(${mode === "auto" ? "自动" : "确认后"}重启)…`);
  killApp(false);
  if (!(await waitForExit(8000))) {
    log("    优雅关闭超时,改为强制结束。");
    killApp(true);
    if (!(await waitForExit(10000))) return "kill-failed";
  }
  await sleep(600);

  spawn(app, [`--remote-debugging-port=${port}`], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  }).unref();
  log(`[*] 已带 --remote-debugging-port=${port} 重新启动 MiMo。`);
  return "restarted";
}
