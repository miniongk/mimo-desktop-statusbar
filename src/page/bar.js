// Runs inside the MiMo Desktop renderer. Injected once per page load by
// src/inject.mjs, then fed state over CDP. Defines window.__mimoStatsBar.
(() => {
  const VERSION = 2;
  // Re-injecting is how the injector upgrades an older instance; only bail out
  // if what is already there is at least this new.
  if (window.__mimoStatsBar && window.__mimoStatsBar.version >= VERSION) return;

  const HOST_ID = "mimo-statusbar-host";
  const STYLE_ID = "mimo-statusbar-style";
  const LS_KEY = "mimo-statusbar:expanded";

  const CSS = `
#${HOST_ID} {
  --msb-fg: var(--color-composer-fg, #8b8b93);
  --msb-dim: color-mix(in srgb, var(--msb-fg) 62%, transparent);
  --msb-faint: color-mix(in srgb, var(--msb-fg) 38%, transparent);
  --msb-line: color-mix(in srgb, var(--msb-fg) 16%, transparent);
  --msb-ok: #3fb950;
  --msb-warn: #d29922;
  --msb-hot: #f85149;
  margin: 6px auto 0;
  max-width: 100%;
  font: 11px/1.5 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  color: var(--msb-fg);
  opacity: .78;
  transition: opacity .18s ease;
  user-select: none;
}
#${HOST_ID}:hover { opacity: 1; }
#${HOST_ID} .msb-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px 9px;
}
#${HOST_ID} .msb-seg { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
#${HOST_ID} .msb-k { color: var(--msb-faint); }
#${HOST_ID} .msb-v { color: var(--msb-fg); }
#${HOST_ID} .msb-u { color: var(--msb-dim); }
#${HOST_ID} .msb-sep {
  width: 1px; height: 10px;
  background: var(--msb-line);
  flex: 0 0 auto;
}
#${HOST_ID}[data-state="idle"] .msb-live { opacity: 0; }
#${HOST_ID} .msb-live {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--msb-ok);
  flex: 0 0 auto;
  transition: opacity .18s ease;
}
#${HOST_ID}[data-state="busy"] .msb-live { animation: msb-pulse 1.1s ease-in-out infinite; }
@keyframes msb-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: .35; transform: scale(.72); }
}
#${HOST_ID} .msb-track {
  display: inline-block;
  width: 46px; height: 3px;
  border-radius: 2px;
  background: var(--msb-line);
  overflow: hidden;
  flex: 0 0 auto;
}
#${HOST_ID} .msb-track > i {
  display: block; height: 100%;
  border-radius: 2px;
  background: var(--msb-ok);
  transition: width .35s ease, background .35s ease;
}
#${HOST_ID}[data-ctx="warn"] .msb-track > i { background: var(--msb-warn); }
#${HOST_ID}[data-ctx="hot"] .msb-track > i { background: var(--msb-hot); }
#${HOST_ID}[data-ctx="warn"] .msb-ctx .msb-v { color: var(--msb-warn); }
#${HOST_ID}[data-ctx="hot"] .msb-ctx .msb-v { color: var(--msb-hot); }
#${HOST_ID} .msb-more {
  cursor: pointer;
  color: var(--msb-faint);
  background: none; border: 0; padding: 0 2px;
  font: inherit; line-height: 1;
}
#${HOST_ID} .msb-more:hover { color: var(--msb-fg); }
#${HOST_ID} .msb-panel {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--msb-line);
  display: none;
  text-align: center;
}
#${HOST_ID}[data-expanded="1"] .msb-panel { display: block; }
#${HOST_ID} .msb-panel .msb-row + .msb-row { margin-top: 3px; }
#${HOST_ID} .msb-tool { color: var(--msb-dim); }
#${HOST_ID} .msb-empty { color: var(--msb-faint); }
`;

  const fmt = {
    int(n) {
      if (n == null) return "—";
      return String(Math.round(n));
    },
    // Compact but unambiguous: 999, 12.4k, 1M, 10.65M
    tok(n) {
      if (n == null) return "—";
      const a = Math.abs(n);
      if (a < 1000) return String(Math.round(n));
      if (a < 1e6) {
        const v = (n / 1e3).toFixed(a < 1e4 ? 1 : 0);
        return v.replace(/\.0$/, "") + "k";
      }
      const v = (n / 1e6).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
      return v + "M";
    },
    cost(n) {
      if (n == null) return "—";
      if (n === 0) return "$0";
      if (n < 0.01) return "$" + n.toFixed(4);
      if (n < 1) return "$" + n.toFixed(3);
      return "$" + n.toFixed(2);
    },
    dur(ms) {
      if (!ms || ms < 0) return "—";
      const s = Math.round(ms / 1000);
      if (s < 60) return s + "s";
      const m = Math.floor(s / 60);
      if (m < 60) return m + "m" + String(s % 60).padStart(2, "0") + "s";
      return Math.floor(m / 60) + "h" + String(m % 60).padStart(2, "0") + "m";
    },
    pct(v) {
      if (v == null) return "—";
      return v < 10 ? v.toFixed(1) + "%" : Math.round(v) + "%";
    },
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function seg(label, value, extra) {
    const s = el("span", "msb-seg");
    if (label) s.appendChild(el("span", "msb-k", label));
    if (value != null) s.appendChild(el("span", "msb-v", value));
    if (extra) s.appendChild(el("span", "msb-u", extra));
    return s;
  }

  function sep() {
    return el("span", "msb-sep");
  }

  function parse(v) {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }

  // The renderer mounts the composer in two variants: `dock` (inside a
  // conversation, carries the `composer-dock` id) and `home` (the new-task page,
  // `composer-home` class, no id). Only a docked composer means there is a
  // conversation behind it — sitting on the new-task page must not report the
  // previous conversation's numbers.
  function isConversationView() {
    const dock = document.getElementById("composer-dock");
    if (!dock) return false;
    const zone = dock.closest(".composer-dock-zone");
    if (zone && zone.hasAttribute("inert")) return false;
    return true;
  }

  function buildRow(s) {
    const row = el("div", "msb-row");
    row.appendChild(el("span", "msb-live"));

    // New-task page: there is nothing to count yet. Saying so is better than
    // leaving the previous conversation's numbers on screen.
    if (s.empty) {
      row.appendChild(el("span", "msb-seg msb-empty", "新对话 · 还没有数据"));
      return row;
    }

    // Identity leads: it is the one thing that stays put while numbers churn,
    // and keeping it first stops it from dangling alone on a wrapped line.
    if (s.model?.modelID) {
      const m = el("span", "msb-seg");
      m.appendChild(
        el("span", "msb-v", `${s.model.providerID ?? ""}/${s.model.modelID}`.replace(/^\//, ""))
      );
      if (s.model.mode) m.appendChild(el("span", "msb-u", s.model.mode));
      row.appendChild(m);
      row.appendChild(sep());
    }

    // Context pressure next: it is the number that changes the user's behaviour.
    if (s.context) {
      const c = el("span", "msb-seg msb-ctx");
      c.appendChild(el("span", "msb-k", "ctx"));
      const track = el("span", "msb-track");
      const fill = el("i");
      const pct = s.context.pct;
      fill.style.width = (pct == null ? 0 : Math.max(1.5, Math.min(100, pct))) + "%";
      track.appendChild(fill);
      c.appendChild(track);
      c.appendChild(el("span", "msb-v", fmt.pct(pct)));
      if (s.context.used != null && s.context.window != null) {
        c.appendChild(
          el("span", "msb-u", `${fmt.tok(s.context.used)}/${fmt.tok(s.context.window)}`)
        );
      }
      row.appendChild(c);
      row.appendChild(sep());
    }

    row.appendChild(
      seg("tok", `${fmt.tok(s.tokens?.input)}↑ ${fmt.tok(s.tokens?.output)}↓`, s.tokens?.reasoning ? `+${fmt.tok(s.tokens.reasoning)}思` : null)
    );

    if (s.cache?.hitRate != null) {
      row.appendChild(sep());
      row.appendChild(seg("cache", fmt.pct(s.cache.hitRate * 100)));
    }

    if (s.cost) {
      row.appendChild(sep());
      row.appendChild(seg(null, fmt.cost(s.cost.total)));
    }

    if (s.speed?.tps != null) {
      row.appendChild(sep());
      row.appendChild(seg(null, fmt.tok(s.speed.tps) + " tok/s"));
    } else if (s.timing?.spanMs) {
      row.appendChild(sep());
      row.appendChild(seg(null, fmt.dur(s.timing.spanMs)));
    }

    row.appendChild(sep());
    const tools = el("span", "msb-seg");
    tools.appendChild(el("span", "msb-k", "tool"));
    tools.appendChild(el("span", "msb-v", String(s.tools?.total ?? 0)));
    row.appendChild(tools);

    if (s.actors?.total) {
      row.appendChild(sep());
      const a = el("span", "msb-seg");
      a.appendChild(el("span", "msb-k", "agent"));
      a.appendChild(el("span", "msb-v", `${s.actors.running || 0}/${s.actors.total}`));
      row.appendChild(a);
    }

    if (s.tasks?.total) {
      row.appendChild(sep());
      const t = el("span", "msb-seg");
      t.appendChild(el("span", "msb-k", "task"));
      t.appendChild(el("span", "msb-v", `${s.tasks.done}/${s.tasks.total}`));
      if (s.tasks.inProgress) {
        t.appendChild(el("span", "msb-u", `跑${s.tasks.inProgress}`));
      }
      row.appendChild(t);
    }

    const more = el("button", "msb-more", "▾");
    more.type = "button";
    more.title = "展开/收起明细";
    more.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleExpanded();
    });
    row.appendChild(more);
    return row;
  }

  function buildPanel(s) {
    const panel = el("div", "msb-panel");
    if (s.empty) return panel;

    const r1 = el("div", "msb-row");
    if (s.tools?.byName?.length) {
      for (const t of s.tools.byName) {
        const x = el("span", "msb-seg");
        x.appendChild(el("span", "msb-k", t.tool));
        x.appendChild(el("span", "msb-v", String(t.n)));
        r1.appendChild(x);
      }
    } else {
      r1.appendChild(el("span", "msb-empty", "本会话还没有工具调用"));
    }
    panel.appendChild(r1);

    const r2 = el("div", "msb-row");
    const bits = [
      ["步", String(s.tokens?.steps ?? 0)],
      ["消息", String(s.messages?.total ?? 0)],
    ];
    if (s.messages?.compacted) bits.push(["压缩", String(s.messages.compacted)]);
    if (s.tokens?.cacheRead) bits.push(["缓存读", fmt.tok(s.tokens.cacheRead)]);
    if (s.tokens?.cacheWrite) bits.push(["缓存写", fmt.tok(s.tokens.cacheWrite)]);
    if (s.timing?.genMs) bits.push(["生成", fmt.dur(s.timing.genMs)]);
    for (const [k, v] of bits) {
      const x = el("span", "msb-seg");
      x.appendChild(el("span", "msb-k", k));
      x.appendChild(el("span", "msb-v", v));
      r2.appendChild(x);
    }
    if (s.session?.title) r2.appendChild(el("span", "msb-tool", s.session.title));
    panel.appendChild(r2);

    if (s.actors?.list?.length) {
      const r3 = el("div", "msb-row");
      for (const a of s.actors.list) {
        const x = el("span", "msb-seg");
        x.appendChild(el("span", "msb-k", `${a.agent}#${a.id}`));
        x.appendChild(el("span", "msb-v", a.status));
        x.appendChild(el("span", "msb-u", `${a.turns}轮`));
        r3.appendChild(x);
      }
      panel.appendChild(r3);
    }

    if (s.tasks?.list?.length) {
      const r4 = el("div", "msb-row");
      for (const t of s.tasks.list) {
        const x = el("span", "msb-seg");
        x.appendChild(el("span", "msb-k", t.id));
        x.appendChild(el("span", "msb-v", t.status));
        r4.appendChild(x);
      }
      panel.appendChild(r4);
    }

    return panel;
  }

  function expanded() {
    try {
      return localStorage.getItem(LS_KEY) === "1";
    } catch {
      return false;
    }
  }

  function toggleExpanded() {
    const next = !expanded();
    try {
      localStorage.setItem(LS_KEY, next ? "1" : "0");
    } catch {}
    for (const host of document.querySelectorAll(`#${HOST_ID}`)) {
      host.dataset.expanded = next ? "1" : "0";
      const more = host.querySelector(".msb-more");
      if (more) more.textContent = next ? "▴" : "▾";
    }
  }

  function findSlot() {
    const wrap = document.querySelector(".composer-wrap");
    if (wrap) {
      return { parent: wrap, before: wrap.querySelector(".composer-ai-disclaimer") };
    }
    const dock = document.querySelector(".composer-dock-zone");
    if (dock) return { parent: dock, before: null };
    return null;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head ?? document.documentElement).appendChild(style);
  }

  let lastState = null;
  let lastUpdateAt = 0;
  let watchdog = null;
  let staleMs = 10000;

  // If the injector dies (crash, hard kill, detached console) nothing arrives to
  // tear the bar down. A bar frozen on stale numbers is worse than no bar, so it
  // removes itself once the feed goes quiet.
  function startWatchdog() {
    if (watchdog) return;
    watchdog = setInterval(() => {
      if (!lastUpdateAt) return;
      if (Date.now() - lastUpdateAt > staleMs) {
        lastUpdateAt = 0;
        clearInterval(watchdog);
        watchdog = null;
        clear();
      }
    }, 1000);
  }

  function mount() {
    const slot = findSlot();
    if (!slot) return false;
    ensureStyle();
    let host = document.getElementById(HOST_ID);
    // The composer subtree is rebuilt on route and session switches; re-attach
    // whenever our node has been orphaned.
    if (host && host.parentNode !== slot.parent) {
      host.remove();
      host = null;
    }
    if (!host) {
      host = document.createElement("div");
      host.id = HOST_ID;
      host.dataset.expanded = expanded() ? "1" : "0";
      host.dataset.state = "idle";
      if (slot.before) slot.before.insertAdjacentElement("beforebegin", host);
      else slot.parent.appendChild(host);
    }
    startWatchdog();
    return true;
  }

  function update(state) {
    if (typeof state.staleMs === "number" && state.staleMs > 0) staleMs = state.staleMs;
    if (!mount()) return false;
    lastState = state;
    lastUpdateAt = Date.now();
    const host = document.getElementById(HOST_ID);

    host.dataset.state = state.busy ? "busy" : "idle";
    const pct = state.context?.pct;
    host.dataset.ctx = pct == null ? "ok" : pct >= 90 ? "hot" : pct >= 75 ? "warn" : "ok";

    const row = host.querySelector(":scope > .msb-row");
    if (row) row.remove();
    const panel = host.querySelector(":scope > .msb-panel");
    if (panel) panel.remove();

    host.appendChild(buildRow(state));
    host.appendChild(buildPanel(state));

    const more = host.querySelector(".msb-more");
    if (more) more.textContent = host.dataset.expanded === "1" ? "▴" : "▾";
    return true;
  }

  function clear() {
    if (watchdog) {
      clearInterval(watchdog);
      watchdog = null;
    }
    lastUpdateAt = 0;
    document.getElementById(HOST_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
  }

  window.__mimoStatsBar = {
    mount,
    update,
    clear,
    toggleExpanded,
    isConversationView,
    version: VERSION,
    get state() {
      return lastState;
    },
  };
})();
