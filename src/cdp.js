// Minimal Chrome DevTools Protocol client: fetch for discovery, Node's built-in
// WebSocket for the session. No dependencies.

export async function listTargets(port, timeoutMs = 3000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function probePort(port) {
  try {
    const targets = await listTargets(port, 1200);
    return { up: true, targets };
  } catch (err) {
    return { up: false, error: err.message };
  }
}

export class CDP {
  #ws;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();
  #closed = false;

  static async attach(wsUrl, { timeoutMs = 5000 } = {}) {
    const cdp = new CDP(wsUrl);
    await cdp.#open(timeoutMs);
    return cdp;
  }

  constructor(wsUrl) {
    this.wsUrl = wsUrl;
  }

  #open(timeoutMs) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.#ws = ws;
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        reject(new Error("websocket open timeout"));
      }, timeoutMs);

      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", (e) => {
        clearTimeout(timer);
        reject(new Error(`websocket error: ${e?.message ?? "unknown"}`));
      });
      ws.addEventListener("close", () => {
        this.#closed = true;
        clearTimeout(timer);
        for (const { reject: rj } of this.#pending.values()) {
          rj(new Error("websocket closed"));
        }
        this.#pending.clear();
        this.#emit("close", {});
      });
      ws.addEventListener("message", (ev) => this.#onMessage(ev.data));
    });
  }

  get closed() {
    return this.#closed;
  }

  #onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
    } catch {
      return;
    }
    if (msg.id != null) {
      const p = this.#pending.get(msg.id);
      if (!p) return;
      this.#pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? "cdp error"));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method) this.#emit(msg.method, msg.params ?? {});
  }

  #emit(event, params) {
    for (const cb of this.#listeners.get(event) ?? []) {
      try {
        cb(params);
      } catch {
        /* a listener must not break the session */
      }
    }
  }

  on(event, cb) {
    const set = this.#listeners.get(event) ?? new Set();
    set.add(cb);
    this.#listeners.set(event, set);
    return () => set.delete(cb);
  }

  send(method, params = {}, timeoutMs = 10000) {
    if (this.#closed) return Promise.reject(new Error("websocket closed"));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // Evaluates an expression in the page and returns its value. Errors inside the
  // page are surfaced as exceptions unless `swallow` is set.
  async eval(expression, { awaitPromise = false, swallow = false } = {}) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: false,
    });
    if (res.exceptionDetails && !swallow) {
      const d = res.exceptionDetails;
      throw new Error(d.exception?.description ?? d.text ?? "page exception");
    }
    return res.result?.value;
  }

  close() {
    try {
      this.#ws?.close();
    } catch {}
  }
}
