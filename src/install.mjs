// Installs the status bar onto this machine from wherever the package was
// extracted. Copies itself to a stable location, drops Desktop / Start Menu
// shortcuts, and leaves an uninstall script behind.
//
// Usage: bin\install.cmd [--dir <path>] [--no-shortcut] [--run]

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHORTCUT_NAME = "MiMo 统计条";
const DESCRIPTION = "后台启动 MiMo 会话统计条(无常驻窗口)";

function parseArgs(argv) {
  const out = { dir: null, shortcuts: true, run: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") out.dir = argv[++i];
    else if (a === "--no-shortcut") out.shortcuts = false;
    else if (a === "--run") out.run = true;
  }
  return out;
}

function findMiMo() {
  const candidates = [];
  if (process.env.MIMO_STATSBAR_APP) candidates.push(process.env.MIMO_STATSBAR_APP);
  for (const base of [process.env.LOCALAPPDATA, process.env.ProgramFiles]) {
    if (!base) continue;
    candidates.push(join(base, "Programs", "Xiaomi MiMo", "Xiaomi MiMo.exe"));
    candidates.push(join(base, "Xiaomi MiMo", "Xiaomi MiMo.exe"));
  }
  return candidates.find((p) => existsSync(p)) ?? null;
}

function samePath(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return resolve(a).toLowerCase() === resolve(b).toLowerCase();
  }
}

// WScript.Shell is the only reliable way to make a .lnk on stock Windows
// without native deps. The helper script is written as UTF-8 with a BOM so
// PowerShell 5.1 reads non-ASCII paths and names correctly.
function writeShortcut({ lnkPath, targetCmd, workDir, iconPath }) {
  const q = (s) => String(s ?? "").replace(/'/g, "''");
  const ps1 = [
    `$ws = New-Object -ComObject WScript.Shell`,
    `$s = $ws.CreateShortcut('${q(lnkPath)}')`,
    `$s.TargetPath = '${q(targetCmd)}'`,
    `$s.WorkingDirectory = '${q(workDir)}'`,
    iconPath ? `$s.IconLocation = '${q(iconPath)},0'` : null,
    `$s.Description = '${q(DESCRIPTION)}'`,
    `$s.Save()`,
  ]
    .filter(Boolean)
    .join("\r\n");

  const dir = mkdtempSync(join(tmpdir(), "msb-shortcut-"));
  const ps1Path = join(dir, "make.ps1");
  writeFileSync(ps1Path, "﻿" + ps1, "utf8");
  try {
    const r = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        ps1Path,
      ],
      { encoding: "utf8", windowsHide: true }
    );
    if (!existsSync(lnkPath)) {
      throw new Error((r.stderr || r.stdout || "shortcut not created").trim());
    }
    return lnkPath;
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

function copyPackage(targetDir) {
  mkdirSync(targetDir, { recursive: true });
  const root = PKG_ROOT.replace(/\\/g, "/").replace(/\/+$/, "");
  cpSync(PKG_ROOT, targetDir, {
    recursive: true,
    force: true,
    dereference: true,
    filter: (src) => {
      const s = src.replace(/\\/g, "/");
      if (s === root) return true;
      if (!s.startsWith(root + "/")) return true;
      const rel = s.slice(root.length + 1);
      // Never copy runtime output; a stale lock from another machine would
      // look like a live injector.
      return !(rel === "logs" || rel.startsWith("logs/"));
    },
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [maj, min] = process.versions.node.split(".").map(Number);

  console.log("=== MiMo 会话统计条 · 安装 ===\n");

  if (maj < 22 || (maj === 22 && min < 5)) {
    console.error(`[x] 需要 Node >= 22.5,当前 ${process.versions.node}。`);
    console.error("    先去 https://nodejs.org 装 LTS,或用 winget install OpenJS.NodeJS.LTS");
    process.exit(1);
  }
  console.log(`[ok] Node ${process.versions.node}`);

  const mimo = findMiMo();
  if (!mimo) {
    console.error("[x] 找不到 MiMo Desktop。已尝试:");
    for (const base of [process.env.LOCALAPPDATA, process.env.ProgramFiles]) {
      if (base) console.error(`      ${join(base, "Programs", "Xiaomi MiMo", "Xiaomi MiMo.exe")}`);
    }
    console.error("    这台机器上要先装好 MiMo Desktop。若装在别处,");
    console.error("    设置环境变量 MIMO_STATSBAR_APP 指向 Xiaomi MiMo.exe 后重装。");
    process.exit(1);
  }
  console.log(`[ok] MiMo Desktop: ${mimo}`);

  if (!existsSync(join(PKG_ROOT, "src", "inject.mjs"))) {
    console.error(`[x] 包不完整,缺少 src/inject.mjs: ${PKG_ROOT}`);
    process.exit(1);
  }

  const targetDir = resolve(
    args.dir || join(process.env.LOCALAPPDATA, "Programs", "mimo-statusbar")
  );

  if (samePath(PKG_ROOT, targetDir)) {
    console.log(`[*] 就在安装目录里运行,跳过复制: ${targetDir}`);
  } else {
    console.log(`[*] 复制到 ${targetDir} …`);
    copyPackage(targetDir);
    console.log("[ok] 复制完成");
  }

  const startCmd = join(targetDir, "bin", "start-hidden.cmd");
  const stopCmd = join(targetDir, "bin", "stop.cmd");
  const installCmd = join(targetDir, "bin", "install.cmd");
  const uninstallCmd = join(targetDir, "bin", "uninstall.cmd");

  if (!existsSync(startCmd)) {
    console.error(`[x] 安装结果不完整,找不到 ${startCmd}`);
    process.exit(1);
  }

  const made = [];
  if (args.shortcuts) {
    const desktop = join(
      process.env.USERPROFILE ?? "",
      "Desktop",
      `${SHORTCUT_NAME}.lnk`
    );
    const programs =
      spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "[Environment]::GetFolderPath('Programs')",
        ],
        { encoding: "utf8", windowsHide: true }
      ).stdout?.trim() ||
      join(
        process.env.APPDATA ?? "",
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs"
      );

    for (const lnkPath of [desktop, join(programs, `${SHORTCUT_NAME}.lnk`)]) {
      try {
        mkdirSync(dirname(lnkPath), { recursive: true });
        writeShortcut({
          lnkPath,
          targetCmd: startCmd,
          workDir: targetDir,
          iconPath: mimo,
        });
        made.push(lnkPath);
      } catch (err) {
        console.error(`[!] 快捷方式创建失败 ${lnkPath}: ${err.message}`);
      }
    }
  }

  console.log("\n=== 安装完成 ===");
  console.log(`安装目录  : ${targetDir}`);
  console.log(`日常启动  : ${made[0] || startCmd}`);
  console.log(`停止统计条: ${stopCmd}`);
  console.log(`卸载      : ${uninstallCmd}`);

  console.log("\n下一步:");
  console.log("  1. 退出正在运行的 MiMo(如果有)。");
  console.log("  2. 双击桌面「MiMo 统计条」快捷方式 —— 统计条会出现在输入框下方。");
  console.log("  3. 之后打开 MiMo 一律用这个快捷方式;开始菜单的原版图标不带调试端口。");

  if (args.run) {
    console.log("\n[*] 正在后台启动统计条…");
    spawn(process.execPath, [join(targetDir, "src", "start-hidden.mjs")], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  }
}

main().catch((err) => {
  console.error("[x] 安装失败:", err?.message ?? err);
  process.exit(1);
});
