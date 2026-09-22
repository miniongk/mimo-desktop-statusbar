// Start the status bar at logon so it rides along with MiMo instead of needing
// to be launched by hand.
//
// A .vbs in the Startup folder is the textbook malware drop and this machine
// (correctly) refuses to write one there. A .lnk is fine, so the Startup entry
// is a shortcut to wscript.exe running bin/watch.js from our own directory —
// wscript is a GUI subsystem app, so nothing flashes at logon.

import { writeFileSync, existsSync, rmSync, readFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { ROOT } from "./host.mjs";

const NAME = "MiMo 会话统计条.lnk";

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

export function watchJsPath() {
  return join(ROOT, "bin", "watch.js");
}

// The .lnk body is all ASCII: wscript path, our script, fixed switches.
export function lnkArguments(jsPath = watchJsPath()) {
  return `//B //Nologo "${jsPath}"`;
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
    return existsSync(lnkPath) ? { ok: true } : { ok: false, error: (r.stderr || r.stdout || "").trim() };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

export function installAutostart() {
  const js = watchJsPath();
  if (!existsSync(js)) return { ok: false, error: `缺少 ${js}` };
  try {
    const dir = startupDir();
    if (!existsSync(dir)) return { ok: false, error: `找不到启动文件夹 ${dir}` };
    const r = writeLnk(startupPath(), wscriptPath(), lnkArguments(js));
    if (!r.ok) return { ok: false, error: r.error || "创建启动项失败" };
    return { ok: true, path: startupPath() };
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
