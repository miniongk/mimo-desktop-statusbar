// A single Yes/No message box. Used where a console is gone in a few seconds
// and the user must decide something (restart MiMo to attach the bar).
//
// The message is passed as a PowerShell argument, never interpolated into the
// script, so quotes and newlines in it cannot break anything.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function askYesNo(message, title = "MiMo 会话统计条") {
  const dir = mkdtempSync(join(tmpdir(), "msb-dlg-"));
  const ps1 = join(dir, "ask.ps1");
  writeFileSync(
    ps1,
    // BOM so PowerShell 5.1 reads the file as UTF-8.
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
  }
}
