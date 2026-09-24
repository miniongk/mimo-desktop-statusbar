// Removes the status bar from this machine: stops the injector, deletes the
// Desktop / Start Menu shortcuts, and optionally deletes the install folder.
//
// Usage: bin\uninstall.cmd [--purge]
//   --purge  also delete the install folder (after this process exits)

import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unpatchShortcuts } from "./shortcuts.mjs";
import {
  removeAutostart,
  autostartStatus,
  removeKeepAlive,
  keepAliveStatus,
} from "./autostart.mjs";

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LOCK = join(PKG_ROOT, "logs", "injector.lock");
const SHORTCUT_NAME = "MiMo 统计条";
const purge = process.argv.includes("--purge");
const cfg = (() => {
  try {
    return JSON.parse(readFileSync(join(PKG_ROOT, "config.json"), "utf8"));
  } catch {
    return {};
  }
})();
const FLAG = `--remote-debugging-port=${Number(cfg.port) || 9222}`;

function pidAlive(pid) {
  if (!pid || Number.isNaN(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

function stopInjector() {
  let pid = null;
  try {
    if (existsSync(LOCK)) pid = Number(readFileSync(LOCK, "utf8").trim());
  } catch {}
  if (!pid || Number.isNaN(pid) || !pidAlive(pid)) {
    try {
      rmSync(LOCK, { force: true });
    } catch {}
    console.log("[*] 没有在跑的注入器。");
    return;
  }

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
  if (!/launch\.mjs|inject\.mjs|start-hidden/.test(cmdline)) {
    console.log(`[!] PID ${pid} 不是统计条注入器(${cmdline || "读不到"}),跳过。`);
    return;
  }
  spawnSync("taskkill", ["/PID", String(pid), "/F"], {
    encoding: "utf8",
    windowsHide: true,
  });
  try {
    rmSync(LOCK, { force: true });
  } catch {}
  console.log(`[*] 已停止注入器 PID ${pid}。统计条约 10 秒内从界面上消失。`);
}

function removeShortcuts() {
  const candidates = [join(process.env.USERPROFILE ?? "", "Desktop")];
  const programs = spawnSync(
    "powershell",
    ["-NoProfile", "-Command", "[Environment]::GetFolderPath('Programs')"],
    { encoding: "utf8", windowsHide: true }
  ).stdout?.trim();
  if (programs) candidates.push(programs);
  candidates.push(
    join(
      process.env.APPDATA ?? "",
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs"
    )
  );

  let removed = 0;
  for (const dir of candidates) {
    const lnk = join(dir, `${SHORTCUT_NAME}.lnk`);
    if (!existsSync(lnk)) continue;
    try {
      rmSync(lnk, { force: true });
      console.log(`[*] 已删除快捷方式: ${lnk}`);
      removed++;
    } catch (err) {
      console.error(`[!] 删除失败 ${lnk}: ${err.message}`);
    }
  }
  if (!removed) console.log("[*] 没有找到「MiMo 统计条」快捷方式。");
}

console.log("=== MiMo 会话统计条 · 卸载 ===\n");
stopInjector();
removeShortcuts();

// Undo what enable.mjs did to the machine.
const un = unpatchShortcuts(FLAG);
if (un.error) console.log("[!] 还原 MiMo 快捷方式失败:", un.error);
else if (un.changed.length) {
  console.log(`[*] 已还原 ${un.changed.length} 个 MiMo 快捷方式(去掉调试端口):`);
  for (const p of un.changed) console.log("      ", p);
} else {
  console.log("[*] MiMo 快捷方式无需还原。");
}

const a = removeAutostart();
if (a.ok && a.removed) console.log("[*] 已移除开机自启。");
else if (a.ok) console.log("[*] 没有开机自启项。");
else console.log("[!] 移除开机自启失败:", a.error);
if (autostartStatus().installed) {
  console.log("[!] 开机自启仍在,可手动删除:", autostartStatus().path);
}

const ka = removeKeepAlive();
if (ka.ok && ka.removed) console.log("[*] 已移除自愈计划任务。");
else if (ka.ok) console.log("[*] 没有自愈计划任务。");
else console.log("[!] 移除自愈任务失败:", ka.error);
if (keepAliveStatus().installed) {
  console.log("[!] 自愈任务仍在,可手动删除: schtasks /Delete /TN", keepAliveStatus().task);
}

if (purge) {
  // Deleting the folder we are executing from has to happen after this process
  // exits, so hand it to a detached cmd.
  const cmd = `ping -n 3 127.0.0.1 >nul & rmdir /s /q "${PKG_ROOT}"`;
  spawn("cmd.exe", ["/d", "/s", "/c", cmd], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
  console.log(`\n[*] 即将删除安装目录: ${PKG_ROOT}`);
} else {
  console.log(`\n安装目录未删除,可手动删掉: ${PKG_ROOT}`);
}

console.log("MiMo 本身没有被改过,不需要恢复任何东西。之后正常启动 MiMo 即可。");
