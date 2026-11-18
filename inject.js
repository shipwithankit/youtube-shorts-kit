// Runs in the page's own JS world (manifest: "world": "MAIN"), where the YouTube
// player lives. It answers requests from content.js via window.postMessage.
//
// Transcript: YouTube only serves caption files to its own player (the URL carries a
// one-time token). So we let the player load captions — exactly what pressing CC
// does — note the URL it used, and read the same file. The viewer's CC setting is
// restored afterwards.
// Tags & stats: read from the player's data ("videoDetails" / "microformat"), with the
// video's watch page as a backup when the player only has a slimmed-down copy.

(() => {
  if (window.__ystInject) return;
  window.__ystInject = true;

  const captured = new Map(); // videoId -> timedtext URL the player used
  const origFetch = window.fetch;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- watch the player's caption requests ----------
  function remember(url) {
    try {
      const u = new URL(url, location.origin);
      if (!u.pathname.includes("/api/timedtext")) return;
      const v = u.searchParams.get("v");
      if (v && !u.searchParams.has("tlang")) captured.set(v, u.toString());
    } catch {}
  }
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    remember(String(url));
    return origOpen.call(this, method, url, ...rest);
  };
  window.fetch = function (input, init) {
    remember(typeof input === "string" ? input : input?.url || String(input));
    return origFetch.call(this, input, init);
  };
  try { performance.setResourceTimingBufferSize(5000); } catch {}
  function scanPerformance() {
    for (const e of performance.getEntriesByType("resource")) remember(e.name);
  }

  // ---------- helpers ----------
  function findPlayer(videoId) {
    const players = [...document.querySelectorAll(".html5-video-player")];
    return (
      players.find((p) => p.getVideoData?.()?.video_id === videoId) ||
      document.querySelector("#shorts-player") ||
      document.querySelector("#movie_player")
    );
  }

  // Read one balanced {...} JSON object out of a big HTML string.
  function readJsonObject(str, start) {
    if (start < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < str.length; i++) {
      const ch = str[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) return JSON.parse(str.slice(start, i + 1));
    }
    return null;
  }
  function jsonAfter(html, marker) {
    const i = html.indexOf(marker);
    return i === -1 ? null : readJsonObject(html, html.indexOf("{", i));
  }
  function findAll(o, key, acc = []) {
    if (!o || typeof o !== "object") return acc;
    if (Array.isArray(o)) { for (const v of o) findAll(v, key, acc); return acc; }
    for (const [k, v] of Object.entries(o)) {
      if (k === key) acc.push(v);
      else findAll(v, key, acc);
    }
    return acc;
  }
  function parseViews(s) {
    const m = String(s || "").replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
    if (!m) return null;
    return Math.round(parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase()] || 1));
  }

  // ---------- details (title, stats, tags, description) ----------
  async function getDetails(videoId, resp) {
    let vd = resp?.videoDetails || {};
    let mf = resp?.microformat?.playerMicroformatRenderer || {};
    // The player sometimes holds a slimmed-down copy (e.g. after swiping between
    // Shorts) without tags or upload date. Then read the watch page instead.
    if (vd.videoId !== videoId || !Array.isArray(vd.keywords) || !mf.publishDate || !vd.viewCount) {
      try {
        const html = await (await origFetch(`/watch?v=${videoId}&hl=en`, { credentials: "include" })).text();
        const full = jsonAfter(html, "ytInitialPlayerResponse = ");
        if (full?.videoDetails?.videoId === videoId) {
          vd = { ...full.videoDetails, ...(vd.videoId === videoId ? vd : {}), keywords: full.videoDetails.keywords || vd.keywords };
          mf = { ...(full.microformat?.playerMicroformatRenderer || {}), ...mf };
        }
      } catch {}
    }
    const thumbs = vd.thumbnail?.thumbnails || [];
    const handle = (mf.ownerProfileUrl || "").match(/\/(@[^/?]+)/)?.[1] || "";
    return {
      videoId,
      title: vd.title || document.title.replace(/ - YouTube$/, ""),
      channel: vd.author || mf.ownerChannelName || "",
      channelId: vd.channelId || mf.externalChannelId || "",
      handle,
      views: vd.viewCount ? Number(vd.viewCount) : mf.viewCount ? Number(mf.viewCount) : null,
      lengthSeconds: vd.lengthSeconds ? Number(vd.lengthSeconds) : null,
      publishDate: mf.publishDate || mf.uploadDate || "",
      category: mf.category || "",
      description: vd.shortDescription || mf.description?.simpleText || "",
      tags: Array.isArray(vd.keywords) ? vd.keywords : [],
      thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url.split("?")[0] : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  }

  // ---------- transcript ----------
  async function getCaptionUrl(videoId, player) {
    scanPerformance();
    let url = captured.get(videoId);
    if (url) return url;
    // Make the player load captions (like pressing CC), then put CC back how it was.
    const wasOn = !!player.isSubtitlesOn?.();
    try {
      if (wasOn) { player.toggleSubtitles(); await sleep(150); }
      if (player.toggleSubtitlesOn) player.toggleSubtitlesOn();
      else player.toggleSubtitles();
      for (let t = 0; t < 6000 && !url; t += 200) {
        await sleep(200);
        scanPerformance();
        url = captured.get(videoId);
      }
    } finally {
      if (!!player.isSubtitlesOn?.() !== wasOn) player.toggleSubtitles();
    }
    if (!url) throw new Error("Captions didn't load. Play the Short for a second, then click again.");
    return url;
  }

  async function fetchSegments(videoId, url, tlang) {
    const u = new URL(url);
    u.searchParams.set("fmt", "json3");
    if (tlang) u.searchParams.set("tlang", tlang);
    const body = await (await origFetch(u.toString(), { credentials: "include" })).text();
    if (!body) {
      captured.delete(videoId); // token probably expired; next click re-captures
      throw new Error("YouTube returned an empty transcript. Click again.");
    }
    const data = JSON.parse(body);
    const segments = (data.events || [])
      .filter((e) => e.segs)
      .map((e) => ({
        start: e.tStartMs || 0,
        dur: e.dDurationMs || 0,
        text: e.segs.map((s) => s.utf8).join("").replace(/\n/g, " ").replace(/\s+/g, " ").trim(),
      }))
      .filter((s) => s.text);
    if (!segments.length) throw new Error("Transcript is empty for this Short.");
    return { segments, langCode: u.searchParams.get("lang") || "" };
  }

  async function getTranscript(videoId, player, tracks, tlang) {
    if (!tracks.length) throw new Error("No captions on this Short (none uploaded or auto-generated).");
    const url = await getCaptionUrl(videoId, player);
    const { segments, langCode } = await fetchSegments(videoId, url, tlang);
    const track = tracks.find((t) => t.languageCode === langCode) || tracks[0];
    const lang = track?.name?.simpleText || track?.name?.runs?.map((r) => r.text).join("") || langCode;
    return { segments, lang, langCode };
  }

  function playerFor(videoId) {
    const player = findPlayer(videoId);
    if (!player) throw new Error("Couldn't find the video player. Refresh the page and try again.");
    const resp = player.getPlayerResponse?.();
    if (resp?.videoDetails?.videoId && resp.videoDetails.videoId !== videoId) {
      throw new Error("Player is still loading this Short — try again in a second.");
    }
    return { player, resp, tracks: resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [] };
  }

  async function getInfo(videoId) {
    const { player, resp, tracks } = playerFor(videoId);
    const [details, tr] = await Promise.all([
      getDetails(videoId, resp),
      getTranscript(videoId, player, tracks).then(
        (t) => ({ ok: true, ...t }),
        (e) => ({ ok: false, error: e?.message || String(e) })
      ),
    ]);
    return {
      ...details,
      segments: tr.ok ? tr.segments : [],
      lang: tr.ok ? tr.lang : "",
      langCode: tr.ok ? tr.langCode : "",
      transcriptError: tr.ok ? "" : tr.error,
    };
  }

  async function translate(videoId, tlang) {
    const { player, tracks } = playerFor(videoId);
    const { segments } = await getTranscript(videoId, player, tracks, tlang);
    return { segments };
  }

  // ---------- channel average (for the outlier score) ----------
  async function channelStats(channelId) {
    const html = await (await origFetch(`/channel/${channelId}/shorts?hl=en`, { credentials: "include" })).text();
    const data = jsonAfter(html, "var ytInitialData = ");
    const shorts = findAll(data, "shortsLockupViewModel")
      .map((l) => ({
        id: l.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId,
        title: l.overlayMetadata?.primaryText?.content || "",
        views: parseViews(l.overlayMetadata?.secondaryText?.content),
      }))
      .filter((s) => s.id && s.views !== null);
    return { shorts };
  }

  // ---------- messages from content.js ----------
  const handlers = {
    get: (m) => getInfo(m.videoId),
    translate: (m) => translate(m.videoId, m.tlang),
    channel: (m) => channelStats(m.channelId),
  };
  window.addEventListener("message", async (ev) => {
    const msg = ev.data;
    if (ev.source !== window || !msg || msg.source !== "yst-content" || !handlers[msg.type]) return;
    let reply;
    try {
      reply = { ok: true, data: await handlers[msg.type](msg) };
    } catch (e) {
      reply = { ok: false, error: e?.message || String(e) };
    }
    window.postMessage({ source: "yst-inject", id: msg.id, ...reply }, location.origin);
  });
})();
