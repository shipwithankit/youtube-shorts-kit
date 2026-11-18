// Background worker: toolbar icon, opening the Library, downloads and Gemini calls.
importScripts("shared.js");

function openLibrary(hash = "") {
  const url = chrome.runtime.getURL("library.html") + (hash ? `#${hash}` : "");
  chrome.tabs.query({ url: chrome.runtime.getURL("library.html") + "*" }, (tabs) => {
    if (tabs && tabs[0]) {
      chrome.tabs.update(tabs[0].id, { active: true, url });
      chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      chrome.tabs.create({ url });
    }
  });
}

// Toolbar icon: on a YouTube Short/video -> analyze it; anywhere else -> open the Library.
chrome.action.onClicked.addListener(async (tab) => {
  const onVideo = /^https:\/\/www\.youtube\.com\/(shorts\/|watch\?)/.test(tab.url || "");
  if (!onVideo) return openLibrary();
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "yst-run" });
  } catch {
    // Tab was open before the extension was installed/updated: reload it once.
    chrome.tabs.reload(tab.id);
  }
});

async function runGemini(prompt) {
  const st = await YST.settings.get();
  if (!st.geminiKey) throw new Error("Add your Gemini API key in Settings first.");
  let model = st.model;
  if (!model) {
    const cached = (await chrome.storage.local.get("autoModel")).autoModel;
    if (cached && Date.now() - cached.at < 7 * 86400000) model = cached.id;
    else {
      model = YST.pickDefaultModel(await YST.geminiModels(st.geminiKey));
      if (!model) throw new Error("No Gemini model available for this key.");
      await chrome.storage.local.set({ autoModel: { id: model, at: Date.now() } });
    }
  }
  try {
    return { text: await YST.geminiGenerate({ key: st.geminiKey, model, prompt }), model };
  } catch (e) {
    // The auto-picked model may have been retired: pick again once.
    if (!st.model && /not found|not supported|404/i.test(e.message)) {
      await chrome.storage.local.remove("autoModel");
      model = YST.pickDefaultModel(await YST.geminiModels(st.geminiKey));
      await chrome.storage.local.set({ autoModel: { id: model, at: Date.now() } });
      return { text: await YST.geminiGenerate({ key: st.geminiKey, model, prompt }), model };
    }
    throw e;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "openLibrary") {
    openLibrary(msg.hash);
    return false;
  }
  if (msg?.type === "download") {
    chrome.downloads.download({ url: msg.url, filename: msg.filename.replace(/[\\/:*?"<>|]+/g, "") }, (id) => {
      reply(id ? { ok: true } : { ok: false, error: chrome.runtime.lastError?.message || "failed" });
    });
    return true;
  }
  if (msg?.type === "gemini") {
    runGemini(msg.prompt)
      .then(({ text, model }) => reply({ ok: true, text, model }))
      .catch((e) => reply({ ok: false, error: e.message || String(e) }));
    return true; // async reply
  }
  return false;
});
