// Library page: saved Shorts, tag insights, bulk grab from a channel, settings.
(() => {
  const { el } = YST;
  const $ = (id) => document.getElementById(id);

  let items = []; // saved Shorts
  let openId = null; // drawer

  // ---------- helpers ----------
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), 2400);
  }
  async function copy(text, what = "Copied") {
    try { await navigator.clipboard.writeText(text); toast(`${what} ✓`); } catch { toast("Copy failed"); }
  }
  function download(name, text, type) {
    const a = el("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const today = () => new Date().toISOString().slice(0, 10);
  function thumbImg(id) {
    return el("img", { src: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, alt: "", loading: "lazy" });
  }
  function badge(ratio) {
    const b = YST.outlierBadge(ratio);
    return b ? el("span", { class: `badge ${b.cls}`, text: `${b.label} ${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}×` }) : null;
  }
  function metaBit(label, value) {
    return el("span", {}, [label + " ", el("b", { text: value })]);
  }

  // ---------- routing ----------
  function route() {
    const view = (location.hash || "#library").slice(1);
    const known = ["library", "tags", "bulk", "settings"];
    const v = known.includes(view) ? view : "library";
    document.querySelectorAll(".view").forEach((s) => s.classList.toggle("on", s.id === `view-${v}`));
    document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("on", a.dataset.view === v));
    if (v !== "library") closeDrawer();
    if (v === "tags") renderTags();
    if (v === "settings") loadSettings();
  }
  window.addEventListener("hashchange", route);

  // ---------- data ----------
  async function reload() {
    items = await YST.lib.all();
    $("nav-count").textContent = items.length || "";
    fillChannelSelect($("lib-channel"));
    fillChannelSelect($("tags-channel"));
    renderLibrary();
    if (document.querySelector("#view-tags.on")) renderTags();
    if (openId) {
      const it = items.find((x) => x.id === openId);
      it ? openDrawer(it) : closeDrawer();
    }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.keys(changes).some((k) => k.startsWith("short:"))) reload();
  });

  function fillChannelSelect(sel) {
    const cur = sel.value;
    const counts = {};
    for (const it of items) counts[it.channel || "Unknown"] = (counts[it.channel || "Unknown"] || 0) + 1;
    sel.textContent = "";
    sel.appendChild(el("option", { value: "", text: `All channels (${items.length})` }));
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([ch, n]) => sel.appendChild(el("option", { value: ch, text: `${ch} (${n})` })));
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "";
  }

  // ---------- LIBRARY ----------
  function filtered() {
    const q = $("lib-search").value.trim().toLowerCase();
    const ch = $("lib-channel").value;
    const sort = $("lib-sort").value;
    let list = items.filter((it) => (!ch || (it.channel || "Unknown") === ch));
    if (q) {
      list = list.filter((it) =>
        [it.title, it.channel, (it.tags || []).join(" "), it.transcript, it.transcriptEnglish, it.description]
          .join(" ").toLowerCase().includes(q)
      );
    }
    const key = {
      saved: (it) => it.savedAt || 0,
      views: (it) => it.views || 0,
      vpd: (it) => it.viewsPerDay || 0,
      outlier: (it) => it.outlier || 0,
      published: (it) => new Date(it.publishDate || 0).getTime() || 0,
    }[sort];
    return list.sort((a, b) => key(b) - key(a));
  }

  function renderLibrary() {
    const box = $("lib-list");
    box.textContent = "";
    if (!items.length) {
      box.appendChild(el("div", { class: "empty" }, [
        el("b", { text: "No saved Shorts yet" }),
        "Open any Short on YouTube, click ⚡ Analyze Short, then ★ to save it. Or pull a whole channel from ",
        el("a", { href: "#bulk", text: "Bulk grab" }), ".",
      ]));
      return;
    }
    const list = filtered();
    if (!list.length) {
      box.appendChild(el("div", { class: "empty", text: "Nothing matches your search." }));
      return;
    }
    for (const it of list) {
      box.appendChild(el("div", { class: `item nocheck ${openId === it.id ? "sel" : ""}`, onclick: () => openDrawer(it) }, [
        thumbImg(it.id),
        el("div", {}, [
          el("div", { class: "item-title", text: it.title }),
          el("div", { class: "item-meta" }, [
            el("span", { text: it.channel || "" }),
            metaBit("👁", YST.fmtNum(it.views)),
            metaBit("📈", `${YST.fmtNum(it.viewsPerDay)}/day`),
            it.publishDate ? el("span", { text: YST.ago(it.publishDate) }) : null,
            it.outlier ? badge(it.outlier) : null,
            el("span", { class: `pill ${it.transcript ? "ok" : ""}`, text: it.transcript ? "Transcript ✓" : "No transcript" }),
            it.rewrites?.length ? el("span", { class: "pill ok", text: `✨ ${it.rewrites.length}` }) : null,
          ]),
          el("div", { class: "item-tags", text: it.tags?.length ? `🏷️ ${it.tags.join(", ")}` : "🏷️ no tags" }),
        ]),
        el("button", {
          class: "b ghost sm", text: "🗑", title: "Delete",
          onclick: async (e) => { e.stopPropagation(); await YST.lib.remove(it.id); toast("Deleted"); },
        }),
      ]));
    }
  }
  ["lib-search", "lib-channel", "lib-sort"].forEach((id) => $(id).addEventListener("input", renderLibrary));

  $("lib-export").addEventListener("click", () => {
    const list = filtered();
    if (!list.length) return toast("Nothing to export");
    download(`shorts-library-${today()}.csv`, YST.csv([YST.CSV_HEADER, ...list.map(YST.csvRow)]), "text/csv;charset=utf-8");
  });
  $("lib-backup").addEventListener("click", () => {
    download(`shorts-library-backup-${today()}.json`, JSON.stringify({ version: 1, items }, null, 2), "application/json");
  });
  $("lib-import").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const list = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(list)) throw new Error("Not a backup file");
      let n = 0;
      for (const it of list) if (it && it.id) { await YST.lib.save(it); n++; }
      toast(`Restored ${n} Shorts`);
    } catch (err) {
      toast(`Restore failed: ${err.message}`);
    }
    e.target.value = "";
  });

  // ---------- detail drawer ----------
  function closeDrawer() {
    openId = null;
    $("drawer").hidden = true;
    document.querySelectorAll(".item.sel").forEach((n) => n.classList.remove("sel"));
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  function openDrawer(it) {
    openId = it.id;
    document.querySelectorAll("#lib-list .item").forEach((n) => n.classList.remove("sel"));
    const d = $("drawer");
    d.textContent = "";
    d.hidden = false;
    let lang = "orig";

    const transcriptBox = el("div", { class: "pre" });
    const segBox = el("div", { class: "seg" });
    function paintTranscript() {
      const text = lang === "en" ? it.transcriptEnglish : it.transcript;
      transcriptBox.textContent = text || "(none)";
      segBox.textContent = "";
      segBox.appendChild(el("button", { class: lang === "orig" ? "on" : "", text: it.lang || "Original", onclick: () => { lang = "orig"; paintTranscript(); } }));
      if (it.transcriptEnglish) segBox.appendChild(el("button", { class: lang === "en" ? "on" : "", text: "English", onclick: () => { lang = "en"; paintTranscript(); } }));
    }
    paintTranscript();

    d.append(...[
      el("div", { class: "drawer-top" }, [
        el("div", {}, [
          el("h2", { text: it.title }),
          el("div", { class: "muted" }, [
            it.channel || "", " · ",
            el("a", { href: it.url || `https://www.youtube.com/shorts/${it.id}`, target: "_blank", rel: "noopener", text: "Open on YouTube ↗" }),
          ]),
        ]),
        el("button", { class: "b ghost", text: "✕", title: "Close (Esc)", onclick: closeDrawer }),
      ]),
      el("div", { class: "stats" }, [
        el("div", { class: "stat" }, [el("small", { text: "Views" }), el("b", { text: YST.fmtNum(it.views) })]),
        el("div", { class: "stat" }, [el("small", { text: "Views / day" }), el("b", { text: YST.fmtNum(it.viewsPerDay) })]),
        el("div", { class: "stat" }, [el("small", { text: "Uploaded" }), el("b", { text: YST.fmtDate(it.publishDate) })]),
        el("div", { class: "stat" }, [el("small", { text: "Length" }), el("b", { text: it.lengthSeconds ? `${it.lengthSeconds}s` : "–" })]),
      ]),
      it.outlier ? el("div", { class: "muted" }, [badge(it.outlier), ` vs channel's typical Short (${YST.fmtNum(it.channelMedian)} views)`]) : null,
      el("div", { class: "section" }, [
        el("div", { class: "section-head" }, [
          `🏷️ Tags (${(it.tags || []).length})`,
          it.tags?.length ? el("button", { class: "b sm", text: "📋 Copy all", onclick: () => copy(it.tags.join(", "), "Tags copied") }) : null,
        ]),
        it.tags?.length
          ? el("div", { class: "chips" }, it.tags.map((t) => el("button", { class: "chip", text: t, onclick: () => copy(t, `“${t}” copied`) })))
          : el("div", { class: "muted", text: "No tags." }),
      ]),
      it.hook ? el("div", { class: "section" }, [
        el("div", { class: "section-head" }, ["🎣 Hook (first 3s)", el("button", { class: "b sm", text: "Copy", onclick: () => copy(it.hook, "Hook copied") })]),
        el("div", { class: "hook", text: it.hook }),
      ]) : null,
      el("div", { class: "section" }, [
        el("div", { class: "section-head" }, [
          el("span", {}, ["📝 Transcript ", segBox]),
          it.transcript ? el("button", { class: "b sm", text: "📋 Copy", onclick: () => copy(lang === "en" ? it.transcriptEnglish : it.transcript, "Transcript copied") }) : null,
        ]),
        it.transcript ? transcriptBox : el("div", { class: "muted", text: "No transcript saved. Open the Short and click ⚡ Analyze Short, then ★ to add it." }),
      ]),
      it.rewrites?.length ? el("div", { class: "section" }, [
        el("div", { class: "section-head", text: `✨ Rewrites (${it.rewrites.length})` }),
        ...[...it.rewrites].reverse().map((r) => el("div", { class: "rewrite" }, [
          el("div", { class: "section-head" }, [
            el("span", { class: "muted", text: `${YST.REWRITE_KINDS[r.kind] || r.kind} · ${new Date(r.at).toLocaleString()}` }),
            el("button", { class: "b sm", text: "📋 Copy", onclick: () => copy(r.text) }),
          ]),
          el("div", { class: "pre", text: r.text }),
        ])),
      ]) : null,
      it.description ? el("details", { class: "section" }, [
        el("summary", { class: "section-head", text: "Description" }),
        el("div", { class: "pre", text: it.description }),
      ]) : null,
      el("div", { class: "row" }, [
        el("button", { class: "b", text: "🗑 Delete from Library", onclick: async () => { await YST.lib.remove(it.id); closeDrawer(); toast("Deleted"); } }),
      ]),
    ].filter(Boolean));
    renderLibrary();
  }

  // ---------- TAG INSIGHTS ----------
  const picked = new Set();
  let tagRows = [];

  function renderTags() {
    const ch = $("tags-channel").value;
    const onlyOut = $("tags-outliers").checked;
    const pool = items.filter((it) => (!ch || (it.channel || "Unknown") === ch) && (!onlyOut || (it.outlier || 0) >= 1.5));
    const map = new Map();
    for (const it of pool) {
      const seen = new Set();
      for (const raw of it.tags || []) {
        const key = raw.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const row = map.get(key) || { tag: raw.trim(), count: 0, views: [], channels: new Set() };
        row.count++;
        if (it.views) row.views.push(it.views);
        row.channels.add(it.channel || "Unknown");
        map.set(key, row);
      }
    }
    tagRows = [...map.values()].sort((a, b) => b.count - a.count || YST.median(b.views) - YST.median(a.views));
    const box = $("tags-table");
    box.textContent = "";
    if (!tagRows.length) {
      box.appendChild(el("div", { class: "empty" }, [
        el("b", { text: "No tags to analyze yet" }),
        pool.length ? "None of these Shorts have tags." : "Save some Shorts first (★ in the panel, or Bulk grab a channel).",
      ]));
      updatePicked();
      return;
    }
    const max = tagRows[0].count;
    box.appendChild(el("table", {}, [
      el("thead", {}, [el("tr", {}, ["", "Tag", "Used in", "", "Channels", "Median views"].map((h) => el("th", { text: h })))]),
      el("tbody", {}, tagRows.slice(0, 300).map((r) => {
        const tr = el("tr", { class: picked.has(r.tag) ? "sel" : "" }, [
          el("td", {}, [el("input", { type: "checkbox", checked: picked.has(r.tag), onclick: (e) => e.stopPropagation(), onchange: () => togglePick(r.tag) })]),
          el("td", { text: r.tag }),
          el("td", { class: "num", text: `${r.count} of ${pool.length}` }),
          el("td", {}, [el("div", { class: "bar" }, [el("i", { style: `width:${Math.round((r.count / max) * 100)}%` })])]),
          el("td", { class: "num", text: String(r.channels.size) }),
          el("td", { class: "num", text: YST.fmtNum(YST.median(r.views)) }),
        ]);
        tr.addEventListener("click", () => togglePick(r.tag));
        return tr;
      })),
    ]));
    updatePicked();
  }
  function togglePick(tag) {
    picked.has(tag) ? picked.delete(tag) : picked.add(tag);
    renderTags();
  }
  function updatePicked() {
    const list = [...picked];
    const chars = list.join(",").length;
    $("tags-picked").textContent = list.length ? `${list.length} selected · ${chars}/500 characters${chars > 500 ? " ⚠️ over YouTube's limit" : ""}` : "Click tags to select them.";
  }
  $("tags-channel").addEventListener("input", renderTags);
  $("tags-outliers").addEventListener("change", renderTags);
  $("tags-top").addEventListener("click", () => { picked.clear(); tagRows.slice(0, 15).forEach((r) => picked.add(r.tag)); renderTags(); });
  $("tags-clear").addEventListener("click", () => { picked.clear(); renderTags(); });
  $("tags-copy").addEventListener("click", () => picked.size ? copy([...picked].join(", "), `${picked.size} tags copied`) : toast("Select some tags first"));

  // ---------- BULK GRAB ----------
  const YT = "https://www.youtube.com";
  const bulk = { shorts: [], selected: new Set(), next: null, clientVersion: "", busy: false, channel: "" };

  function readJsonObject(str, start) {
    if (start < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < str.length; i++) {
      const ch = str[i];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; }
      else if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) return JSON.parse(str.slice(start, i + 1));
    }
    return null;
  }
  const jsonAfter = (html, marker) => { const i = html.indexOf(marker); return i === -1 ? null : readJsonObject(html, html.indexOf("{", i)); };
  function findAll(o, key, acc = []) {
    if (!o || typeof o !== "object") return acc;
    if (Array.isArray(o)) { for (const v of o) findAll(v, key, acc); return acc; }
    for (const [k, v] of Object.entries(o)) { if (k === key) acc.push(v); else findAll(v, key, acc); }
    return acc;
  }
  function lockups(data) {
    return findAll(data, "shortsLockupViewModel").map((l) => ({
      id: l.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId,
      title: l.overlayMetadata?.primaryText?.content || "",
      views: YST.parseViews(l.overlayMetadata?.secondaryText?.content),
    })).filter((s) => s.id);
  }
  // Only the Shorts grid's "load more" token (the page has other, unrelated ones).
  function nextToken(data) {
    const items = data?.onResponseReceivedActions
      ? findAll(data.onResponseReceivedActions, "continuationItems")[0]
      : findAll(data?.contents, "richGridRenderer")[0]?.contents;
    const cont = (items || []).find((x) => x.continuationItemRenderer);
    return cont?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || null;
  }
  function channelPath(input) {
    const s = input.trim();
    if (!s) return null;
    let m = s.match(/youtube\.com\/((?:@[^/?#\s]+)|(?:channel\/[\w-]+)|(?:c\/[^/?#\s]+)|(?:user\/[^/?#\s]+))/i);
    if (m) return m[1];
    if (/^@[\w.\-·]+$/.test(s)) return s;
    if (/^UC[\w-]{20,}$/.test(s)) return `channel/${s}`;
    if (/^[\w.\-]+$/.test(s)) return `@${s}`;
    return null;
  }
  function setStatus(text, pct) {
    const box = $("bulk-status");
    box.textContent = "";
    if (text) box.appendChild(el("div", { text }));
    if (pct !== undefined) box.appendChild(el("div", { class: "progress" }, [el("i", { style: `width:${Math.round(pct * 100)}%` })]));
  }

  $("bulk-channel").addEventListener("keydown", (e) => { if (e.key === "Enter") findShorts(); });
  $("bulk-find").addEventListener("click", findShorts);

  async function findShorts() {
    const path = channelPath($("bulk-channel").value);
    if (!path) return toast("Paste a channel link or @handle");
    if (bulk.busy) return;
    bulk.busy = true;
    setStatus("Finding Shorts…");
    try {
      const html = await (await fetch(`${YT}/${path}/shorts?hl=en`, { credentials: "include" })).text();
      const data = jsonAfter(html, "var ytInitialData = ");
      if (!data) throw new Error("Couldn't read that channel. Check the link.");
      bulk.clientVersion = (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1] || "";
      bulk.channel = data.metadata?.channelMetadataRenderer?.title || path;
      bulk.shorts = lockups(data).map((s) => ({ ...s, channel: bulk.channel }));
      bulk.next = nextToken(data);
      bulk.selected = new Set(bulk.shorts.map((s) => s.id));
      if (!bulk.shorts.length) throw new Error("No Shorts found on that channel.");
      setStatus(`${bulk.channel}: found ${bulk.shorts.length} Shorts. Pick the ones you want, then “Get tags & stats”.`);
    } catch (e) {
      bulk.shorts = [];
      setStatus(`❌ ${e.message}`);
    } finally {
      bulk.busy = false;
      renderBulk();
    }
  }

  $("bulk-more").addEventListener("click", async () => {
    if (!bulk.next || bulk.busy) return;
    bulk.busy = true;
    setStatus("Loading more Shorts…");
    try {
      const r = await fetch(`${YT}/youtubei/v1/browse?prettyPrint=false`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: bulk.clientVersion, hl: "en" } }, continuation: bulk.next }),
      });
      if (!r.ok) throw new Error(`YouTube said ${r.status}`);
      const data = await r.json();
      const more = lockups(data).filter((s) => !bulk.shorts.some((x) => x.id === s.id)).map((s) => ({ ...s, channel: bulk.channel }));
      bulk.shorts.push(...more);
      if ($("bulk-all").checked) more.forEach((s) => bulk.selected.add(s.id));
      bulk.next = nextToken(data);
      setStatus(`${bulk.channel}: ${bulk.shorts.length} Shorts loaded.`);
    } catch (e) {
      setStatus(`Couldn't load more: ${e.message}`);
    } finally {
      bulk.busy = false;
      renderBulk();
    }
  });

  $("bulk-all").addEventListener("change", (e) => {
    bulk.selected = e.target.checked ? new Set(bulk.shorts.map((s) => s.id)) : new Set();
    renderBulk();
  });

  async function fetchDetails(id) {
    const html = await (await fetch(`${YT}/watch?v=${id}&hl=en`, { credentials: "include" })).text();
    const pr = jsonAfter(html, "ytInitialPlayerResponse = ");
    const vd = pr?.videoDetails || {};
    const mf = pr?.microformat?.playerMicroformatRenderer || {};
    if (vd.videoId !== id) throw new Error("no data");
    return {
      title: vd.title, channel: vd.author, channelId: vd.channelId,
      views: vd.viewCount ? Number(vd.viewCount) : null,
      lengthSeconds: vd.lengthSeconds ? Number(vd.lengthSeconds) : null,
      publishDate: mf.publishDate || mf.uploadDate || "",
      category: mf.category || "",
      tags: Array.isArray(vd.keywords) ? vd.keywords : [],
      description: vd.shortDescription || "",
      handle: (mf.ownerProfileUrl || "").match(/\/(@[^/?]+)/)?.[1] || "",
      detailed: true,
    };
  }

  $("bulk-details").addEventListener("click", async () => {
    const todo = bulk.shorts.filter((s) => bulk.selected.has(s.id) && !s.detailed);
    if (!todo.length) return toast(bulk.selected.size ? "Already done for the selected Shorts" : "Select some Shorts first");
    if (bulk.busy) return;
    bulk.busy = true;
    let done = 0, failed = 0;
    setStatus(`Getting tags & stats… 0/${todo.length}`, 0);
    const queue = [...todo];
    async function worker() {
      while (queue.length) {
        const s = queue.shift();
        try { Object.assign(s, await fetchDetails(s.id)); } catch { failed++; }
        done++;
        setStatus(`Getting tags & stats… ${done}/${todo.length}`, done / todo.length);
        await new Promise((r) => setTimeout(r, 250)); // be gentle with YouTube
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    // Outlier score vs the median of this channel's loaded Shorts
    const med = YST.median(bulk.shorts.map((s) => s.views));
    for (const s of bulk.shorts) {
      s.viewsPerDay = YST.viewsPerDay(s.views, s.publishDate);
      s.outlier = med && s.views !== null ? s.views / med : null;
      s.channelMedian = med;
    }
    bulk.busy = false;
    setStatus(`Done: ${done - failed} Shorts updated${failed ? `, ${failed} failed` : ""}.`);
    renderBulk();
  });

  function bulkItem(s) {
    return {
      id: s.id, url: `https://www.youtube.com/shorts/${s.id}`, title: s.title, channel: s.channel, channelId: s.channelId, handle: s.handle,
      views: s.views, viewsPerDay: s.viewsPerDay ?? null, publishDate: s.publishDate || "", lengthSeconds: s.lengthSeconds ?? null,
      category: s.category || "", tags: s.tags || [], description: s.description || "",
      outlier: s.outlier ?? null, channelMedian: s.channelMedian ?? null, source: "bulk",
    };
  }

  $("bulk-save").addEventListener("click", async () => {
    const list = bulk.shorts.filter((s) => bulk.selected.has(s.id));
    if (!list.length) return toast("Select some Shorts first");
    for (const s of list) await YST.lib.save(bulkItem(s));
    const noDetails = list.filter((s) => !s.detailed).length;
    toast(`Saved ${list.length} Shorts${noDetails ? ` (${noDetails} without tags — run “Get tags & stats” first)` : ""}`);
  });

  $("bulk-export").addEventListener("click", () => {
    const list = bulk.shorts.filter((s) => bulk.selected.has(s.id));
    if (!list.length) return toast("Select some Shorts first");
    const name = (bulk.channel || "channel").replace(/[^\w@-]+/g, "_");
    download(`${name}-shorts-${today()}.csv`, YST.csv([YST.CSV_HEADER, ...list.map((s) => YST.csvRow(bulkItem(s)))]), "text/csv;charset=utf-8");
  });

  function renderBulk() {
    const box = $("bulk-list");
    box.textContent = "";
    $("bulk-actions").hidden = !bulk.shorts.length;
    $("bulk-more").disabled = !bulk.next;
    $("bulk-picked").textContent = `${bulk.selected.size} of ${bulk.shorts.length} selected`;
    const savedIds = new Set(items.map((i) => i.id));
    const list = [...bulk.shorts].sort((a, b) => (b.views || 0) - (a.views || 0));
    for (const s of list) {
      const cb = el("input", { type: "checkbox", checked: bulk.selected.has(s.id) });
      const toggle = () => {
        bulk.selected.has(s.id) ? bulk.selected.delete(s.id) : bulk.selected.add(s.id);
        cb.checked = bulk.selected.has(s.id);
        $("bulk-picked").textContent = `${bulk.selected.size} of ${bulk.shorts.length} selected`;
      };
      cb.addEventListener("click", (e) => { e.stopPropagation(); });
      cb.addEventListener("change", () => { toggle(); cb.checked = bulk.selected.has(s.id); });
      box.appendChild(el("div", { class: "item", onclick: (e) => { toggle(); } }, [
        cb,
        thumbImg(s.id),
        el("div", {}, [
          el("div", { class: "item-title", text: s.title }),
          el("div", { class: "item-meta" }, [
            metaBit("👁", YST.fmtNum(s.views)),
            s.detailed ? metaBit("📈", `${YST.fmtNum(s.viewsPerDay)}/day`) : null,
            s.publishDate ? el("span", { text: YST.ago(s.publishDate) }) : null,
            s.outlier ? badge(s.outlier) : null,
            savedIds.has(s.id) ? el("span", { class: "pill ok", text: "★ in Library" }) : null,
          ]),
          el("div", { class: "item-tags", text: s.detailed ? (s.tags.length ? `🏷️ ${s.tags.join(", ")}` : "🏷️ no tags") : "🏷️ tags not loaded yet" }),
        ]),
        el("a", { class: "b ghost sm", href: `https://www.youtube.com/shorts/${s.id}`, target: "_blank", rel: "noopener", text: "↗", title: "Open on YouTube", onclick: (e) => e.stopPropagation() }),
      ]));
    }
  }

  // ---------- SETTINGS ----------
  async function loadSettings() {
    const st = await YST.settings.get();
    $("set-key").value = st.geminiKey || "";
    $("set-style").value = st.style || YST.DEFAULT_STYLE;
    $("set-length").value = st.length || "45";
    const sel = $("set-model");
    if (st.model && ![...sel.options].some((o) => o.value === st.model)) sel.appendChild(el("option", { value: st.model, text: st.model }));
    sel.value = st.model || "";
  }
  $("set-show").addEventListener("click", () => {
    const k = $("set-key");
    k.type = k.type === "password" ? "text" : "password";
    $("set-show").textContent = k.type === "password" ? "Show" : "Hide";
  });
  $("set-style-reset").addEventListener("click", (e) => { e.preventDefault(); $("set-style").value = YST.DEFAULT_STYLE; });
  $("set-check").addEventListener("click", async () => {
    const key = $("set-key").value.trim();
    const msg = $("set-check-msg");
    if (!key) { msg.textContent = "Paste your key first."; return; }
    msg.textContent = "Checking…";
    try {
      const models = await YST.geminiModels(key);
      if (!models.length) throw new Error("This key can't use any Gemini text models.");
      const sel = $("set-model");
      const cur = sel.value;
      sel.textContent = "";
      sel.appendChild(el("option", { value: "", text: `Auto (${YST.pickDefaultModel(models)})` }));
      models.forEach((m) => sel.appendChild(el("option", { value: m.id, text: `${m.label} (${m.id})` })));
      sel.value = models.some((m) => m.id === cur) ? cur : "";
      msg.textContent = `✅ Key works. ${models.length} models available. Don't forget to Save.`;
    } catch (e) {
      msg.textContent = `❌ ${e.message}`;
    }
  });
  $("set-save").addEventListener("click", async () => {
    await YST.settings.set({
      geminiKey: $("set-key").value.trim(),
      model: $("set-model").value,
      style: $("set-style").value.trim() || YST.DEFAULT_STYLE,
      length: $("set-length").value,
    });
    $("set-msg").textContent = "Saved ✓";
    setTimeout(() => ($("set-msg").textContent = ""), 2500);
  });
  $("set-wipe").addEventListener("click", async () => {
    if (!items.length) return toast("Library is already empty");
    if (!confirm(`Delete all ${items.length} saved Shorts? This can't be undone (unless you made a Backup).`)) return;
    for (const it of items) await YST.lib.remove(it.id);
    toast("Library cleared");
  });

  // ---------- start ----------
  reload().then(route);
})();
