// Start the status bar at logon, and keep it alive, so it rides along with
// MiMo instead of needing to be launched by hand.
//
// Two pieces, both pointing at an INSTALL root passed in by the caller — never
// at wherever this code happens to be running from, or a copy installed to
// %LOCALAPPDATA% would reference the unpack folder and break as soon as that
// folder is deleted:
//
//  1. a .lnk in the Startup folder, run at logon
//  2. a scheduled task every few minutes, because the logon entry alone leaves
//     a dead injector dead until the next login
//
// Both invoke wscript.exe running bin/watch.js, which is a GUI-subsystem host:
// nothing flashes. A .vbs in the Startup folder would be the textbook malware
// drop and this machine (correctly) refuses to write one there; a .lnk is fine.

import { writeFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./host.mjs";

const NAME = "MiMo 会话统计条.lnk";
export const KEEPALIVE_TASK = "mimo-statusbar-keepalive";

function startupDir() {
  return join(
    process.env.APPDATA ?? "",
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup"
  );
}

export function startupPath() {
  return join(startupDir(), NAME);
}

function wscriptPath() {
  return join(process.env.WINDIR ?? "C:\\Windows", "System32", "wscript.exe");
}

export function watchJsPath(root = ROOT) {
  return join(root, "bin", "watch.js");
}

// The .lnk body is all ASCII: wscript path, our script, fixed switches.
export function lnkArguments(jsPath) {
  return `//B //Nologo "${jsPath}"`;
}

export function keepAliveCommand(root = ROOT) {
  return `"${wscriptPath()}" ${lnkArguments(watchJsPath(root))}`;
}

function writeLnk(lnkPath, targetPath, arguments_) {
  const dir = mkdtempSync(join(tmpdir(), "msb-auto-"));
  const ps1 = join(dir, "mk.ps1");
  writeFileSync(
    ps1,
    "﻿" +
      [
        "$ws = New-Object -ComObject WScript.Shell",
        "$s = $ws.CreateShortcut($args[0])",
        "$s.TargetPath = $args[1]",
        "$s.Arguments = $args[2]",
        "$s.WindowStyle = 7",
        "$s.Description = 'MiMo session status bar - starts hidden at logon'",
        "$s.Save()",
      ].join("\r\n"),
    "utf8"
  );
  try {
    const r = spawnSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, lnkPath, targetPath, arguments_],
      { encoding: "utf8", windowsHide: true }
    );
    return existsSync(lnkPath)
      ? { ok: true }
      : { ok: false, error: (r.stderr || r.stdout || "").trim() };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

export function installAutostart(root = ROOT) {
  const js = watchJsPath(root);
  if (!existsSync(js)) return { ok: false, error: `缺少 ${js}` };
  try {
    const dir = startupDir();
    if (!existsSync(dir)) return { ok: false, error: `找不到启动文件夹 ${dir}` };
    const r = writeLnk(startupPath(), wscriptPath(), lnkArguments(js));
    if (!r.ok) return { ok: false, error: r.error || "创建启动项失败" };
    return { ok: true, path: startupPath(), runs: js };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function removeAutostart() {
  const p = startupPath();
  try {
    if (!existsSync(p)) return { ok: true, removed: false };
    rmSync(p, { force: true });
    return { ok: true, removed: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function autostartStatus() {
  const p = startupPath();
  return { installed: existsSync(p), path: p };
}

// --- keep-alive -------------------------------------------------------------

export function installKeepAlive({ root = ROOT, everyMinutes = 5 } = {}) {
  const js = watchJsPath(root);
  if (!existsSync(js)) return { ok: false, error: `缺少 ${js}` };
  const r = spawnSync(
    "schtasks",
    [
      "/Create",
      "/TN",
      KEEPALIVE_TASK,
      "/TR",
      keepAliveCommand(root),
      "/SC",
      "MINUTE",
      "/MO",
      String(everyMinutes),
      "/F",
    ],
    { encoding: "utf8", windowsHide: true }
  );
  if (r.status !== 0) {
    return { ok: false, error: (r.stderr || r.stdout || "").trim() };
  }
  return { ok: true, task: KEEPALIVE_TASK, everyMinutes, runs: js };
}

export function removeKeepAlive() {
  const r = spawnSync("schtasks", ["/Delete", "/TN", KEEPALIVE_TASK, "/F"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  // Deleting something that is not there is success for an uninstaller.
  if (r.status === 0) return { ok: true, removed: true };
  if (/cannot find|找不到/i.test(out)) return { ok: true, removed: false };
  return { ok: false, error: out.trim() };
}

export function keepAliveStatus() {
  const r = spawnSync("schtasks", ["/Query", "/TN", KEEPALIVE_TASK], {
    encoding: "utf8",
    windowsHide: true,
  });
  return { installed: r.status === 0, task: KEEPALIVE_TASK };
}
