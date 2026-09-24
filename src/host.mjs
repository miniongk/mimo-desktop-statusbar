// Shared host probes for the launcher and the hidden-start wrapper: where MiMo
// lives, whether it is running, whether the debug port is actually serving a
// MiMo renderer, and the injector pid lock.

import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const IMAGE = "Xiaomi MiMo.exe";
export const LOCK_FILE = join(ROOT, "logs", "injector.lock");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function appCandidates() {
  const out = [];
  if (process.env.MIMO_STATSBAR_APP) out.push(process.env.MIMO_STATSBAR_APP);
  for (const base of [process.env.LOCALAPPDATA, process.env.ProgramFiles]) {
    if (!base) continue;
    out.push(join(base, "Programs", "Xiaomi MiMo", IMAGE));
    out.push(join(base, "Xiaomi MiMo", IMAGE));
  }
  return out;
}

export function findApp() {
  return appCandidates().find((p) => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  });
}

export function loadConfig() {
  const file = process.env.MIMO_STATSBAR_CONFIG || join(ROOT, "config.json");
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { port: 9222 };
  }
}

export function isRunning() {
  const r = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${IMAGE}`, "/NH"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return (r.stdout ?? "").includes(IMAGE);
}

// True only when something on that port is actually serving a MiMo renderer —
// an unrelated process holding the port must not stop us from launching.
export async function debugPortReady(port, timeoutMs = 1500) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    let list;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: ctl.signal });
      if (!res.ok) return false;
      list = await res.json();
    } finally {
      clearTimeout(t);
    }
    return Array.isArray(list) && list.some((x) => x.type === "page" && /^app:/.test(x.url ?? ""));
  } catch {
    return false;
  }
}

export function killApp(force) {
  spawnSync("taskkill", ["/IM", IMAGE, ...(force ? ["/F"] : [])], {
    encoding: "utf8",
    windowsHide: true,
  });
}

export async function waitForExit(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isRunning()) return true;
    await sleep(400);
  }
  return !isRunning();
}

export function pidAlive(pid) {
  if (!pid || Number.isNaN(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

export function checkLock() {
  let pid = null;
  try {
    pid = Number(readFileSync(LOCK_FILE, "utf8").trim());
  } catch {
    return null;
  }
  if (!pid || Number.isNaN(pid) || pid === process.pid) return null;
  if (!pidAlive(pid)) return null;
  // Windows recycles pids fast: a live pid is not proof the holder is ours.
  // Without this check a stale lock next to a recycled pid blocks startup.
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
    ],
    { encoding: "utf8", windowsHide: true }
  );
  const cmdline = (r.stdout ?? "").trim();
  return /launch\.mjs|inject\.mjs|enable\.mjs/.test(cmdline) ? pid : null;
}

export function acquireLock() {
  try {
    mkdirSync(dirname(LOCK_FILE), { recursive: true });
    writeFileSync(LOCK_FILE, String(process.pid), "utf8");
    process.on("exit", () => {
      try {
        const held = Number(readFileSync(LOCK_FILE, "utf8").trim());
        if (held === process.pid) rmSync(LOCK_FILE, { force: true });
      } catch {}
    });
  } catch {}
}

// Kill the process holding the injector lock. Safe when that process is only
// waiting for a debug port that does not exist — it cannot be doing anything
// useful. Callers decide when that is true.
export function takeOverLock(pid) {
  if (pid) {
    spawnSync("taskkill", ["/PID", String(pid), "/F"], {
      encoding: "utf8",
      windowsHide: true,
    });
  }
  try {
    rmSync(LOCK_FILE, { force: true });
  } catch {}
}
