// Shortcut patching is what lets "click MiMo as usual" bring the bar up, so it
// has to be exact and reversible. Exercises it against .lnk files in a temp
// directory — never the real Desktop/Start Menu entries.
//
// Run: node test/shortcuts.mjs

import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { patchShortcuts, unpatchShortcuts } from "../src/shortcuts.mjs";

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  :: " + extra : ""}`);
  ok ? pass++ : fail++;
};
const eq = (name, actual, expected) =>
  check(name, actual === expected, `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);

const dir = mkdtempSync(join(tmpdir(), "msb-lnk-test-"));
const FLAG = "--remote-debugging-port=9222";

function makeLnk(name, target, args) {
  const ps1 = join(dir, "make.ps1");
  writeFileSync(
    ps1,
    "﻿" +
      [
        "$ws = New-Object -ComObject WScript.Shell",
        "$s = $ws.CreateShortcut($args[0])",
        "$s.TargetPath = $args[1]",
        "$s.Arguments = $args[2]",
        "$s.Save()",
      ].join("\r\n"),
    "utf8"
  );
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      ps1,
      join(dir, name),
      target,
      args,
    ],
    { encoding: "utf8", windowsHide: true }
  );
  return r.status === 0;
}

function readLnk(name) {
  const ps1 = join(dir, "read.ps1");
  writeFileSync(
    ps1,
    "﻿" +
      [
        "$ws = New-Object -ComObject WScript.Shell",
        "$s = $ws.CreateShortcut($args[0])",
        "Write-Output ('TARGET=' + $s.TargetPath)",
        "Write-Output ('ARGS=' + $s.Arguments)",
      ].join("\r\n"),
    "utf8"
  );
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, join(dir, name)],
    { encoding: "utf8", windowsHide: true }
  );
  const target = /TARGET=(.*)/.exec(r.stdout ?? "")?.[1] ?? "";
  const args = /ARGS=(.*)/.exec(r.stdout ?? "")?.[1] ?? "";
  return { target, args };
}

try {
  const MIMO = "C:\\Apps\\Xiaomi MiMo\\Xiaomi MiMo.exe";
  check("造出快捷方式 a(MiMo,无参数)", makeLnk("a.lnk", MIMO, ""));
  check("造出快捷方式 b(MiMo,已有参数)", makeLnk("b.lnk", MIMO, "--foo bar"));
  check("造出快捷方式 c(别的程序)", makeLnk("c.lnk", "C:\\Windows\\notepad.exe", ""));

  const p1 = patchShortcuts(FLAG, [dir]);
  check("patch 无报错", !p1.error, p1.error ?? "");
  eq("patch 改动了 2 个 MiMo 快捷方式", p1.changed.length, 2);

  let a = readLnk("a.lnk");
  eq("无参数 → 加上开关", a.args, FLAG);
  eq("target 不变", a.target, MIMO);

  const b = readLnk("b.lnk");
  eq("已有参数 → 追加且保留原参数", b.args, "--foo bar " + FLAG);

  const c = readLnk("c.lnk");
  eq("别的程序不动", c.args, "");

  const p2 = patchShortcuts(FLAG, [dir]);
  eq("重复 patch 幂等(不再改动)", p2.changed.length, 0);
  eq("幂等后参数不变", readLnk("a.lnk").args, FLAG);

  const u = unpatchShortcuts(FLAG, [dir]);
  eq("unpatch 还原 2 个", u.changed.length, 2);
  eq("a 还原为空", readLnk("a.lnk").args, "");
  eq("b 还原回原参数", readLnk("b.lnk").args, "--foo bar");
  eq("c 仍未动过", readLnk("c.lnk").args, "");

  const u2 = unpatchShortcuts(FLAG, [dir]);
  eq("重复 unpatch 幂等", u2.changed.length, 0);

  // Windows is case-insensitive about paths but the switch itself must survive
  // being appended twice by hand-edited shortcuts — it is replaced, not stacked.
  makeLnk("d.lnk", MIMO, "--remote-debugging-port=1234 other");
  patchShortcuts(FLAG, [dir]);
  eq("已有的调试端口被替换而非叠加", readLnk("d.lnk").args, FLAG + " other");
} catch (err) {
  check(`异常: ${err.message}`, false);
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
