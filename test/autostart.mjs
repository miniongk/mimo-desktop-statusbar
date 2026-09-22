// The logon helper is a Startup .lnk to wscript.exe running bin/watch.js.
// Writing a .vbs into the Startup folder is refused on this machine (correctly
// — that is the classic malware drop), so the shape of that .lnk matters and
// is asserted rather than trusted.
//
// Run: node test/autostart.mjs

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lnkArguments, watchJsPath, autostartStatus, startupPath } from "../src/autostart.mjs";

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  :: " + extra : ""}`);
  ok ? pass++ : fail++;
};

check("watch.js 存在", existsSync(watchJsPath()), watchJsPath());

const args = lnkArguments();
console.log("      .lnk 参数:", args);
check("指向本包的 watch.js", args.includes("watch.js"), args);
check("带上 //B //Nologo(静默)", args.startsWith("//B //Nologo "), args);
check("脚本路径带引号(路径可含空格)", /"[^"]+watch\.js"$/.test(args), args);
check("参数是 ASCII", /^[\x00-\x7F]*$/.test(args));

// watch.js itself must hand over to enable.cmd hidden (0 = window style).
const js = readFileSync(watchJsPath(), "ascii");
console.log("      watch.js:", js.replace(/\s+/g, " ").trim().slice(0, 120));
check("watch.js 调用 enable.cmd", js.includes("enable.cmd"));
check("watch.js 用隐藏窗口启动(Run(..., 0, ...))", /, *0,/.test(js));
check("watch.js 无常驻(JS 执行完即退)", !/setInterval|while\s*\(/.test(js));
check("watch.js 是 ASCII", /^[\x00-\x7F]*$/.test(js));

const st = autostartStatus();
check("autostartStatus 返回路径", typeof st.path === "string" && st.path.endsWith(".lnk"), st.path);
check("启动项路径在 Startup 文件夹", /\\Startup\\/.test(st.path), st.path);
check("startupPath 与 status 一致", st.path === startupPath());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
