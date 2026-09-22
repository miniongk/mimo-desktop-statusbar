// Patch/unpatch the shortcuts that launch MiMo Desktop so they pass the debug
// switch. That is what makes "double-click MiMo as usual" bring the bar up.
//
// Scans the user's Desktop, Start Menu and pinned taskbar for .lnk files whose
// target is Xiaomi MiMo.exe. Reversible: unpatch() strips the switch again.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PS_PATCH = String.raw`
param([string]$Roots, [string]$Flag, [string]$Mode)
$ws = New-Object -ComObject WScript.Shell
# Match the switch by NAME (--foo=bar), never by the whole flag: the value varies.
$flagName = ($Flag -split '=', 2)[0]
$pattern = [regex]::Escape($flagName) + '=\S*'
$changed = @()
foreach ($root in ($Roots -split ';')) {
  if (-not (Test-Path $root)) { continue }
  Get-ChildItem -Path $root -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    try { $s = $ws.CreateShortcut($_.FullName) } catch { return }
    if ($s.TargetPath -notlike '*Xiaomi MiMo.exe') { return }
    $args = [string]$s.Arguments
    if ($Mode -eq 'patch') {
      if ($args -match $pattern) {
        $new = ($args -replace $pattern, $Flag).Trim()
      } elseif ($args.Trim().Length -eq 0) {
        $new = $Flag
      } else {
        $new = $args.TrimEnd() + ' ' + $Flag
      }
    } else {
      $new = ($args -replace $pattern, '') -replace '\s{2,}', ' '
      $new = $new.Trim()
    }
    if ($new -ne $args) {
      $s.Arguments = $new
      $s.Save()
      $changed += $_.FullName
    }
  }
}
$changed | ForEach-Object { Write-Output $_ }
`;

function runPs(script, args) {
  const dir = mkdtempSync(join(tmpdir(), "msb-lnk-"));
  const ps1 = join(dir, "run.ps1");
  writeFileSync(ps1, "﻿" + script, "utf8");
  try {
    const r = spawnSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, ...args],
      { encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
    );
    return { status: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

export function shortcutRoots() {
  const roots = [];
  const push = (p) => {
    if (p && existsSync(p) && !roots.includes(p)) roots.push(p);
  };
  push(join(process.env.USERPROFILE ?? "", "Desktop"));
  push(
    join(
      process.env.APPDATA ?? "",
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs"
    )
  );
  push(
    join(
      process.env.APPDATA ?? "",
      "Microsoft",
      "Internet Explorer",
      "Quick Launch",
      "User Pinned",
      "TaskBar"
    )
  );
  return roots;
}

function apply(mode, flag, roots = shortcutRoots()) {
  if (!roots.length) return { changed: [], error: "找不到快捷方式目录" };
  const r = runPs(PS_PATCH, ["-Roots", roots.join(";"), "-Flag", flag, "-Mode", mode]);
  if (r.status !== 0 && !r.out) return { changed: [], error: r.err || "powershell 失败" };
  const changed = r.out ? r.out.split(/\r?\n/).filter(Boolean) : [];
  return { changed, error: null };
}

export const patchShortcuts = (flag, roots) => apply("patch", flag, roots);
export const unpatchShortcuts = (flag, roots) => apply("unpatch", flag, roots);
