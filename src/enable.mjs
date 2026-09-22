// One click to enable the status bar — and, after install, the piece that makes
// it ride along with MiMo instead of needing to be launched by hand.
//
// Flags:
//   --dry-run   report what would happen
//   --yes       no confirmation box (auto-restart MiMo if needed)
//   --watch     started at logon: patch shortcuts, then hand over to a hidden
//               injector that stays resident and self-heals after updates
//   --quiet     suppress the "done" chatter (used by the logon watcher)

import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  ROOT,
  loadConfig,
  findApp,
  isRunning,
  debugPortReady,
  killApp,
  waitForExit,
  sleep,
} from "./host.mjs";
import { askYesNo } from "./dialog.mjs";
import { patchShortcuts, shortcutRoots } from "./shortcuts.mjs";
import { installAutostart } from "./autostart.mjs";

const dryRun = process.argv.includes("--dry-run");
const autoYes = process.argv.includes("--yes");
const watch = process.argv.includes("--watch");
const quiet = process.argv.includes("--quiet");
const say = (...a) => {
  if (!quiet) console.log(...a);
};

const launcher = join(ROOT, "src", "launch.mjs");
const logFile = join(ROOT, "logs", "statusbar.log");
const cfg = loadConfig();
const port = Number(cfg.port) || 9222;
const flag = `--remote-debugging-port=${port}`;

const app = findApp();
if (!app) {
  console.error("[x] 找不到 MiMo Desktop,统计条无处可挂。");
  process.exit(1);
}

const portUp = await debugPortReady(port);
const running = isRunning();

if (dryRun) {
  console.log("[dry-run] MiMo:", running ? "运行中" : "未运行");
  console.log("[dry-run] 调试端口:", portUp ? "已开着" : "未开着");
  console.log("[dry-run] 快捷方式目录:");
  for (const r of shortcutRoots()) console.log("          ", r);
  console.log("[dry-run] 将执行:");
  console.log("          1. 给 MiMo 快捷方式加上", flag, "(幂等)");
  console.log(
    "          2.",
    !portUp && running ? "弹框/自动重启 MiMo(带端口)" : "必要时带端口启动 MiMo"
  );
  console.log("          3. 后台挂统计条" + (watch ? ",并保持常驻自愈" : ""));
  process.exit(0);
}

// 1. Take over the way MiMo is launched, so the usual icon brings the bar up.
const patched = patchShortcuts(flag);
if (patched.error) say("[!] 快捷方式处理失败:", patched.error);
else if (patched.changed.length) {
  say(`[*] 已给 ${patched.changed.length} 个 MiMo 快捷方式加上调试端口:`);
  for (const p of patched.changed) say("      ", p);
} else {
  say("[*] MiMo 快捷方式已带调试端口(无需改动)。");
}

// 2. Recover the running app if it came up without the switch.
if (!portUp && running) {
  say("[!] MiMo 正在运行,但没带调试端口 —— 应用更新后重启通常就是这样。");
  const answer = autoYes
    ? "yes"
    : askYesNo(
        "统计条需要 MiMo 带调试端口启动,当前这次没带(应用更新后重启会导致)。\n\n" +
          "现在关闭并重启 MiMo 吗?\n\n" +
          "· 重启会关掉当前对话窗口,会话记录会保留\n" +
          "· 选「否」也不会有任何改动,之后再双击桌面图标即可",
        "启用会话统计条"
      );
  if (answer !== "yes") {
    say("    好的,没有改动任何东西。想启用时再双击「MiMo 统计条」。");
    process.exit(2);
  }
  say("    正在关闭 MiMo…");
  killApp(false);
  if (!(await waitForExit(8000))) {
    say("    优雅关闭超时,改为强制结束。");
    killApp(true);
    await waitForExit(10000);
  }
  await sleep(600);
}

// 3. Resident injector: hidden, self-healing when an update restarts the app.
spawn(process.execPath, [launcher, "--yes", "--hidden"], {
  detached: true,
  stdio: "ignore",
  windowsHide: true,
  env: { ...process.env, MIMO_STATSBAR_WATCH: "1" },
}).unref();

say(portUp ? "[*] 正在挂载统计条…" : "[*] 正在带调试端口启动 MiMo 并挂载统计条…");
if (watch) {
  // Started at logon: make sure the logon entry exists too, so it survives.
  const a = installAutostart();
  if (a.ok && !quiet) say("[*] 已注册开机自启:", a.path);
  say("[*] 常驻自愈已开启:更新后若 MiMo 重启没带端口,会自动补一次重启。");
}
say("[*] 无常驻窗口。日志: " + logFile);
say("[*] 停止统计条: bin\\stop.cmd");
