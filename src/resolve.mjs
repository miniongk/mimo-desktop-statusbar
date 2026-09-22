// Decides which session the bar should be showing.
//
// Three inputs matter, in this order:
//
//  1. The composer variant. The renderer mounts two of them: `dock` (id
//     `composer-dock`) inside a conversation, and `home` (class `composer-home`)
//     on the new-task page. Only the dock id means a conversation is open.
//  2. The desktop's own composer-input.json `currentKey`. It holds the open
//     conversation's engine session id and follows switches — but it is *not*
//     cleared when the user goes back to the new-task page, so it can only be
//     trusted once (1) says a conversation is open.
//  3. `currentKey` can also be a temporary `c…` key for a conversation that has
//     not been materialised in the engine yet. That is still "no session".
//
// Scraping the page's localStorage for `ses_*` ids used to sit in this chain. It
// was removed: it reliably returned some other conversation, which is what made
// the bar look frozen on the wrong numbers.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const SESSION_RE = /^ses_[A-Za-z0-9]+$/;

export function defaultComposerInputPath() {
  const appdata = process.env.APPDATA;
  return appdata ? join(appdata, "Xiaomi MiMo", "composer-input.json") : null;
}

export function isSessionId(v) {
  return typeof v === "string" && SESSION_RE.test(v);
}

export function readDesktopCurrentKey(composerInputPath) {
  const k = readDesktopKeyRecord(composerInputPath);
  return k.kind === "session" ? k.value : null;
}

// Distinguishes "no file" from "a key that is not a session yet" — the two lead
// to different fallbacks.
export function readDesktopKeyRecord(composerInputPath) {
  if (!composerInputPath) return { kind: "missing" };
  let raw;
  try {
    raw = JSON.parse(readFileSync(composerInputPath, "utf8"));
  } catch {
    // Missing, locked or half-written: treat as "no signal".
    return { kind: "missing" };
  }
  const key = raw?.currentKey;
  if (typeof key !== "string" || !key) return { kind: "missing" };
  if (isSessionId(key)) return { kind: "session", value: key };
  return { kind: "temp", value: key };
}

export function resolveSession({
  pinnedSessionId = null,
  conversationOpen = true,
  composerInputPath = null,
  fallbackSessionId = null,
} = {}) {
  if (isSessionId(pinnedSessionId)) {
    return { sessionId: pinnedSessionId, source: "pin" };
  }

  // Sitting on the new-task page: there is no conversation to report, and
  // currentKey still points at whichever one was open before.
  if (!conversationOpen) {
    return { sessionId: null, source: "new-conversation" };
  }

  const record = readDesktopKeyRecord(composerInputPath);
  if (record.kind === "session") {
    return { sessionId: record.value, source: "currentKey" };
  }
  if (record.kind === "temp") {
    return { sessionId: null, source: "new-conversation" };
  }
  // No desktop state to read at all (first run): the freshest row is the best
  // guess available.
  if (isSessionId(fallbackSessionId)) {
    return { sessionId: fallbackSessionId, source: "recent" };
  }
  return { sessionId: null, source: "unknown" };
}
