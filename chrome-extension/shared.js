// Setup/management page for the shared templates file (see sharedfile.js).
// The file pickers need a real page and a click, which is why this isn't in
// the popup (Chrome closes the popup when a file dialog opens).
const statusEl = document.getElementById("status");
const STARTER_NAMES = FAMFIT_TEMPLATES.map((t) => t.name);

function setStatus(text, kind) { statusEl.textContent = text; statusEl.className = kind || ""; }

async function localEntries() {
  const stored = (await chrome.storage.local.get(FAMFIT_SAVED_KEY))[FAMFIT_SAVED_KEY];
  return (Array.isArray(stored) ? stored : []).filter(famfitValidEntry);
}

// Merge this profile's templates with the shared file, and keep the result in
// both places. Returns the sync result.
async function syncNow(interactive) {
  const res = await famfitSyncShared(await localEntries(), STARTER_NAMES, interactive);
  if (res.state === "ok") {
    await chrome.storage.local.set({ [FAMFIT_SAVED_KEY]: res.merged });
    const live = res.merged.filter((t) => !t.deleted).length;
    setStatus(`Connected to "${res.fileName}". ${live} saved template(s) shared. Synced ${new Date().toLocaleTimeString()}.`, "ok");
  } else if (res.state === "none") {
    setStatus("Not shared yet - this profile's saved templates stay only in this profile.", "");
  } else if (res.state === "needs-permission") {
    setStatus(`"${res.fileName}" needs your permission again. Click "Sync now" and allow it.`, "err");
  } else {
    setStatus(res.error, "err");
  }
  return res;
}

async function connect(pickHandle) {
  let handle;
  try {
    handle = await pickHandle();
  } catch (e) {
    if (e && e.name === "AbortError") return; // closed the dialog
    setStatus("Couldn't pick the file: " + e.message, "err");
    return;
  }
  try {
    if ((await handle.requestPermission({ mode: "readwrite" })) !== "granted") {
      setStatus("Not connected: Chrome needs permission to edit that file.", "err");
      return;
    }
    await famfitSharedHandleProvider.set(handle);
  } catch (e) {
    setStatus("Couldn't remember that file: " + e.message, "err");
    return;
  }
  const res = await syncNow(true);
  if (res.state !== "ok") await famfitSharedHandleProvider.clear().catch(() => {}); // don't keep a bad file
}

const PICKER_TYPES = [{ description: "FamFitHelper templates", accept: { "application/json": [".json"] } }];

document.getElementById("createBtn").addEventListener("click", () =>
  connect(() => window.showSaveFilePicker({ suggestedName: "FamFitHelper-templates.json", types: PICKER_TYPES })));
document.getElementById("openBtn").addEventListener("click", () =>
  connect(async () => (await window.showOpenFilePicker({ types: PICKER_TYPES, multiple: false }))[0]));
document.getElementById("syncBtn").addEventListener("click", () => syncNow(true));
document.getElementById("disconnectBtn").addEventListener("click", async () => {
  if (!confirm("Stop sharing? This profile keeps its own copy of the templates; the shared file isn't deleted.")) return;
  await famfitSharedHandleProvider.clear();
  setStatus("Sharing stopped. This profile keeps its own copy.", "");
});

if (!window.showSaveFilePicker) {
  setStatus("This browser can't share templates through a file. Use a current version of Chrome.", "err");
} else {
  syncNow(false);
}
