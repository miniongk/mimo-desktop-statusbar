// The logon helper is a .vbs one-liner whose quoting has to survive paths with
// spaces. Cheap to get wrong, so it is asserted rather than trusted.
//
// Run: node test/autostart.mjs

import { vbsFor, vbsLiteral } from "../src/autostart.mjs";

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  :: " + extra : ""}`);
  ok ? pass++ : fail++;
};

const plain = vbsLiteral("hello");
check("普通字符串加引号", plain === '"hello"', plain);

const withQuote = vbsLiteral('say "hi"');
check("内部引号要翻倍", withQuote === '"say ""hi"""', withQuote);

const body = vbsFor("C:\\Program Files\\MiMo Status\\bin\\enable.cmd", "--watch --quiet");
const line = body.split("\r\n")[1];
console.log("      生成的 VBS 行:", line);

check(
  "命令行整体被包成一个字符串值",
  /^CreateObject\("WScript\.Shell"\)\.Run ".+", 0, False$/.test(line),
  line
);

// The value WScript receives must be:  "C:\Program Files\...\enable.cmd" --watch --quiet
// i.e. the path quoted on its own, args outside the quotes.
const m = /^CreateObject\("WScript\.Shell"\)\.Run (".+"), 0, False$/.exec(line);
const literal = m[1];
// Decode a VBS string literal back to its value.
const value = literal.slice(1, -1).replace(/""/g, '"');
check(
  "解码后 = 带引号的路径 + 参数",
  value === '"C:\\Program Files\\MiMo Status\\bin\\enable.cmd" --watch --quiet',
  value
);

check("注释是 ASCII(不会乱码)", /^[\x00-\x7F]*$/.test(body));
check("文件以换行收尾", body.endsWith("\r\n"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
