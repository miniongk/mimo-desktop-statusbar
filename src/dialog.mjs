// A single Yes/No message box. Used where a console is gone in a few seconds
// and the user must decide something (restart MiMo to attach the bar).
//
// The message is passed as a PowerShell argument, never interpolated into the
// script, so quotes and newlines in it cannot break anything.
//
// Single-flight: watch.js is fire-and-forget, so concurrent enable.mjs used to
// each open a MessageBox and the boxes stacked overnight. A lock file makes a
// second caller return "busy" instead of stacking another dialog.

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  openSync,
  closeSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DIALOG_LOCK = join(tmpdir(), "msb-dialog.lock");
export const DIALOG_LOCK_STALE_MS = 5 * 60 * 1000;

function pidAlive(pid) {
  if (!pid || Number.isNaN(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

function writePid(lockPath = DIALOG_LOCK) {
  const fd = openSync(lockPath, "wx");
  closeSync(fd);
  writeFileSync(lockPath, String(process.pid), "utf8");
}

/** Does this lock holder still block a new dialog? */
export function lockBlocks(pid, ageMs, staleMs = DIALOG_LOCK_STALE_MS) {
  if (ageMs > staleMs) return false;
  return pid === process.pid || pidAlive(pid);
}

/**
 * Best-effort exclusive create. False when another dialog is already up.
 * Exported for tests — askYesNo is the only production caller.
 */
export function acquireDialogLock(lockPath = DIALOG_LOCK, staleMs = DIALOG_LOCK_STALE_MS) {
  try {
    writePid(lockPath);
    return true;
  } catch {
    try {
      const pid = Number(readFileSync(lockPath, "utf8").trim());
      let age = 0;
      try {
        age = Date.now() - Number(statSync(lockPath).mtimeMs);
      } catch {
        age = staleMs + 1;
      }
      if (!lockBlocks(pid, age, staleMs)) {
        try {
          unlinkSync(lockPath);
        } catch {}
        try {
          writePid(lockPath);
          return true;
        } catch {
          return false;
        }
      }
    } catch {
      try {
        unlinkSync(lockPath);
      } catch {}
      try {
        writePid(lockPath);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export function releaseDialogLock(lockPath = DIALOG_LOCK) {
  try {
    const pid = Number(readFileSync(lockPath, "utf8").trim());
    if (pid === process.pid) unlinkSync(lockPath);
  } catch {}
}

/**
 * Show one Yes/No box. Returns "yes" | "no" | "busy".
 * "busy" = another dialog is already up; treat as "no" and do not retry.
 */
export function askYesNo(message, title = "MiMo 会话统计条") {
  if (!acquireDialogLock()) return "busy";
  const dir = mkdtempSync(join(tmpdir(), "msb-dlg-"));
  const ps1 = join(dir, "ask.ps1");
  writeFileSync(
    ps1,
    "﻿" +
      [
        "Add-Type -AssemblyName System.Windows.Forms",
        "$r = [System.Windows.Forms.MessageBox]::Show($args[0], $args[1], 'YesNo', 'Question')",
        "Write-Output $r",
      ].join("\r\n"),
    "utf8"
  );
  try {
    const r = spawnSync(
      "powershell",
      ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", ps1, message, title],
      { encoding: "utf8", windowsHide: true }
    );
    return /^yes/mi.test(r.stdout ?? "") ? "yes" : "no";
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
    releaseDialogLock();
  }
}
