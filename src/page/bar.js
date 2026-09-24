// Runs inside the MiMo Desktop renderer. Injected once per page load by
// src/inject.mjs, then fed state over CDP. Defines window.__mimoStatsBar.
//
// Design: an instrument cluster rather than a terminal readout. Metric pills
// (soft stadium chips) group by meaning; the model chip leads because every
// number on the row is that model's. Numbers are tabular mono so they do not
// jitter, labels are small and dim. Other models are stacked by share inside
// the detail panel instead of crowding the row.

(() => {
  const VERSION = 3;
  // Re-injecting is how the injector upgrades an older instance; only bail out
  // if what is already there is at least this new.
  if (window.__mimoStatsBar && window.__mimoStatsBar.version >= VERSION) return;

  const HOST_ID = "mimo-statusbar-host";
  const STYLE_ID = "mimo-statusbar-style";
  const LS_KEY = "mimo-statusbar:expanded";

  const CSS = `
#${HOST_ID} {
  --msb-fg: var(--color-composer-fg, #8b8b93);
  --msb-dim: color-mix(in srgb, var(--msb-fg) 78%, transparent);
  --msb-faint: color-mix(in srgb, var(--msb-fg) 48%, transparent);
  --msb-pill: color-mix(in srgb, var(--msb-fg) 9%, transparent);
  --msb-pill-hi: color-mix(in srgb, var(--msb-fg) 15%, transparent);
  --msb-line: color-mix(in srgb, var(--msb-fg) 16%, transparent);
  --msb-ok: #3fb950;
  --msb-warn: #d29922;
  --msb-hot: #f85149;
  margin: 7px auto 0;
  width: fit-content;
  max-width: 100%;
  color: var(--msb-fg);
  font: 11px/1.4 -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  opacity: .82;
  transition: opacity .18s ease;
  user-select: none;
}
#${HOST_ID}:hover { opacity: 1; }

#${HOST_ID} .msb-row {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: center;
  gap: 5px;
}
#${HOST_ID} .msb-pill {
  display: inline-flex; align-items: center; gap: 5px;
  height: 22px; padding: 0 9px;
  border-radius: 999px;
  background: var(--msb-pill);
  white-space: nowrap;
}
#${HOST_ID} .msb-k {
  font-size: 10px; letter-spacing: .02em;
  color: var(--msb-faint);
}
#${HOST_ID} .msb-v {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  font-size: 11px;
  color: var(--msb-fg);
}
#${HOST_ID} .msb-u { font-size: 10px; color: var(--msb-dim); }
/* label/value pair used inside the panel and footer — keeps them from touching */
#${HOST_ID} .msb-seg { display: inline-flex; align-items: baseline; gap: 4px; }

/* identity pill: a tag, not a chip — it names what the row is about */
#${HOST_ID} .msb-model {
  border: 1px solid var(--msb-line);
  background: none;
  cursor: pointer;
  font: inherit;
  color: inherit;
  padding: 0 10px;
}
#${HOST_ID} .msb-model:hover { background: var(--msb-pill-hi); }
#${HOST_ID} .msb-model-name {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 11px; font-weight: 500; color: var(--msb-fg);
}
#${HOST_ID} .msb-model-mode { font-size: 10px; color: var(--msb-faint); }

#${HOST_ID} .msb-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--msb-ok); flex: 0 0 auto;
  transition: opacity .18s ease;
}
#${HOST_ID}[data-state="idle"] .msb-dot { opacity: 0; }
#${HOST_ID}[data-state="busy"] .msb-dot { animation: msb-pulse 1.1s ease-in-out infinite; }
@keyframes msb-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: .35; transform: scale(.72); }
}

#${HOST_ID} .msb-track {
  display: inline-block; width: 44px; height: 3px;
  border-radius: 2px; overflow: hidden;
  background: var(--msb-line);
}
#${HOST_ID} .msb-track > i {
  display: block; height: 100%; border-radius: 2px;
  background: var(--msb-ok);
  transition: width .35s ease, background .35s ease;
}
#${HOST_ID}[data-ctx="warn"] .msb-track > i { background: var(--msb-warn); }
#${HOST_ID}[data-ctx="hot"]  .msb-track > i { background: var(--msb-hot); }
#${HOST_ID}[data-ctx="warn"] .msb-ctx .msb-v { color: var(--msb-warn); }
#${HOST_ID}[data-ctx="hot"]  .msb-ctx .msb-v { color: var(--msb-hot); }

#${HOST_ID} .msb-more {
  cursor: pointer; border: 0; padding: 0 2px 0 0;
  background: none; font: inherit; line-height: 1;
  color: var(--msb-faint);
}
#${HOST_ID} .msb-more:hover { color: var(--msb-fg); }

/* detail: per-model rows with a share bar each — the other models live here */
#${HOST_ID} .msb-panel {
  display: none;
  margin-top: 6px; padding: 8px 10px 6px;
  border: 1px solid var(--msb-line);
  border-radius: 10px;
  min-width: 320px;
}
#${HOST_ID}[data-expanded="1"] .msb-panel { display: block; }
#${HOST_ID} .msb-panel-head {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: 6px;
}
#${HOST_ID} .msb-panel-title {
  font-size: 10px; letter-spacing: .04em; color: var(--msb-faint);
}
#${HOST_ID} .msb-mrow {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) 74px 64px 64px 52px;
  align-items: center; gap: 10px;
  padding: 3px 0;
  font-variant-numeric: tabular-nums;
}
#${HOST_ID} .msb-mrow + .msb-mrow { border-top: 1px solid var(--msb-line); }
/* numeric columns right-align so rows line up down the panel */
#${HOST_ID} .msb-cell {
  display: inline-flex; align-items: baseline; justify-content: flex-end;
  gap: 5px;
}
#${HOST_ID} .msb-share {
  display: block; height: 3px; border-radius: 2px;
  background: var(--msb-line); overflow: hidden;
}
#${HOST_ID} .msb-share > i {
  display: block; height: 100%; border-radius: 2px;
  background: var(--msb-faint);
}
#${HOST_ID} .msb-mrow[data-current="1"] .msb-share > i { background: var(--msb-ok); }
#${HOST_ID} .msb-mname {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 11px; color: var(--msb-dim);
  overflow: hidden; text-overflow: ellipsis;
}
#${HOST_ID} .msb-mrow[data-current="1"] .msb-mname { color: var(--msb-fg); }
#${HOST_ID} .msb-tag {
  margin-left: 5px; padding: 0 5px; border-radius: 999px;
  background: var(--msb-pill-hi); color: var(--msb-fg);
  font-family: inherit; font-size: 9px;
}
#${HOST_ID} .msb-foot {
  margin-top: 6px; padding-top: 6px;
  border-top: 1px solid var(--msb-line);
  display: flex; flex-wrap: wrap; gap: 4px 14px;
  font-size: 10px; color: var(--msb-faint);
}
#${HOST_ID} .msb-foot b {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  font-weight: 500; color: var(--msb-dim);
}
`;

  const fmt = {
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

  // A label/value pair inside a pill: "cache 97%"
  function pill(label, value, extra, cls = "") {
    const p = el("span", "msb-pill" + (cls ? " " + cls : ""));
    if (label) p.appendChild(el("span", "msb-k", label));
    if (value != null) p.appendChild(el("span", "msb-v", value));
    if (extra) p.appendChild(el("span", "msb-u", extra));
    return p;
  }

  // The renderer mounts the composer in two variants: `dock` (inside a
  // conversation, carries the `composer-dock` id) and `home` (the new-task page,
  // `composer-home` class, no id). Only a docked composer means there is a
  // conversation behind it.
  function isConversationView() {
    const dock = document.getElementById("composer-dock");
    if (!dock) return false;
    const zone = dock.closest(".composer-dock-zone");
    if (zone && zone.hasAttribute("inert")) return false;
    return true;
  }

  function buildRow(s) {
    const row = el("div", "msb-row");
    row.appendChild(el("span", "msb-dot"));

    if (s.empty) {
      row.appendChild(el("span", "msb-pill msb-k", "新对话 · 还没有数据"));
      return row;
    }

    // Identity leads: everything after it is this model's numbers.
    const model = el("button", "msb-pill msb-model");
    model.type = "button";
    model.title = "展开模型明细";
    model.appendChild(
      el("span", "msb-model-name", `${s.model?.providerID ?? ""}/${s.model?.modelID ?? ""}`.replace(/^\//, "") || "—")
    );
    if (s.model?.mode) model.appendChild(el("span", "msb-model-mode", s.model.mode));
    model.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleExpanded();
    });
    row.appendChild(model);

    if (s.context) {
      const c = el("span", "msb-pill msb-ctx");
      const track = el("span", "msb-track");
      const fill = el("i");
      const p = s.context.pct;
      fill.style.width = (p == null ? 0 : Math.max(1.5, Math.min(100, p))) + "%";
      track.appendChild(fill);
      c.appendChild(track);
      c.appendChild(el("span", "msb-v", fmt.pct(p)));
      if (s.context.used != null && s.context.window != null) {
        c.appendChild(el("span", "msb-u", `${fmt.tok(s.context.used)}/${fmt.tok(s.context.window)}`));
      }
      row.appendChild(c);
    }

    row.appendChild(pill("in", fmt.tok(s.tokens?.input)));
    row.appendChild(pill("out", fmt.tok(s.tokens?.output), s.tokens?.reasoning ? `+${fmt.tok(s.tokens.reasoning)}` : null));
    if (s.cache?.hitRate != null) row.appendChild(pill("cache", fmt.pct(s.cache.hitRate * 100)));
    if (s.cost) row.appendChild(pill(null, fmt.cost(s.cost.total)));
    if (s.speed?.tps != null) row.appendChild(pill(null, fmt.tok(s.speed.tps) + "/s"));
    else if (s.timing?.spanMs) row.appendChild(pill(null, fmt.dur(s.timing.spanMs)));

    row.appendChild(pill("tool", String(s.tools?.total ?? 0)));
    if (s.actors?.total) row.appendChild(pill("agent", `${s.actors.running || 0}/${s.actors.total}`));
    if (s.tasks?.total) row.appendChild(pill("task", `${s.tasks.done}/${s.tasks.total}`));

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

  // One row per model, stacked by share of total tokens. This is where the
  // models that are not running go.
  function modelRow(m, maxShare) {
    const r = el("div", "msb-mrow");
    r.dataset.current = m.isCurrent ? "1" : "0";

    const share = el("span", "msb-share");
    const fill = el("i");
    fill.style.width = Math.max(2, Math.round((m.share / (maxShare || 1)) * 100)) + "%";
    share.appendChild(fill);
    r.appendChild(share);

    const name = el("span", "msb-mname");
    name.textContent = `${m.providerID ?? ""}/${m.modelID ?? ""}`.replace(/^\//, "") || "—";
    if (m.isCurrent) name.appendChild(el("span", "msb-tag", "当前"));
    r.appendChild(name);

    const pair = (k, v) => {
      const s2 = el("span", "msb-cell");
      s2.appendChild(el("span", "msb-k", k));
      s2.appendChild(el("span", "msb-v", v));
      return s2;
    };
    r.appendChild(pair("in", fmt.tok(m.tokens.input)));
    r.appendChild(pair("out", fmt.tok(m.tokens.output)));
    r.appendChild(pair("$", fmt.cost(m.cost)));
    r.appendChild(pair("步", String(m.steps)));
    return r;
  }

  function buildPanel(s) {
    const panel = el("div", "msb-panel");
    if (s.empty) return panel;

    const models = s.models ?? [];
    if (models.length) {
      const head = el("div", "msb-panel-head");
      head.appendChild(el("span", "msb-panel-title", `模型用量 · ${models.length}`));
      head.appendChild(
        el("span", "msb-panel-title", `合计 ${fmt.tok(s.totals?.tokens?.total)} · ${fmt.cost(s.totals?.cost)}`)
      );
      panel.appendChild(head);

      const maxShare = Math.max(...models.map((m) => m.share || 0), 0.0001);
      for (const m of models) panel.appendChild(modelRow(m, maxShare));
    }

    const foot = el("div", "msb-foot");
    const bit = (k, v) => {
      const s2 = el("span", "msb-seg");
      s2.appendChild(el("span", "msb-k", k));
      s2.appendChild(el("span", "msb-v", v));
      return s2;
    };
    foot.appendChild(bit("会话工具", String(s.totals?.tools ?? s.tools?.total ?? 0)));    if (s.tools?.byName?.length) {
      foot.appendChild(
        el("span", "msb-k", s.tools.byName.map((t) => `${t.tool} ${t.n}`).join(" · "))
      );
    }
    foot.appendChild(bit("步", String(s.totals?.steps ?? s.tokens?.steps ?? 0)));
    foot.appendChild(bit("消息", String(s.messages?.total ?? 0)));
    if (s.messages?.compacted) foot.appendChild(bit("压缩", String(s.messages.compacted)));
    if (s.timing?.genMs) foot.appendChild(bit("生成", fmt.dur(s.timing.genMs)));
    if (s.session?.title) {
      const t = el("span", "msb-k");
      t.textContent = s.session.title;
      t.style.flex = "1 1 100%";
      t.style.textAlign = "center";
      foot.appendChild(t);
    }
    panel.appendChild(foot);

    if (s.actors?.list?.length) {
      const r = el("div", "msb-foot");
      for (const a of s.actors.list) {
        r.appendChild(el("span", "msb-k", `${a.agent}#${a.id} ${a.status} · ${a.turns}轮`));
      }
      panel.appendChild(r);
    }
    if (s.tasks?.list?.length) {
      const r = el("div", "msb-foot");
      for (const t of s.tasks.list) {
        r.appendChild(el("span", "msb-k", `${t.id} ${t.status}`));
      }
      panel.appendChild(r);
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
    if (wrap) return { parent: wrap, before: wrap.querySelector(".composer-ai-disclaimer") };
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

  // If the injector dies, nothing arrives to tear the bar down. A bar frozen on
  // stale numbers is worse than no bar, so it removes itself once the feed goes
  // quiet.
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

    host.querySelector(":scope > .msb-row")?.remove();
    host.querySelector(":scope > .msb-panel")?.remove();
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
