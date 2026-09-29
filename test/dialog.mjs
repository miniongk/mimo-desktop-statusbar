// dialog.mjs lock is single-flight: a second caller while one dialog is up
// gets "busy" instead of opening another MessageBox. Never opens a real box.

import {
  acquireDialogLock,
  releaseDialogLock,
  lockBlocks,
  DIALOG_LOCK,
  DIALOG_LOCK_STALE_MS,
} from "../src/dialog.mjs";
import { writeFileSync, rmSync, unlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  :: " + extra : ""}`);
  ok ? pass++ : fail++;
};

const lock = join(tmpdir(), "msb-dialog-test-" + process.pid + ".lock");
const cleanup = () => {
  rmSync(lock, { force: true });
  rmSync(DIALOG_LOCK, { force: true });
};
cleanup();

check("空闲可占用", acquireDialogLock(lock) === true);
check("占用者是自己", Number(readFileSync(lock, "utf8").trim()) === process.pid);
check("已占用则拒绝", acquireDialogLock(lock) === false);
releaseDialogLock(lock);
check("释放后可再占用", acquireDialogLock(lock) === true);
releaseDialogLock(lock);

writeFileSync(lock, String(process.ppid), "utf8");
check("他人持锁(年轻)阻塞", acquireDialogLock(lock) === false);
unlinkSync(lock);

check("死 pid 不阻塞", lockBlocks(99999998, 0) === false);
check("自己持锁阻塞", lockBlocks(process.pid, 0) === true);
check("超龄不阻塞", lockBlocks(process.pid, DIALOG_LOCK_STALE_MS + 1) === false);

cleanup();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
