// Whether unattended helpers may pop a modal, and whether a prior "no" still
// counts. Extracted so tests can pin the policy without spawning MessageBox.

// A background helper (Startup .lnk / keepalive schtasks) must never stack
// Yes/No boxes overnight: watch.js is fire-and-forget, so every tick used to
// start another askYesNo and the user woke up to a pile of dialogs.
export function mayPrompt({ watch = false, autoYes = false, interactive = true } = {}) {
  return interactive && !watch && !autoYes;
}

// User already said "no": do not nag again until the stamp expires.
export function declineActive(untilMs, now = Date.now()) {
  return Number.isFinite(untilMs) && untilMs > now;
}

export function declineUntil(now = Date.now(), cooldownMs = 60 * 60 * 1000) {
  return now + cooldownMs;
}
