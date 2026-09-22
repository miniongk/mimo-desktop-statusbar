// Launcher for the session status bar.
//
// MiMo Desktop has a single-instance lock, so a second launch with extra
// arguments is dropped on the floor. The only way to give the app the debug
// switch it needs is to fully close it first and start it again with the flag.
// App updates relaunch MiMo without that flag — that is the usual reason the
// bar "suddenly stops working", and this launcher is what puts it back.

import {
  readFileSync,
  mkdirSync,
  appendFileSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import {
  ROOT,
  IMAGE,
  appCandidates,
  findApp,
  loadConfig,
  isRunning,
  debugPortReady,
  killApp,
  waitForExit,
  checkLock,
  acquireLock,
  takeOverLock,
  sleep,
} from "./host.mjs";

const LOG_DIR = join(ROOT, "logs");
const LOG_FILE = join(LOG_DIR, "statusbar.log");

// Mirror every line to disk: a hidden launcher has no window, and the log is
// the only record of what happened.
try {
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(LOG_FILE, `--- ${new Date().toISOString()} 启动 ---\n`, "utf8");
  for (const level of ["log", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      try {
        appendFileSync(
          LOG_FILE,
          args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n",
          "utf8"
        );
      } catch {}
    };
  }
} catch {
  /* the log is a convenience, never a reason to fail the launch */
}

// A forced kill can drop whatever the engine had not committed yet, so ask
// politely first and only escalate if the window does not close.
async function closeApp() {
  killApp(false);
  if (await waitForExit(8000)) return true;
  console.log("    优雅关闭超时,改为强制结束。");
  killApp(true);
  return waitForExit(10000);
}

async function main() {
  const cfg = loadConfig();
  const port = Number(cfg.port) || 9222;
  const dryRun = process.argv.includes("--dry-run");
  const yes = process.argv.includes("--yes");
  const force = process.argv.includes("--force");
  const hidden = process.argv.includes("--hidden");

  const app = findApp();
  if (!app) {
    console.error("[x] 找不到 MiMo Desktop。已尝试:");
    for (const p of appCandidates()) console.error(`      ${p}`);
    console.error("    可用环境变量 MIMO_STATSBAR_APP 指向 Xiaomi MiMo.exe。");
    process.exit(1);
  }

  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 5)) {
    console.error(`[x] 需要 Node >= 22.5,当前 ${process.versions.node}。`);
    process.exit(1);
  }

  const portUp = await debugPortReady(port);
  const held = checkLock();

  if (dryRun) {
    console.log("[dry-run] 应用:", app);
    console.log("[dry-run] 启动参数:", `--remote-debugging-port=${port}`);
    console.log("[dry-run] MiMo 当前状态:", isRunning() ? "正在运行" : "未运行");
    console.log("[dry-run] 调试端口", port, portUp ? "已开着(可直接挂注入器)" : "未开着");
    console.log("[dry-run] 注入器锁:", held ? `被 PID ${held} 占用` : "空闲");
    if (held && !portUp) {
      console.log("[dry-run] → 锁的持有者在空等,启动时会自动接管");
    }
    console.log("[dry-run] 之后会运行 src/inject.mjs");
    return;
  }

  if (held) {
    if (!portUp) {
      // The holder cannot be attached to anything — the port it needs does not
      // exist. This is exactly what an app update leaves behind. Take over
      // instead of making the user run stop.cmd first.
      console.log(`[*] PID ${held} 持有锁但调试端口没开(只是在空等),自动接管。`);
      takeOverLock(held);
      await sleep(600);
    } else if (!force) {
      console.error(`[x] 已经有一个统计条注入器在跑(PID ${held})。`);
      console.error("    两个注入器会互相覆盖同一个 DOM 节点。先 bin\\stop.cmd,");
      console.error("    或确认就是要接管,再用 --force 运行。");
      process.exit(4);
    }
  }
  acquireLock();

  if (portUp) {
    console.log(`[*] 调试端口 ${port} 已经开着,直接挂注入器,不重启应用。`);
    await import("./inject.mjs");
    return;
  }

  if (isRunning()) {
    if (hidden) {
      // Background mode has no one to ask, and silently killing the user's app
      // is not an acceptable default.
      console.error("[!] MiMo 正在运行,但调试端口没开 —— 通常是应用更新后重启导致的。");
      console.error("    隐藏模式不会自动关掉你的应用。退出 MiMo 后再双击桌面「MiMo 统计条」。");
      process.exit(3);
    }
    console.log("[!] MiMo 正在运行,但调试端口没开 —— 通常是应用更新后重启导致的。");
    console.log("    它带单实例锁,不关掉旧进程,调试端口永远开不了。");
    let answer = yes;
    if (!yes) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const a = await rl.question("    关闭 MiMo 并重启?[y/N] ");
      rl.close();
      answer = /^y(es)?$/i.test(a.trim());
    }
    if (!answer) {
      console.log("    已取消。退出 MiMo 后,再双击桌面「MiMo 统计条」即可。");
      process.exit(2);
    }
    console.log("    正在关闭 MiMo…");
    if (!(await closeApp())) {
      console.error("[x] MiMo 没能在 20 秒内退出,请手动关闭后重试。");
      process.exit(3);
    }
    await sleep(800);
  }

  console.log(`[*] 启动 MiMo Desktop(调试端口 ${port})…`);
  const child = spawn(app, [`--remote-debugging-port=${port}`], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();

  console.log(`[*] 日志同时写到 ${LOG_FILE}`);
  console.log("[*] 挂载统计条。\n");
  await import("./inject.mjs");
}

main().catch((err) => {
  console.error("[x] 启动失败:", err?.message ?? err);
  process.exit(1);
});
