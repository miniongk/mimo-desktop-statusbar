// The Node runtime ships inside MiMo Desktop, but it is the "mimo-node" shim:
// without MIMO_ELECTRON_NODE_HOST it dies with
//   mimo-node: MIMO_ELECTRON_NODE_HOST is not set
// which is exactly what a clean machine sees. Assert both halves: that it
// fails bare, and that pointing it at Xiaomi MiMo.exe makes it work.
//
// Run: node test/runtime.mjs   (or bin\test.cmd runtime)

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  :: " + extra : ""}`);
  ok ? pass++ : fail++;
};

const app =
  process.env.MIMO_STATSBAR_APP ||
  join(process.env.LOCALAPPDATA ?? "", "Programs", "Xiaomi MiMo", "Xiaomi MiMo.exe");
const shimPath = join(
  process.env.LOCALAPPDATA ?? "",
  "Programs",
  "Xiaomi MiMo",
  "resources",
  "runtimes",
  "win32-x64",
  "node",
  "node.exe"
);

const run = (env) =>
  spawnSync(shimPath, ["-v"], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...env },
  });

check("MiMo 自带运行时存在", existsSync(shimPath), shimPath);
check("MiMo 主程序存在", existsSync(app), app);

if (existsSync(shimPath)) {
  // Bare: strip the two variables that make it work.
  const bare = spawnSync(shimPath, ["-v"], {
    encoding: "utf8",
    windowsHide: true,
    env: (() => {
      const e = { ...process.env };
      delete e.MIMO_ELECTRON_NODE_HOST;
      delete e.MIMO_NODE;
      delete e.ELECTRON_RUN_AS_NODE;
      return e;
    })(),
  });
  const bareOut = `${bare.stdout ?? ""}${bare.stderr ?? ""}`;
  console.log("      干净环境输出:", bareOut.trim().split(/\r?\n/)[0] ?? "(空)");
  check(
    "不设 MIMO_ELECTRON_NODE_HOST 时报那句错",
    /MIMO_ELECTRON_NODE_HOST is not set/.test(bareOut),
    bareOut.trim().slice(0, 80)
  );

  const withHost = spawnSync(shimPath, ["-v"], {
    encoding: "utf8",
    windowsHide: true,
    env: (() => {
      const e = { ...process.env };
      delete e.MIMO_NODE;
      delete e.ELECTRON_RUN_AS_NODE;
      e.MIMO_ELECTRON_NODE_HOST = app;
      return e;
    })(),
  });
  const ver = (withHost.stdout ?? "").trim();
  console.log("      设了 host 之后:", ver || (withHost.stderr ?? "").trim().slice(0, 60));
  check("设 MIMO_ELECTRON_NODE_HOST 后能跑", /^v\d+\./.test(ver), ver);

  // And the capability this project actually depends on.
  const probe = spawnSync(shimPath, ["-e", "import('node:sqlite').then(()=>console.log('sqlite ok'))"], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, MIMO_ELECTRON_NODE_HOST: app },
  });
  check("带 node:sqlite", /sqlite ok/.test(probe.stdout ?? ""), (probe.stdout ?? "").trim());

  // End to end through the wrapper every .cmd calls: clean env -> _env.cmd ->
  // the shim must work. A temp .bat is used because `cmd /c "quoted command"`
  // gets re-quoted and breaks on nested paths with spaces.
  const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const envCmd = join(pkgRoot, "bin", "_env.cmd");
  check("_env.cmd 存在", existsSync(envCmd), envCmd);

  const tmp = mkdtempSync(join(tmpdir(), "msb-runtime-"));
  const bat = join(tmp, "probe.bat");
  writeFileSync(
    bat,
    [
      "@echo off",
      `cd /d "${join(pkgRoot, "bin")}"`,
      "call _env.cmd",
      "echo NODE=%NODE_EXE%",
      "echo HOST=%MIMO_ELECTRON_NODE_HOST%",
      '"%NODE_EXE%" -v',
      "",
    ].join("\r\n"),
    "ascii"
  );
  const e2e = spawnSync("cmd", ["/d", "/c", bat], {
    encoding: "utf8",
    windowsHide: true,
    env: (() => {
      const e = { ...process.env };
      delete e.MIMO_ELECTRON_NODE_HOST;
      delete e.MIMO_NODE;
      delete e.ELECTRON_RUN_AS_NODE;
      return e;
    })(),
  });
  rmSync(tmp, { recursive: true, force: true });
  const e2eOut = `${e2e.stdout ?? ""}${e2e.stderr ?? ""}`;
  console.log("      _env.cmd 干净环境输出:", e2eOut.trim().replace(/\s+/g, " ").slice(0, 140));
  check(
    "_env.cmd 在干净环境下能起 Node",
    /NODE=.*node\.exe/i.test(e2eOut) && /v\d+\./.test(e2eOut),
    e2eOut.trim().replace(/\s+/g, " ").slice(0, 100)
  );
  check(
    "_env.cmd 把 host 也设上了",
    /HOST=.*Xiaomi MiMo\.exe/i.test(e2eOut),
    e2eOut.trim().replace(/\s+/g, " ").slice(0, 100)
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
