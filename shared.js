// Shared helpers for the on-page panel (content.js), the Library page and the
// background worker. Nothing here touches the page when it loads.

/* eslint-disable no-var */
var YST = (function () {
  // ---------- DOM ----------
  // Build elements without innerHTML (YouTube enforces Trusted Types).
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "style") node.setAttribute("style", v);
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (k in node && typeof v !== "string") node[k] = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of [].concat(children)) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  // ---------- numbers & dates ----------
  function fmtNum(n) {
    if (n === null || n === undefined || isNaN(n)) return "–";
    n = Number(n);
    if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, "") + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
    return String(Math.round(n));
  }

  // "1.8K views" / "964 views" / "2.3M views" -> number
  function parseViews(s) {
    if (!s) return null;
    const m = String(s).replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
    if (!m) return null;
    const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase()] || 1;
    return Math.round(parseFloat(m[1]) * mult);
  }

  function daysSince(dateStr) {
    if (!dateStr) return null;
    const t = new Date(dateStr).getTime();
    if (isNaN(t)) return null;
    return Math.max((Date.now() - t) / 86400000, 0);
  }

  function ago(dateStr) {
    const d = daysSince(dateStr);
    if (d === null) return "";
    if (d < 1) {
      const h = Math.floor(d * 24);
      return h <= 1 ? "just now" : `${h} hours ago`;
    }
    if (d < 2) return "1 day ago";
    if (d < 30) return `${Math.floor(d)} days ago`;
    if (d < 365) return `${Math.floor(d / 30)} months ago`;
    return `${(d / 365).toFixed(1).replace(/\.0$/, "")} years ago`;
  }

  function fmtDate(dateStr) {
    if (!dateStr) return "–";
    const d = new Date(dateStr);
    return isNaN(d) ? "–" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  function viewsPerDay(views, publishDate) {
    const d = daysSince(publishDate);
    if (views === null || views === undefined || d === null) return null;
    return views / Math.max(d, 1);
  }

  function median(nums) {
    const a = nums.filter((n) => typeof n === "number" && !isNaN(n)).sort((x, y) => x - y);
    if (!a.length) return null;
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  // How this Short did vs the channel's typical Short.
  function outlierBadge(ratio) {
    if (ratio === null || ratio === undefined || !isFinite(ratio)) return null;
    if (ratio >= 3) return { label: "🔥 Outlier", cls: "hot" };
    if (ratio >= 1.5) return { label: "📈 Above average", cls: "up" };
    if (ratio >= 0.6) return { label: "➖ Normal", cls: "flat" };
    return { label: "📉 Below average", cls: "down" };
  }

  // ---------- transcript formats ----------
  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  function asPlain(segments) {
    return segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
  }
  function asTimestamped(segments) {
    return segments.map((s) => `[${fmtTime(s.start)}] ${s.text}`).join("\n");
  }
  function srtTime(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const r = Math.floor(ms % 1000);
    const p = (n, w = 2) => String(n).padStart(w, "0");
    return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
  }
  function toSrt(segments) {
    return segments
      .map((s, i) => {
        const next = segments[i + 1];
        let end = s.start + (s.dur || 2000);
        if (next && end > next.start) end = next.start;
        return `${i + 1}\n${srtTime(s.start)} --> ${srtTime(end)}\n${s.text}\n`;
      })
      .join("\n");
  }
  // The hook = what's said in roughly the first 3 seconds.
  function hookSegments(segments) {
    if (!segments.length) return [];
    const within = segments.filter((s) => s.start < 3000);
    return within.length ? within : [segments[0]];
  }
  function hookOf(segments) {
    return asPlain(hookSegments(segments));
  }

  // ---------- storage (chrome.storage.local) ----------
  const KEY_PREFIX = "short:";
  const lib = {
    async all() {
      const data = await chrome.storage.local.get(null);
      return Object.entries(data)
        .filter(([k]) => k.startsWith(KEY_PREFIX))
        .map(([, v]) => v);
    },
    async get(id) {
      const k = KEY_PREFIX + id;
      return (await chrome.storage.local.get(k))[k] || null;
    },
    async save(item) {
      const old = await lib.get(item.id);
      const merged = { ...(old || {}), ...item, savedAt: old?.savedAt || Date.now(), updatedAt: Date.now() };
      // Never wipe a transcript/rewrites we already had with an empty one (e.g. bulk re-grab).
      if (old?.transcript && !item.transcript) {
        merged.transcript = old.transcript;
        merged.transcriptTimed = old.transcriptTimed;
        merged.transcriptEnglish = old.transcriptEnglish;
        merged.hook = old.hook;
        merged.lang = old.lang;
      }
      merged.rewrites = [...(old?.rewrites || []), ...(item.rewrites || [])].filter(
        (r, i, a) => a.findIndex((x) => x.at === r.at) === i
      );
      await chrome.storage.local.set({ [KEY_PREFIX + item.id]: merged });
      return merged;
    },
    async remove(id) {
      await chrome.storage.local.remove(KEY_PREFIX + id);
    },
    async has(id) {
      return !!(await lib.get(id));
    },
  };

  const DEFAULT_STYLE =
    "Write in the same language and tone as the reference Short, casual and energetic, " +
    "talking directly to the viewer. Shorts are 30-60 seconds, open with a strong hook in " +
    "the first 2 seconds, use short punchy sentences, and end with a reason to follow or " +
    "watch the next video. (Edit this in Settings to describe your own channel.)";

  const settings = {
    async get() {
      const s = (await chrome.storage.local.get("settings")).settings || {};
      return { geminiKey: "", model: "", style: DEFAULT_STYLE, length: "45", ...s };
    },
    async set(patch) {
      const cur = await settings.get();
      const next = { ...cur, ...patch };
      await chrome.storage.local.set({ settings: next });
      return next;
    },
  };

  // ---------- CSV ----------
  function csv(rows) {
    const esc = (v) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    // BOM so Excel opens Hindi/emoji correctly
    return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  }

  const CSV_HEADER = [
    "Title", "URL", "Channel", "Views", "Views/day", "Vs channel median", "Published",
    "Length (s)", "Tags", "Hook", "Transcript", "Transcript (English)", "Latest rewrite", "Saved",
  ];
  function csvRow(it) {
    const last = (it.rewrites || []).slice(-1)[0];
    return [
      it.title, it.url || `https://www.youtube.com/shorts/${it.id}`, it.channel, it.views,
      it.viewsPerDay ? Math.round(it.viewsPerDay) : "",
      it.outlier ? `${it.outlier.toFixed(1)}x` : "",
      it.publishDate ? it.publishDate.slice(0, 10) : "", it.lengthSeconds,
      (it.tags || []).join(", "), it.hook || "", it.transcript || "", it.transcriptEnglish || "",
      last ? last.text : "", it.savedAt ? new Date(it.savedAt).toISOString().slice(0, 10) : "",
    ];
  }

  // ---------- Gemini ----------
  const GEMINI = "https://generativelanguage.googleapis.com/v1beta";

  async function geminiModels(key) {
    const r = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `Gemini error ${r.status}`);
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => ({ id: m.name.replace(/^models\//, ""), label: m.displayName || m.name }))
      .filter((m) => /^gemini/i.test(m.id) && !/(image|tts|audio|live|embedding|vision)/i.test(m.id));
  }

  // Pick a fast, current text model if the user hasn't chosen one.
  function pickDefaultModel(models) {
    const score = (id) => {
      const ver = parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
      let s = ver * 10;
      if (/flash/.test(id)) s += 5;
      if (/lite/.test(id)) s -= 3;
      if (/(preview|exp|latest)/.test(id)) s -= 1;
      return s;
    };
    return [...models].sort((a, b) => score(b.id) - score(a.id))[0]?.id || "";
  }

  async function geminiGenerate({ key, model, prompt }) {
    const r = await fetch(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9 },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `Gemini error ${r.status}`);
    const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
    if (!text) {
      const why = j.promptFeedback?.blockReason || j.candidates?.[0]?.finishReason || "empty answer";
      throw new Error(`Gemini returned nothing (${why}). Try again.`);
    }
    return text;
  }

  const REWRITE_KINDS = {
    script: "Full Short script",
    hooks: "5 hook ideas",
    titles: "Titles + tags",
  };

  function buildPrompt({ kind, item, length, notes, style }) {
    const src = [
      `TITLE: ${item.title || ""}`,
      `CHANNEL: ${item.channel || ""}`,
      item.views ? `VIEWS: ${item.views}` : "",
      item.tags?.length ? `TAGS: ${item.tags.join(", ")}` : "",
      `TRANSCRIPT:\n${item.transcriptForAI || item.transcript || "(no transcript)"}`,
    ].filter(Boolean).join("\n");

    const task = {
      script:
        `Rewrite this into an ORIGINAL ${length}-second YouTube Short script for my channel. ` +
        `Keep what made it work (the idea, the hook style, the pacing) but do not copy sentences. ` +
        `Format:\nHOOK (0-2s): ...\nSCRIPT: the spoken lines, short punchy sentences, with [ON-SCREEN: ...] notes where useful\n` +
        `ENDING: an open loop pointing to the full video\nThen give 3 TITLE ideas and 10 TAGS (comma-separated).`,
      hooks:
        `Write 5 different opening hooks (first 2 seconds, max 12 words each) for my own Short on the same topic. ` +
        `Use different styles: question, shock fact, challenge, "you didn't know", countdown. Number them.`,
      titles:
        `Write 8 Short titles (under 60 characters, curiosity-driven, can include 1 emoji) and 15 YouTube Studio tags ` +
        `(comma-separated, most important first) for my own Short on this topic.`,
    }[kind];

    return [
      `You write YouTube Shorts for this channel:\n${style}`,
      `Here is the reference Short to learn from:\n---\n${src}\n---`,
      task,
      notes ? `Extra instructions: ${notes}` : "",
      `Reply with just the result, no intro.`,
    ].filter(Boolean).join("\n\n");
  }

  return {
    el, fmtNum, parseViews, daysSince, ago, fmtDate, viewsPerDay, median, outlierBadge,
    fmtTime, asPlain, asTimestamped, toSrt, hookSegments, hookOf,
    lib, settings, DEFAULT_STYLE, csv, CSV_HEADER, csvRow,
    geminiModels, pickDefaultModel, geminiGenerate, buildPrompt, REWRITE_KINDS,
  };
})();
