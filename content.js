// On-page UI: the "Analyze" button and the side panel with tabs.
// Data comes from inject.js (page world) via window.postMessage.
// NOTE: YouTube enforces Trusted Types, so nothing here uses innerHTML.

(() => {
  if (window.__ystLoaded) return;
  window.__ystLoaded = true;

  const { el } = YST;
  const infoCache = new Map(); // videoId -> info
  const channelCache = new Map(); // channelId -> Promise<{ median, count }>
  let S = null; // state of the open panel
  let busy = false;

  // ---------- talk to inject.js ----------
  function ask(type, payload = {}, timeout = 20000) {
    const id = Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { window.removeEventListener("message", onMsg); reject(new Error("Timed out. Refresh the page and try again.")); }, timeout);
      function onMsg(ev) {
        const m = ev.data;
        if (ev.source !== window || !m || m.source !== "yst-inject" || m.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener("message", onMsg);
        m.ok ? resolve(m.data) : reject(new Error(m.error));
      }
      window.addEventListener("message", onMsg);
      window.postMessage({ source: "yst-content", type, id, ...payload }, location.origin);
    });
  }

  function getVideoId() {
    const m = location.pathname.match(/^\/shorts\/([\w-]{11})/);
    if (m) return m[1];
    if (location.pathname === "/watch") return new URLSearchParams(location.search).get("v");
    return null;
  }

  function channelStats(channelId) {
    if (!channelId) return Promise.reject(new Error("no channel"));
    if (!channelCache.has(channelId)) {
      const p = ask("channel", { channelId }).then(({ shorts }) => ({ shorts }));
      p.catch(() => channelCache.delete(channelId));
      channelCache.set(channelId, p);
    }
    return channelCache.get(channelId);
  }

  // ---------- small UI helpers ----------
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const ta = el("textarea", { style: "position:fixed;left:-9999px" });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }
  }
  async function copyBtnAction(text, what = "Copied") {
    toast((await copy(text)) ? `${what} ✓` : "Copy failed");
  }
  function toast(msg) {
    document.getElementById("yst-toast")?.remove();
    const t = el("div", { id: "yst-toast", text: msg });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2400);
  }
  function downloadText(name, text, type = "text/plain") {
    const a = el("a", { href: URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` })), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function safeName(s) {
    return (s || "short").replace(/[\\/:*?"<>|#]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  }
  function btn(text, onclick, cls = "") {
    return el("button", { class: `yst-b ${cls}`.trim(), text, onclick });
  }
  function bg(msg) {
    return chrome.runtime.sendMessage(msg);
  }

  // ---------- library item from current state ----------
  function itemFromState() {
    const i = S.info;
    const plain = YST.asPlain(i.segments);
    return {
      id: i.videoId,
      url: `https://www.youtube.com/shorts/${i.videoId}`,
      title: i.title, channel: i.channel, channelId: i.channelId, handle: i.handle,
      views: i.views, viewsPerDay: YST.viewsPerDay(i.views, i.publishDate),
      publishDate: i.publishDate, lengthSeconds: i.lengthSeconds, category: i.category,
      tags: i.tags, description: i.description, thumbnail: i.thumbnail,
      transcript: plain, transcriptTimed: i.segments.length ? YST.asTimestamped(i.segments) : "",
      transcriptEnglish: S.english?.segments ? YST.asPlain(S.english.segments) : "",
      lang: i.lang, hook: YST.hookOf(i.segments),
      outlier: S.channel?.ratio ?? null, channelMedian: S.channel?.median ?? null,
      source: "panel",
    };
  }
  async function updateSavedCopy(extra = {}) {
    if (S?.saved) await YST.lib.save({ ...itemFromState(), ...extra });
  }

  // ---------- panel ----------
  function closePanel() {
    document.getElementById("yst-panel")?.remove();
    S = null;
  }

  function openPanel(info) {
    closePanel();
    S = { info, tab: "overview", lang: "orig", withTimes: false, english: null, channel: { loading: true }, saved: false, minimized: false, rewrite: { kind: "script", length: null, notes: "", result: "", loading: false, error: "" } };
    const panel = el("div", { id: "yst-panel" });
    panel.dataset.vid = info.videoId;
    document.body.appendChild(panel);
    render();

    YST.lib.has(info.videoId).then((v) => { if (S?.info === info) { S.saved = v; render(); } });
    YST.settings.get().then((st) => { if (S?.info === info && !S.rewrite.length) { S.rewrite.length = st.length || "45"; } });

    channelStats(info.channelId)
      .then(({ shorts }) => {
        if (S?.info !== info) return;
        const others = shorts.filter((s) => s.id !== info.videoId).map((s) => s.views);
        const median = YST.median(others);
        S.channel = { median, count: others.length, ratio: median && info.views !== null ? info.views / median : null };
        render();
        updateSavedCopy();
      })
      .catch(() => { if (S?.info === info) { S.channel = { error: true }; render(); } });
  }

  function render() {
    const panel = document.getElementById("yst-panel");
    if (!panel || !S) return;
    const scrollEl = panel.querySelector(".yst-body");
    const scroll = scrollEl ? scrollEl.scrollTop : 0;
    panel.textContent = "";
    panel.classList.toggle("yst-min", S.minimized);
    const i = S.info;

    // header
    panel.appendChild(
      el("div", { class: "yst-head" }, [
        el("div", { class: "yst-head-text" }, [
          el("div", { class: "yst-title", text: i.title, title: i.title }),
          el("div", { class: "yst-sub", text: [i.channel, YST.ago(i.publishDate)].filter(Boolean).join(" · ") }),
        ]),
        el("div", { class: "yst-head-actions" }, [
          el("button", {
            class: `yst-icon ${S.saved ? "on" : ""}`, title: S.saved ? "Saved — click to remove from Library" : "Save to Library (Alt+S)",
            text: S.saved ? "★" : "☆", onclick: toggleSave,
          }),
          el("button", { class: "yst-icon", title: "Open Library", text: "📚", onclick: () => bg({ type: "openLibrary" }) }),
          el("button", { class: "yst-icon", title: S.minimized ? "Expand" : "Minimize", text: S.minimized ? "▢" : "–", onclick: () => { S.minimized = !S.minimized; render(); } }),
          el("button", { class: "yst-icon", title: "Close (Esc)", text: "✕", onclick: closePanel }),
        ]),
      ])
    );
    if (S.minimized) return;

    if (S.stale) {
      panel.appendChild(
        el("div", { class: "yst-body" }, [
          el("div", { class: "yst-card yst-center" }, [
            el("div", { text: "You swiped to a new Short." }),
            btn("⚡ Analyze this one", run, "primary"),
          ]),
        ])
      );
      return;
    }

    // tabs
    const tabs = [
      ["overview", "Overview"],
      ["tags", `Tags (${i.tags.length})`],
      ["transcript", "Transcript"],
      ["rewrite", "✨ Rewrite"],
    ];
    panel.appendChild(
      el("div", { class: "yst-tabs" }, tabs.map(([k, label]) =>
        el("button", { class: `yst-tab ${S.tab === k ? "on" : ""}`, text: label, onclick: () => { S.tab = k; render(); } })
      ))
    );

    const body = el("div", { class: "yst-body" }, [
      { overview: tabOverview, tags: tabTags, transcript: tabTranscript, rewrite: tabRewrite }[S.tab](),
    ]);
    panel.appendChild(body);
    body.scrollTop = scroll;
  }

  // ---------- Overview ----------
  function stat(label, value, sub) {
    return el("div", { class: "yst-stat" }, [
      el("div", { class: "yst-stat-label", text: label }),
      el("div", { class: "yst-stat-value", text: value }),
      sub ? el("div", { class: "yst-stat-sub", text: sub }) : null,
    ]);
  }

  function tabOverview() {
    const i = S.info;
    const vpd = YST.viewsPerDay(i.views, i.publishDate);
    const c = S.channel;
    let outlier;
    if (c.loading) outlier = el("div", { class: "yst-muted", text: "Checking the channel's other Shorts…" });
    else if (c.error || c.ratio === null || c.ratio === undefined) outlier = el("div", { class: "yst-muted", text: "Couldn't compare with the channel's other Shorts." });
    else {
      const b = YST.outlierBadge(c.ratio);
      outlier = el("div", { class: "yst-outlier" }, [
        el("div", { class: "yst-outlier-num", text: `${c.ratio >= 10 ? Math.round(c.ratio) : c.ratio.toFixed(1)}×` }),
        el("div", {}, [
          el("span", { class: `yst-badge ${b.cls}`, text: b.label }),
          el("div", { class: "yst-muted", text: `vs this channel's typical Short (${YST.fmtNum(c.median)} views, last ${c.count} Shorts)` }),
        ]),
      ]);
    }

    const hook = YST.hookOf(i.segments);
    return el("div", { class: "yst-stack" }, [
      el("div", { class: "yst-stats" }, [
        stat("Views", YST.fmtNum(i.views)),
        stat("Views / day", YST.fmtNum(vpd), (YST.daysSince(i.publishDate) ?? 9) < 1 ? "under a day old" : null),
        stat("Uploaded", YST.fmtDate(i.publishDate), YST.ago(i.publishDate)),
        stat("Length", i.lengthSeconds ? `${i.lengthSeconds}s` : "–"),
      ]),
      el("div", { class: "yst-card" }, [el("div", { class: "yst-label", text: "Performance" }), outlier]),
      el("div", { class: "yst-card" }, [
        el("div", { class: "yst-row" }, [
          el("div", { class: "yst-label", text: "🎣 Hook (first 3 seconds)" }),
          hook ? btn("Copy", () => copyBtnAction(hook, "Hook copied"), "sm") : null,
        ]),
        el("div", { class: hook ? "yst-hook" : "yst-muted", text: hook || "No transcript, so no hook text." }),
      ]),
      el("div", { class: "yst-card yst-thumb-card" }, [
        el("img", { class: "yst-thumb", src: `https://i.ytimg.com/vi/${i.videoId}/hqdefault.jpg`, alt: "" }),
        el("div", { class: "yst-stack-sm" }, [
          el("div", { class: "yst-label", text: "Thumbnail" }),
          btn("⬇ Download (HD)", downloadThumb, "sm"),
        ]),
      ]),
      el("details", { class: "yst-card yst-desc" }, [
        el("summary", { class: "yst-label", text: `Description${i.description ? "" : " (empty)"}` }),
        i.description
          ? el("div", { class: "yst-stack-sm" }, [
              el("div", { class: "yst-pre", text: i.description }),
              btn("Copy description", () => copyBtnAction(i.description, "Description copied"), "sm"),
            ])
          : null,
      ]),
    ]);
  }

  async function downloadThumb() {
    const i = S.info;
    const r = await bg({ type: "download", url: i.thumbnail, filename: `${safeName(i.title)} - thumbnail.jpg` }).catch((e) => ({ ok: false, error: e.message }));
    toast(r?.ok ? "Thumbnail downloading ✓" : `Download failed: ${r?.error || "unknown error"}`);
  }

  // ---------- Tags ----------
  function tabTags() {
    const tags = S.info.tags;
    if (!tags.length) {
      return el("div", { class: "yst-card yst-center yst-muted", text: "No tags. The creator didn't add any in YouTube Studio (very common for Shorts)." });
    }
    const chars = tags.join(",").length;
    return el("div", { class: "yst-stack" }, [
      el("div", { class: "yst-row" }, [
        el("div", { class: "yst-muted", text: `${tags.length} tags · ${chars}/500 characters` }),
        btn("📋 Copy all", () => copyBtnAction(tags.join(", "), `${tags.length} tags copied`), "primary sm"),
      ]),
      el("div", { class: "yst-chips" }, tags.map((t) =>
        el("button", { class: "yst-chip", text: t, title: "Click to copy this tag", onclick: () => copyBtnAction(t, `“${t}” copied`) })
      )),
      el("div", { class: "yst-hint", text: "Tip: click a tag to copy just that one. “Copy all” pastes straight into the Studio tag box." }),
    ]);
  }

  // ---------- Transcript ----------
  function currentSegments() {
    return S.lang === "en" ? S.english?.segments || [] : S.info.segments;
  }

  function tabTranscript() {
    const i = S.info;
    if (!i.segments.length) {
      return el("div", { class: "yst-card yst-center yst-muted", text: i.transcriptError || "No transcript for this Short." });
    }
    const isEnglish = /^en/.test(i.langCode || "");
    const segs = currentSegments();
    const words = YST.asPlain(segs).split(" ").filter(Boolean).length;

    const seg = el("div", { class: "yst-seg" }, [
      el("button", { class: S.lang === "orig" ? "on" : "", text: i.lang || "Original", onclick: () => { S.lang = "orig"; render(); } }),
      isEnglish ? null : el("button", { class: S.lang === "en" ? "on" : "", text: "English", onclick: showEnglish }),
    ]);

    let content;
    if (S.lang === "en" && S.english?.loading) content = el("div", { class: "yst-muted yst-center", text: "Translating…" });
    else if (S.lang === "en" && S.english?.error) content = el("div", { class: "yst-muted yst-center", text: S.english.error });
    else {
      const hookCount = YST.hookSegments(segs).length;
      content = el("div", { class: "yst-transcript" }, S.withTimes
        ? segs.map((s, n) => el("div", { class: n < hookCount ? "yst-line hook" : "yst-line" }, [
            el("span", { class: "yst-ts", text: YST.fmtTime(s.start) }), s.text,
          ]))
        : [
            el("span", { class: "yst-hl", text: YST.asPlain(segs.slice(0, hookCount)) + " ", title: "Hook (first 3 seconds)" }),
            YST.asPlain(segs.slice(hookCount)),
          ]);
    }

    const text = () => (S.withTimes ? YST.asTimestamped(segs) : YST.asPlain(segs));
    const ready = segs.length > 0;
    return el("div", { class: "yst-stack" }, [
      el("div", { class: "yst-row" }, [
        seg,
        el("label", { class: "yst-switch" }, [
          el("input", { type: "checkbox", checked: S.withTimes, onchange: (e) => { S.withTimes = e.target.checked; render(); } }),
          " Timestamps",
        ]),
      ]),
      el("div", { class: "yst-row" }, [
        el("div", { class: "yst-muted", text: ready ? `${words} words · highlighted = hook` : "" }),
        el("div", { class: "yst-btns" }, ready ? [
          btn("📋 Copy", () => copyBtnAction(text(), "Transcript copied"), "primary sm"),
          btn("⬇ .txt", () => downloadText(`${safeName(i.title)}.txt`, `${i.title}\nhttps://www.youtube.com/shorts/${i.videoId}\n\nTAGS:\n${i.tags.join(", ") || "(none)"}\n\nTRANSCRIPT:\n${text()}\n`), "sm"),
          btn("⬇ .srt", () => downloadText(`${safeName(i.title)}.srt`, YST.toSrt(segs), "application/x-subrip"), "sm"),
        ] : []),
      ]),
      content,
    ]);
  }

  async function showEnglish() {
    S.lang = "en";
    if (!S.english || S.english.error) {
      S.english = { loading: true };
      render();
      const info = S.info;
      try {
        const { segments } = await ask("translate", { videoId: info.videoId, tlang: "en" });
        if (S?.info !== info) return;
        S.english = { segments };
        updateSavedCopy();
      } catch (e) {
        if (S?.info !== info) return;
        S.english = { error: e.message || "Translation failed." };
      }
    }
    render();
  }

  // ---------- Rewrite (Gemini) ----------
  function tabRewrite() {
    const r = S.rewrite;
    const kinds = Object.entries(YST.REWRITE_KINDS);
    const wrap = el("div", { class: "yst-stack" });

    YST.settings.get().then((st) => {
      if (!st.geminiKey) {
        wrap.textContent = "";
        wrap.appendChild(el("div", { class: "yst-card yst-center yst-stack-sm" }, [
          el("div", { class: "yst-label", text: "Connect Gemini first" }),
          el("div", { class: "yst-muted", text: "Add your Gemini API key once in Settings. It stays in your Chrome and is only sent to Google's Gemini API." }),
          btn("⚙️ Open Settings", () => bg({ type: "openLibrary", hash: "settings" }), "primary"),
        ]));
      }
    });

    wrap.appendChild(el("div", { class: "yst-seg yst-seg-full" }, kinds.map(([k, label]) =>
      el("button", { class: r.kind === k ? "on" : "", text: label, onclick: () => { r.kind = k; render(); } })
    )));

    if (r.kind === "script") {
      wrap.appendChild(el("div", { class: "yst-row" }, [
        el("span", { class: "yst-muted", text: "Length" }),
        el("div", { class: "yst-seg" }, ["30", "45", "60"].map((len) =>
          el("button", { class: String(r.length) === len ? "on" : "", text: `${len}s`, onclick: () => { r.length = len; render(); } })
        )),
      ]));
    }

    const notes = el("textarea", { class: "yst-input", rows: 2, placeholder: "Optional: extra instructions (e.g. make it funnier, add a twist at the end)" });
    notes.value = r.notes;
    notes.addEventListener("input", () => { r.notes = notes.value; });
    notes.addEventListener("keydown", (e) => e.stopPropagation()); // don't trigger YouTube shortcuts
    wrap.appendChild(notes);

    if (!S.info.segments.length) {
      wrap.appendChild(el("div", { class: "yst-hint", text: "This Short has no transcript, so Gemini will work from the title and tags only." }));
    }

    wrap.appendChild(btn(r.loading ? "✨ Writing…" : r.result ? "✨ Write again" : "✨ Write it", generate, "primary wide"));

    if (r.error) wrap.appendChild(el("div", { class: "yst-error", text: r.error }));
    if (r.result) {
      wrap.appendChild(el("div", { class: "yst-card yst-stack-sm" }, [
        el("div", { class: "yst-row" }, [
          el("div", { class: "yst-label", text: YST.REWRITE_KINDS[r.resultKind] || "Result" }),
          btn("📋 Copy", () => copyBtnAction(r.result, "Copied"), "sm"),
        ]),
        el("div", { class: "yst-pre", text: r.result }),
        el("div", { class: "yst-hint", text: "Saved to your Library with this Short." }),
      ]));
    }
    return wrap;
  }

  async function generate() {
    const r = S.rewrite;
    if (r.loading) return;
    const info = S.info;
    r.loading = true; r.error = "";
    render();
    try {
      const st = await YST.settings.get();
      if (!st.geminiKey) throw new Error("Add your Gemini API key in Settings first.");
      const item = itemFromState();
      const prompt = YST.buildPrompt({ kind: r.kind, item, length: r.length || st.length || "45", notes: r.notes, style: st.style || YST.DEFAULT_STYLE });
      const res = await bg({ type: "gemini", prompt });
      if (!res?.ok) throw new Error(res?.error || "Gemini didn't answer.");
      if (S?.info !== info) return;
      r.result = res.text; r.resultKind = r.kind;
      // Keep every rewrite with the Short in the Library.
      await YST.lib.save({ ...itemFromState(), rewrites: [{ at: Date.now(), kind: r.kind, model: res.model, text: res.text }] });
      S.saved = true;
    } catch (e) {
      if (S?.info === info) r.error = e.message || String(e);
    } finally {
      if (S?.info === info) { r.loading = false; render(); }
    }
  }

  // ---------- Save ----------
  async function toggleSave() {
    if (!S) return;
    if (S.saved) {
      await YST.lib.remove(S.info.videoId);
      S.saved = false;
      toast("Removed from Library");
    } else {
      await YST.lib.save(itemFromState());
      S.saved = true;
      toast("Saved to Library ★");
    }
    render();
  }

  // ---------- main action ----------
  async function run() {
    const videoId = getVideoId();
    if (!videoId) return toast("Open a Short or video first");
    if (busy) return;
    busy = true;
    setFab("⏳ Loading…", true);
    try {
      let info = infoCache.get(videoId);
      if (!info) {
        info = await ask("get", { videoId });
        infoCache.set(videoId, info);
      }
      openPanel(info);
      if (info.segments.length) {
        const ok = await copy(YST.asPlain(info.segments));
        toast(ok ? `Transcript copied ✓ · ${info.tags.length} tags` : "Ready");
      } else {
        toast(`No transcript · ${info.tags.length} tags`);
      }
    } catch (e) {
      console.error("[Shorts Kit]", e);
      toast(e.message || "Something went wrong");
    } finally {
      busy = false;
      setFab("⚡ Analyze Short", false);
    }
  }

  function setFab(text, disabled) {
    const b = document.getElementById("yst-fab");
    if (b) { b.textContent = text; b.disabled = disabled; }
  }

  function tick() {
    const vid = getVideoId();
    let fab = document.getElementById("yst-fab");
    if (vid && !fab) {
      fab = el("button", { id: "yst-fab", text: "⚡ Analyze Short", title: "Transcript, tags, stats & rewrite (Alt+T)", onclick: run });
      document.body.appendChild(fab);
    }
    if (fab) fab.style.display = vid ? "" : "none";
    // Swiped to another Short: keep the panel, but offer to analyze the new one.
    if (S && vid !== S.info.videoId && !S.stale) { S.stale = true; render(); }
    if (S && vid === S.info.videoId && S.stale) { S.stale = false; render(); }
    if (S && !vid) closePanel();
  }

  document.addEventListener("yt-navigate-finish", tick);
  setInterval(tick, 800);
  tick();

  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(e.target?.tagName) || e.target?.isContentEditable;
    if (e.altKey && (e.key === "t" || e.key === "T")) { e.preventDefault(); run(); }
    else if (e.altKey && (e.key === "s" || e.key === "S") && S) { e.preventDefault(); toggleSave(); }
    else if (e.key === "Escape" && S && !typing) closePanel();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "yst-run") run();
  });
})();
