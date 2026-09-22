// Starts the injector with no visible console window.
//
// The .cmd wrapper shows a console for a couple of seconds, so this file does
// its own pre-checks first and prints what the user actually has to do —
// spawning launch.mjs hidden and then claiming "started" would be a lie when
// the app was relaunched by an update without the debug switch.

import { spawn } from "node:child_process";
import { join } from "node:path";
import { ROOT, loadConfig, findApp, isRunning, debugPortReady } from "./host.mjs";

const launcher = join(ROOT, "src", "launch.mjs");
const logFile = join(ROOT, "logs", "statusbar.log");

const cfg = loadConfig();
const port = Number(cfg.port) || 9222;

const app = findApp();
if (!app) {
  console.error("[x] 找不到 MiMo Desktop,统计条无处可挂。");
  process.exit(1);
}

const portUp = await debugPortReady(port);

if (!portUp && isRunning()) {
  // The common post-update state: the app is running, just without the flag.
  console.log("[!] MiMo 正在运行,但调试端口没开 —— 应用更新后重启就是这样。");
  console.log("    统计条挂不上去,不是插件坏了。");
  console.log();
  console.log("    恢复步骤:");
  console.log("      1. 退出 MiMo(系统托盘/窗口右上角都行)");
  console.log("      2. 再次双击桌面「MiMo 统计条」");
  console.log();
  console.log(`    日志: ${logFile}`);
  process.exit(3);
}

const child = spawn(process.execPath, [launcher, "--yes", "--hidden"], {
  detached: true,
  stdio: "ignore",
  windowsHide: true,
});
child.unref();

console.log(portUp ? "[*] 调试端口开着,正在后台挂载统计条…" : "[*] 正在带调试端口启动 MiMo…");
console.log("[*] 没有常驻窗口。日志: " + logFile);
console.log("[*] 停止统计条: bin\\stop.cmd");
