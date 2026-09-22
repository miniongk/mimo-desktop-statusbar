// Tests the session-resolution precedence.
//
// The two behaviours that matter most:
//  - the desktop's own currentKey wins over the "most recently written row" heuristic
//  - sitting on the new-task page produces NO session, even though currentKey
//    still holds the previously open conversation's id
//
// Run: node test/resolve.mjs

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveSession,
  readDesktopCurrentKey,
  readDesktopKeyRecord,
  isSessionId,
} from "../src/resolve.mjs";

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  :: " + extra : ""}`);
  ok ? pass++ : fail++;
};
const eq = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);

const dir = mkdtempSync(join(tmpdir(), "statusbar-resolve-"));
const file = join(dir, "composer-input.json");
const write = (obj) => writeFileSync(file, JSON.stringify(obj), "utf8");

const A = "ses_aaaaaaaaaaaa";
const B = "ses_bbbbbbbbbbbb";
const TEMP = "c1789881339937-1";

try {
  check(
    "isSessionId 识别合法 id",
    isSessionId(A) && !isSessionId(TEMP) && !isSessionId(null) && !isSessionId("")
  );

  write({ currentKey: A });
  eq("读取 currentKey", readDesktopCurrentKey(file), A);
  eq("记录类型 = session", readDesktopKeyRecord(file).kind, "session");

  write({ currentKey: TEMP });
  eq("临时 key 不当作会话 id", readDesktopCurrentKey(file), null);
  eq("记录类型 = temp", readDesktopKeyRecord(file).kind, "temp");

  rmSync(file);
  eq("文件缺失 -> missing", readDesktopKeyRecord(file).kind, "missing");
  eq("路径为空 -> missing", readDesktopKeyRecord(null).kind, "missing");
  writeFileSync(file, "{broken json", "utf8");
  eq("坏 JSON -> missing", readDesktopKeyRecord(file).kind, "missing");

  write({ currentKey: A });
  eq(
    "currentKey 优先于最近写入的会话",
    resolveSession({ composerInputPath: file, fallbackSessionId: B }),
    { sessionId: A, source: "currentKey" }
  );

  eq(
    "钉住的会话优先于一切",
    resolveSession({ pinnedSessionId: B, composerInputPath: file, conversationOpen: true }),
    { sessionId: B, source: "pin" }
  );

  // The regression the user hit: a blank new-task page, while currentKey still
  // points at the conversation that was open before.
  eq(
    "新任务页不给会话(即使 currentKey 还有旧 id)",
    resolveSession({ composerInputPath: file, conversationOpen: false, fallbackSessionId: B }),
    { sessionId: null, source: "new-conversation" }
  );

  eq(
    "新任务页也不受 pinned 影响之外的因素干扰",
    resolveSession({ composerInputPath: file, conversationOpen: false, fallbackSessionId: null }),
    { sessionId: null, source: "new-conversation" }
  );

  write({ currentKey: TEMP });
  eq(
    "临时 key 视为新对话,不回退到启发式",
    resolveSession({ composerInputPath: file, conversationOpen: true, fallbackSessionId: B }),
    { sessionId: null, source: "new-conversation" }
  );

  rmSync(file);
  eq(
    "首次运行无桌面状态时回退到最近写入的会话",
    resolveSession({ composerInputPath: file, conversationOpen: true, fallbackSessionId: B }),
    { sessionId: B, source: "recent" }
  );
  eq(
    "什么都没有时返回 unknown",
    resolveSession({ composerInputPath: file, conversationOpen: true }),
    { sessionId: null, source: "unknown" }
  );
} catch (err) {
  check(`异常: ${err.message}`, false);
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
