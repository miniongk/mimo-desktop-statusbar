// Stops the background injector. Reads the pid from the lock file so it only
// ever touches its own process, then cleans the lock up — Stop-Process does not
// give the target a chance to run its own exit handler.

import { readFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK = join(ROOT, "logs", "injector.lock");

function pidAlive(pid) {
  if (!pid || Number.isNaN(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

let pid = null;
try {
  if (existsSync(LOCK)) pid = Number(readFileSync(LOCK, "utf8").trim());
} catch {}

if (!pid || Number.isNaN(pid)) {
  console.log("[*] 锁文件里没有有效的注入器 pid,无需停止。");
  try {
    rmSync(LOCK, { force: true });
  } catch {}
  process.exit(0);
}

if (!pidAlive(pid)) {
  console.log(`[*] PID ${pid} 已经不在了,清理锁文件。`);
  try {
    rmSync(LOCK, { force: true });
  } catch {}
  process.exit(0);
}

// Refuse to kill something that does not look like our launcher: a stale or
// hand-edited lock must not become a generic process killer.
const r = spawnSync(
  "powershell",
  [
    "-NoProfile",
    "-Command",
    `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
  ],
  { encoding: "utf8", windowsHide: true }
);
const cmdline = (r.stdout ?? "").trim();
if (!/launch\.mjs|inject\.mjs/.test(cmdline)) {
  console.error(`[x] PID ${pid} 看起来不是统计条注入器: ${cmdline || "(读不到命令行)"}`);
  console.error("    不做处理。确认后手动结束它,或删除 logs/injector.lock。");
  process.exit(1);
}

const k = spawnSync("taskkill", ["/PID", String(pid), "/F"], {
  encoding: "utf8",
  windowsHide: true,
});
console.log(`[*] 已停止注入器 PID ${pid}。`);
console.log("    统计条会在约 10 秒内自行从 MiMo 界面上消失。");
try {
  rmSync(LOCK, { force: true });
} catch {}
process.exit(k.status === 0 ? 0 : 1);
