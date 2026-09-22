// Start the status bar at logon, hidden, so it rides along with MiMo instead of
// needing to be launched by hand.
//
// A .vbs in the Startup folder is the one mechanism that reliably starts a
// console-less helper on every stock Windows: wscript itself never allocates a
// window, and Run(..., 0, False) keeps the child hidden too.

import { writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { ROOT } from "./host.mjs";

const NAME = "mimo-statusbar.vbs";

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

// VBS string literal: wrap in quotes and double any inner quote. The value we
// want WScript to execute is `"path with spaces\bin\enable.cmd" --watch --quiet`.
export function vbsLiteral(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

// Comment stays ASCII: the file is written as ASCII so it cannot mojibake.
export function vbsFor(cmdPath, args) {
  const value = `"${cmdPath}" ${args}`;
  return [
    "' MiMo session status bar - starts hidden at logon. Delete this file to disable.",
    `CreateObject("WScript.Shell").Run ${vbsLiteral(value)}, 0, False`,
    "",
  ].join("\r\n");
}

export function installAutostart({ args = "--watch --quiet" } = {}) {
  const enableCmd = join(ROOT, "bin", "enable.cmd");
  if (!existsSync(enableCmd)) return { ok: false, error: `缺少 ${enableCmd}` };
  try {
    const dir = startupDir();
    if (!existsSync(dir)) return { ok: false, error: `找不到启动文件夹 ${dir}` };
    writeFileSync(startupPath(), vbsFor(enableCmd, args), "ascii");
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
  if (!existsSync(p)) return { installed: false, path: p };
  return { installed: true, path: p, body: readFileSync(p, "ascii").trim() };
}
