const templateSelect = document.getElementById("templateSelect");
const templateText = document.getElementById("templateText");
const statusEl = document.getElementById("status");
// Batch progress / last-run summary get their own line: statusEl is
// overwritten by the dropdown load every time the popup opens.
const runStatusEl = document.getElementById("runStatus");

// Show the loaded version in the popup title, so an old copy is easy to spot.
let EXT_VERSION = "";
try {
  EXT_VERSION = chrome.runtime.getManifest().version;
  document.querySelector("h3").textContent += ` v${EXT_VERSION}`;
} catch (e) { /* not running as an extension */ }

// Update notice. Unpacked extensions can't update themselves, so check the
// GitHub releases (at most every 6 hours, cached) and show a download link
// when a newer extension release exists.
const RELEASES_API = "https://api.github.com/repos/gussieps01-design/FamFitHelper/releases?per_page=20";
const UPDATE_CACHE_KEY = "famfitUpdateCheck";

function newerVersion(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

async function checkForUpdate() {
  if (!EXT_VERSION) return;
  let latest;
  try {
    const cached = (await chrome.storage.local.get(UPDATE_CACHE_KEY))[UPDATE_CACHE_KEY];
    if (cached && Date.now() - cached.at < 6 * 3600 * 1000) {
      latest = cached.latest;
    } else {
      const resp = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
      if (!resp.ok) return;
      const releases = await resp.json();
      const ext = releases.find((r) => !r.draft && !r.prerelease && /^extension-v\d+(\.\d+)*$/.test(r.tag_name));
      latest = ext ? { version: ext.tag_name.replace("extension-v", ""), url: ext.html_url } : null;
      await chrome.storage.local.set({ [UPDATE_CACHE_KEY]: { at: Date.now(), latest } });
    }
  } catch (e) {
    return; // offline or GitHub unreachable - just skip the check
  }
  if (!latest || !newerVersion(latest.version, EXT_VERSION)) return;
  const el = document.getElementById("updateNotice");
  el.textContent = `Update available: v${latest.version} (you have v${EXT_VERSION}). `;
  const link = document.createElement("a");
  link.href = latest.url;
  link.target = "_blank";
  link.textContent = "Download it here";
  link.style.color = "#fff";
  el.appendChild(link);
  el.appendChild(document.createTextNode(" - then follow the Updating steps in HOW-TO-USE.txt."));
  el.style.display = "block";
}
checkForUpdate();
const loadedSummaryEl = document.getElementById("loadedSummary");
const textCountOfEl = document.getElementById("textCountOf");

let loadedContacts = null; // set once either Load or "use pasted list" runs

function updateTextCountLabel() {
  textCountOfEl.textContent = `of ${loadedContacts ? loadedContacts.length : 0} loaded, to text`;
}

// ---- Templates -------------------------------------------------------------
// A template is picked by key: "b:<n>" = starter template n (never changed),
// "u:<id>" = one the user saved, "new" = a message being written from scratch.
// `baseline` is what the current template looks like when saved/unedited, so
// we can tell when there are unsaved changes.
const templateNameEl = document.getElementById("templateName");
const templateNameRow = document.getElementById("templateNameRow");
const templateHintEl = document.getElementById("templateHint");
const templateInfoEl = document.getElementById("templateInfo");
const templateProblemsEl = document.getElementById("templateProblems");
const templateMsgEl = document.getElementById("templateMsg");
const previewListEl = document.getElementById("previewList");
const variantCountEl = document.getElementById("variantCount");
const tplSaveBtn = document.getElementById("tplSave");
const tplSaveAsBtn = document.getElementById("tplSaveAs");
const tplUndoBtn = document.getElementById("tplUndo");
const tplDeleteBtn = document.getElementById("tplDelete");
const NEW_KEY = "new";

let savedTemplates = []; // [{ id, name, text }]
let currentKey = "b:0";
let baseline = { name: "", text: "" };
let tplBusy = false;
let stateReady = false; // don't write popup state until the old one is restored

function builtinIndexOf(key) {
  const m = /^b:(\d+)$/.exec(key);
  return m && FAMFIT_TEMPLATES[Number(m[1])] ? Number(m[1]) : -1;
}
function savedIdOf(key) { return key.startsWith("u:") ? key.slice(2) : null; }
function findSaved(id) { return savedTemplates.find((t) => t.id === id) || null; }
function keyExists(key) {
  return key === NEW_KEY || builtinIndexOf(key) >= 0 || (savedIdOf(key) !== null && !!findSaved(savedIdOf(key)));
}
function baselineFor(key) {
  const bi = builtinIndexOf(key);
  if (bi >= 0) return { name: "", text: famfitTemplateText(FAMFIT_TEMPLATES[bi]) };
  const s = savedIdOf(key) !== null ? findSaved(savedIdOf(key)) : null;
  return s ? { name: s.name, text: s.text } : { name: "", text: "" };
}
// Unsaved changes: the message text differs from the saved/starter text, or
// (for a saved template) it was renamed.
function isDirty() {
  if (templateText.value !== baseline.text) return true;
  return savedIdOf(currentKey) !== null && templateNameEl.value.trim() !== baseline.name;
}

function setTemplateMsg(text, kind) {
  templateMsgEl.textContent = text || "";
  templateMsgEl.className = kind || "";
}

function populateTemplateSelect() {
  templateSelect.innerHTML = "";
  const starters = document.createElement("optgroup");
  starters.label = "Starter templates";
  FAMFIT_TEMPLATES.forEach((t, i) => {
    const opt = document.createElement("option");
    opt.value = "b:" + i;
    opt.textContent = t.name;
    starters.appendChild(opt);
  });
  templateSelect.appendChild(starters);
  if (savedTemplates.length) {
    const mine = document.createElement("optgroup");
    mine.label = "My saved templates";
    savedTemplates
      .slice()
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      .forEach((t) => {
        const opt = document.createElement("option");
        opt.value = "u:" + t.id;
        opt.textContent = t.name;
        mine.appendChild(opt);
      });
    templateSelect.appendChild(mine);
  }
  const own = document.createElement("option");
  own.value = NEW_KEY;
  own.textContent = "Write my own message...";
  templateSelect.appendChild(own);
  templateSelect.value = currentKey;
}

function sampleVars() {
  return {
    first_name: "Jamie",
    last_name: "Rivera",
    staff: document.getElementById("staff").value || "Alex",
    location: document.getElementById("location").value || "Family Fitness",
  };
}

function updateVariantCount() {
  const n = famfitSplitVariants(templateText.value).length;
  const rotate = document.getElementById("rotateVariants").checked;
  variantCountEl.textContent = n === 0
    ? "No message yet."
    : n === 1
      ? "1 version. To rotate wording, add more versions with --- on its own line between them."
      : rotate
        ? `${n} versions - rotating: each contact gets the next one. (--- on its own line separates versions.)`
        : `${n} versions - rotation is OFF, everyone gets the first version.`;
}

function updatePreview() {
  previewListEl.textContent = "";
  const vars = sampleVars();
  famfitSplitVariants(templateText.value).forEach((v, i, all) => {
    const div = document.createElement("div");
    div.className = "pv";
    const rendered = famfitRenderTemplate(v, vars);
    div.textContent = rendered;
    const small = document.createElement("small");
    const len = rendered.length;
    small.textContent = `${all.length > 1 ? `Version ${i + 1} - ` : ""}${len} characters` +
      (len > 160 ? ` (long - may send as ${Math.ceil(len / 153)} text segments)` : "");
    div.appendChild(small);
    previewListEl.appendChild(div);
  });
  if (!previewListEl.childNodes.length) previewListEl.textContent = "Nothing to preview yet.";
}

// Re-draw everything that depends on the current template / its edits.
function refreshTemplateUI() {
  const bi = builtinIndexOf(currentKey);
  const isSaved = savedIdOf(currentKey) !== null;
  const isNew = currentKey === NEW_KEY;
  const dirty = isDirty();
  const hasText = templateText.value.trim() !== "";

  templateHintEl.textContent = bi >= 0
    ? FAMFIT_TEMPLATES[bi].hint + " Edit freely - the starter itself is never changed."
    : isSaved ? "Your saved template."
    : "Type your own message, then give it a name and click Save to keep it.";
  templateNameRow.style.display = "block";
  templateNameEl.placeholder = bi >= 0 ? "Name it to save your own copy" : "e.g. Spring promo";

  tplSaveBtn.style.display = bi >= 0 ? "none" : "";
  tplSaveBtn.textContent = isSaved ? "Save changes" : "Save template";
  tplSaveBtn.disabled = tplBusy || (isSaved && !dirty);
  tplSaveAsBtn.style.display = isNew ? "none" : "";
  tplSaveAsBtn.textContent = bi >= 0 ? "Save as my own template" : "Save as new";
  tplSaveAsBtn.disabled = tplBusy;
  tplUndoBtn.textContent = isNew ? "Clear" : "Undo changes";
  tplUndoBtn.disabled = tplBusy || (isNew ? !hasText && !templateNameEl.value : !dirty);
  tplDeleteBtn.style.display = isSaved ? "" : "none";
  tplDeleteBtn.disabled = tplBusy;

  const problems = hasText ? famfitTemplateProblems(templateText.value) : [];
  templateProblemsEl.style.display = problems.length ? "block" : "none";
  templateProblemsEl.textContent = problems.join(" ");

  templateInfoEl.textContent = dirty && (bi >= 0 || isSaved || hasText) ? "Edited - not saved." : "";
  updateVariantCount();
  updatePreview();
}

// Switch to a template. `draft` restores an unsaved edit (after reopening).
function selectTemplate(key, draft) {
  currentKey = keyExists(key) ? key : "b:0";
  baseline = baselineFor(currentKey);
  templateText.value = draft && typeof draft.text === "string" ? draft.text : baseline.text;
  templateNameEl.value = draft && typeof draft.name === "string" ? draft.name : baseline.name;
  populateTemplateSelect();
  setTemplateMsg("");
  refreshTemplateUI();
}

async function loadSavedTemplates() {
  try {
    const stored = (await chrome.storage.local.get(FAMFIT_SAVED_KEY))[FAMFIT_SAVED_KEY];
    savedTemplates = (Array.isArray(stored) ? stored : []).filter(
      (t) => t && typeof t.id === "string" && typeof t.name === "string" && typeof t.text === "string"
    );
  } catch (e) {
    savedTemplates = [];
    setTemplateMsg("Couldn't read your saved templates: " + e.message, "err");
  }
}

// Write the saved list, then read it back so "Saved" is only ever shown when
// it really is in storage.
async function persistSaved(next) {
  await chrome.storage.local.set({ [FAMFIT_SAVED_KEY]: next });
  const back = (await chrome.storage.local.get(FAMFIT_SAVED_KEY))[FAMFIT_SAVED_KEY];
  if (JSON.stringify(back) !== JSON.stringify(next)) throw new Error("the browser didn't keep it");
  savedTemplates = next;
}

async function saveTemplate(asNew) {
  if (tplBusy) return;
  tplBusy = true;
  refreshTemplateUI();
  try {
    const text = templateText.value.trim();
    const problems = famfitTemplateProblems(text);
    if (problems.length) { setTemplateMsg("Not saved. " + problems[0], "err"); return; }
    const existingId = savedIdOf(currentKey);
    const updateId = !asNew && existingId !== null && findSaved(existingId) ? existingId : null;
    const name = templateNameEl.value.trim();
    const nameProblem = famfitNameProblem(name, savedTemplates, updateId);
    if (nameProblem) {
      setTemplateMsg("Not saved. " + (asNew && existingId !== null && name === baseline.name ? "Type a new name for the copy first." : nameProblem), "err");
      templateNameEl.focus();
      return;
    }
    const entry = { id: updateId || famfitNewId(), name, text };
    const next = updateId
      ? savedTemplates.map((t) => (t.id === updateId ? entry : t))
      : savedTemplates.concat(entry);
    try {
      await persistSaved(next);
    } catch (e) {
      setTemplateMsg("Not saved: " + e.message + ". Your message is still here - try again.", "err");
      return;
    }
    selectTemplate("u:" + entry.id);
    setTemplateMsg(`Saved "${name}".`, "ok");
    await saveFormState();
  } finally {
    tplBusy = false;
    refreshTemplateUI();
  }
}

async function deleteTemplate() {
  const id = savedIdOf(currentKey);
  const t = id !== null ? findSaved(id) : null;
  if (!t || tplBusy) return;
  if (!confirm(`Delete "${t.name}"?\n\nThis can't be undone.`)) return;
  tplBusy = true;
  refreshTemplateUI();
  try {
    await persistSaved(savedTemplates.filter((x) => x.id !== id));
  } catch (e) {
    setTemplateMsg("Not deleted: " + e.message, "err");
    return;
  } finally {
    tplBusy = false;
  }
  selectTemplate("b:0");
  setTemplateMsg(`Deleted "${t.name}".`, "ok");
  await saveFormState();
}

templateSelect.addEventListener("change", async () => {
  const wanted = templateSelect.value;
  if (wanted === currentKey) return;
  if (isDirty() && templateText.value.trim() && !confirm("You have unsaved changes to this message. Switch anyway and lose them?")) {
    templateSelect.value = currentKey;
    return;
  }
  selectTemplate(wanted);
  await saveFormState();
});
templateText.addEventListener("input", () => { setTemplateMsg(""); refreshTemplateUI(); saveFormState(); });
templateNameEl.addEventListener("input", () => { setTemplateMsg(""); refreshTemplateUI(); saveFormState(); });
tplSaveBtn.addEventListener("click", () => saveTemplate(false));
tplSaveAsBtn.addEventListener("click", () => saveTemplate(true));
tplDeleteBtn.addEventListener("click", deleteTemplate);
tplUndoBtn.addEventListener("click", async () => {
  if (currentKey === NEW_KEY) {
    if (templateText.value.trim() && !confirm("Clear what you've typed?")) return;
    selectTemplate(NEW_KEY);
  } else {
    selectTemplate(currentKey);
  }
  await saveFormState();
});
document.querySelectorAll("button[data-insert]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const ins = btn.dataset.insert;
    const start = templateText.selectionStart == null ? templateText.value.length : templateText.selectionStart;
    const end = templateText.selectionEnd == null ? start : templateText.selectionEnd;
    templateText.setRangeText(ins, start, end, "end");
    templateText.focus();
    templateText.dispatchEvent(new Event("input"));
  });
});
document.getElementById("rotateVariants").addEventListener("change", () => {
  updateVariantCount();
  saveFormState();
});
["staff", "location"].forEach((id) => document.getElementById(id).addEventListener("change", updatePreview));

selectTemplate("b:0");

function parseContacts(raw) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t").map((p) => p.trim()).filter(Boolean);
      return { name: parts[0] || "", phone: parts[1] || "" };
    });
}

function numOrNull(id) {
  const v = document.getElementById(id).value.trim();
  return v === "" ? null : Number(v);
}

// Re-text cooldown in days: blank/invalid -> 7, negative -> 0 (off).
function cooldownDaysValue() {
  const n = numOrNull("cooldownDays");
  return n === null || isNaN(n) ? 7 : Math.max(0, n);
}

// Is this a page the extension works on? Uses the manifest's content-script
// match patterns, so a test copy that also covers the mock CRM works too.
function isCrmUrl(url) {
  try {
    const patterns = chrome.runtime.getManifest().content_scripts.flatMap((c) => c.matches);
    return patterns.some((p) =>
      new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$").test(url)
    );
  } catch (e) {
    return url.includes("crm.healthyimagefitness.com");
  }
}

async function sendToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !isCrmUrl(tab.url)) {
    statusEl.textContent = "Open the CRM's customer list tab first, then try again.";
    return null;
  }
  // After the extension is reloaded, already-open CRM tabs keep a dead
  // content script and sendMessage rejects ("Receiving end does not exist").
  // Surface that instead of leaving the popup stuck on "Searching...".
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, message);
    if (resp) return resp;
    statusEl.textContent = "No response from the page - refresh the CRM tab (F5) and try again.";
    return { ok: false, error: "No response from the page." };
  } catch (e) {
    const msg = "Can't reach the CRM page - refresh the CRM tab (F5) and try again.";
    statusEl.textContent = msg;
    return { ok: false, error: msg };
  }
}

function selectedValues(id) {
  return Array.from(document.getElementById(id).selectedOptions)
    .map((o) => o.value)
    .filter(Boolean);
}

// Every multi-select always gets an explicit "Any" option so a single plain
// click (no ctrl/cmd needed) clears back to "nothing selected" - native
// multi-select behavior replaces the whole selection on an unmodified click.
function populateSelect(id, values, opts) {
  opts = opts || {};
  const el = document.getElementById(id);
  const previouslySelected = opts.selected || (el.multiple ? selectedValues(id) : [el.value]);
  el.innerHTML = "";
  const anyOpt = document.createElement("option");
  anyOpt.value = "";
  anyOpt.textContent = opts.placeholder || (el.multiple ? "Any (click to clear all)" : "Any");
  el.appendChild(anyOpt);
  (values || []).forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    if (previouslySelected.includes(v)) opt.selected = true;
    el.appendChild(opt);
  });
}

const STATE_KEY = "famfitPopupState";

function collectFormState() {
  return {
    fStatus: selectedValues("fStatus"),
    fPriority: selectedValues("fPriority"),
    fLocation: selectedValues("fLocation"),
    fStaff: selectedValues("fStaff"),
    fIdleMin: document.getElementById("fIdleMin").value,
    fIdleMax: document.getElementById("fIdleMax").value,
    fSignedWithin: document.getElementById("fSignedWithin").value,
    fMaxPages: document.getElementById("fMaxPages").value,
    templateKey: currentKey,
    templateName: templateNameEl.value,
    templateText: templateText.value,
    templatesVersion: 3, // 3 = template picked by key, saved templates, unsaved drafts
    rotateVariants: document.getElementById("rotateVariants").checked,
    staff: document.getElementById("staff").value,
    location: document.getElementById("location").value,
    autoSend: document.getElementById("autoSend").checked,
    delaySec: document.getElementById("delaySec").value,
    sendHoursOn: document.getElementById("sendHoursOn").checked,
    sendStart: document.getElementById("sendStart").value,
    sendEnd: document.getElementById("sendEnd").value,
    cooldownDays: document.getElementById("cooldownDays").value,
    textCount: document.getElementById("textCount").value,
    loadedContacts,
    loadedSummary: loadedSummaryEl.textContent,
  };
}

async function saveFormState() {
  if (!stateReady) return; // would overwrite the saved state with blank defaults
  await chrome.storage.local.set({ [STATE_KEY]: collectFormState() });
}

// Popup state (loadedContacts, filter picks, template edits, etc.) normally
// lives only in this in-memory JS module, which Chrome destroys every time
// the popup closes/loses focus. Persisting it to chrome.storage.local and
// restoring it here means closing the popup mid-workflow no longer loses
// your loaded contacts or picked filters.
async function restoreFormState() {
  const data = await chrome.storage.local.get(STATE_KEY);
  const state = data[STATE_KEY];
  if (!state) return null;
  document.getElementById("fIdleMin").value = state.fIdleMin || "";
  document.getElementById("fIdleMax").value = state.fIdleMax || "";
  document.getElementById("fSignedWithin").value = state.fSignedWithin || "";
  document.getElementById("fMaxPages").value = state.fMaxPages || "20";
  // Templates (v3 state): same template, plus any unsaved edit. State from an
  // older popup (picked by number from a different list) just starts fresh.
  if (state.templatesVersion === 3 && typeof state.templateKey === "string") {
    const key = keyExists(state.templateKey) ? state.templateKey : NEW_KEY;
    // A saved template that no longer exists keeps its text as a draft.
    selectTemplate(key, { text: state.templateText, name: state.templateName });
  }
  document.getElementById("rotateVariants").checked = state.rotateVariants !== false;
  updateVariantCount();
  document.getElementById("autoSend").checked = !!state.autoSend;
  document.getElementById("delaySec").value = state.delaySec || "5";
  document.getElementById("sendHoursOn").checked = state.sendHoursOn !== false;
  document.getElementById("sendStart").value = state.sendStart || "09:00";
  document.getElementById("sendEnd").value = state.sendEnd || "20:00";
  document.getElementById("cooldownDays").value = state.cooldownDays != null && state.cooldownDays !== "" ? state.cooldownDays : "7";
  document.getElementById("textCount").value = state.textCount || "";
  if (state.loadedContacts && state.loadedContacts.length) {
    loadedContacts = state.loadedContacts;
    loadedSummaryEl.textContent = state.loadedSummary || `${loadedContacts.length} contact(s) loaded (restored).`;
  }
  updateTextCountLabel();
  return state;
}

async function loadFilterOptions(restoredState) {
  statusEl.textContent = "Loading dropdown options from CRM...";
  const resp = await sendToActiveTab({ type: "FAMFIT_GET_FILTER_OPTIONS", maxPages: 10 });
  if (!resp || !resp.ok) {
    statusEl.textContent = resp ? `Couldn't load dropdown options: ${resp.error}` : statusEl.textContent;
    // Still show the saved picks, so they aren't lost (and overwritten by the
    // next save) just because the CRM scan failed this time.
    if (restoredState) {
      populateSelect("fStatus", restoredState.fStatus, { selected: restoredState.fStatus });
      populateSelect("fPriority", restoredState.fPriority, { selected: restoredState.fPriority });
      populateSelect("fLocation", restoredState.fLocation, { selected: restoredState.fLocation });
      populateSelect("fStaff", restoredState.fStaff, { selected: restoredState.fStaff });
    }
    return;
  }
  populateSelect("fStatus", resp.statuses, { selected: restoredState && restoredState.fStatus });
  populateSelect("fPriority", resp.priorities, { selected: restoredState && restoredState.fPriority });
  populateSelect("fLocation", resp.locations, { selected: restoredState && restoredState.fLocation });
  populateSelect("fStaff", resp.staff, { selected: restoredState && restoredState.fStaff });
  populateSelect("staff", resp.staff, {
    selected: restoredState && restoredState.staff ? [restoredState.staff] : undefined,
    placeholder: "(use contact's own staff)",
  });
  populateSelect("location", resp.locations, {
    selected: restoredState && restoredState.location ? [restoredState.location] : undefined,
    placeholder: "(use contact's own location)",
  });
  statusEl.textContent = `Dropdown options loaded (scanned ${resp.pagesSearched} page(s) of ${resp.total} total).`;
}

document.getElementById("refreshOptionsBtn").addEventListener("click", () => loadFilterOptions());

[
  "fStatus", "fPriority", "fLocation", "fStaff",
  "fIdleMin", "fIdleMax", "fSignedWithin", "fMaxPages",
  "staff", "location", "autoSend", "delaySec", "sendHoursOn", "sendStart", "sendEnd", "cooldownDays", "textCount",
].forEach((id) => {
  document.getElementById(id).addEventListener("change", saveFormState);
});

// Picking "Any" (even with ctrl-click alongside other values) clears every
// other pick in that box, so "Any" always means no filter.
["fStatus", "fPriority", "fLocation", "fStaff"].forEach((id) => {
  const el = document.getElementById(id);
  el.addEventListener("change", () => {
    if (el.options[0] && el.options[0].selected) {
      Array.from(el.options).forEach((o, i) => { o.selected = i === 0; });
      saveFormState();
    }
  });
});
document.getElementById("textCount").addEventListener("input", saveFormState);
(async () => {
  await loadSavedTemplates();
  populateTemplateSelect();
  let restored = null;
  try {
    restored = await restoreFormState();
  } finally {
    stateReady = true;
  }
  await loadFilterOptions(restored);
  updatePreview(); // staff/location lists are filled in now
})();

document.getElementById("loadBtn").addEventListener("click", async () => {
  const filters = {
    status: selectedValues("fStatus"),
    priority: selectedValues("fPriority"),
    location: selectedValues("fLocation"),
    staff: selectedValues("fStaff"),
    idleMin: numOrNull("fIdleMin"),
    idleMax: numOrNull("fIdleMax"),
    signedWithinDays: numOrNull("fSignedWithin"),
  };
  const maxPages = numOrNull("fMaxPages") || 20;
  loadedSummaryEl.textContent = "Searching CRM (see badge on the page)...";
  const cooldownDays = cooldownDaysValue();
  const resp = await sendToActiveTab({ type: "FAMFIT_LOAD_FILTERED", filters, maxPages, cooldownDays });
  if (!resp) return;
  if (!resp.ok) {
    loadedSummaryEl.textContent = "Search failed: " + resp.error;
    return;
  }
  loadedContacts = resp.matches;
  const recentNote = resp.recentlyTexted ? ` ${resp.recentlyTexted} skipped - texted in the last ${cooldownDays} day(s).` : "";
  loadedSummaryEl.textContent = (resp.complete
    ? `${resp.matches.length} contact(s) loaded - all ${resp.total} CRM match(es) searched, ${resp.excluded} auto-excluded (Dead/bounced/unsubscribed/no phone)` +
      (resp.duplicates ? `, ${resp.duplicates} duplicate phone(s) dropped.` : ".")
    : `${resp.matches.length} contact(s) loaded from the first ${resp.pagesSearched} page(s) of ${resp.total} CRM match(es). Raise "Search up to N pages" to get the rest.`) + recentNote;
  updateTextCountLabel();
  await saveFormState();
});

document.getElementById("usePastedBtn").addEventListener("click", async () => {
  const seenPhones = new Set();
  loadedContacts = parseContacts(document.getElementById("contacts").value).filter((c) => {
    const key = c.phone.replace(/\D/g, "").slice(-10);
    if (!key) return true;
    if (seenPhones.has(key)) return false;
    seenPhones.add(key);
    return true;
  });
  loadedSummaryEl.textContent = `${loadedContacts.length} contact(s) from pasted list.`;
  updateTextCountLabel();
  await saveFormState();
});

function runSummary(stats, total) {
  const s = stats || { sent: 0, skipped: [] };
  let text = `${s.sent} sent, ${s.skipped.length} skipped of ${total}.`;
  if (s.skipped.length) text += "\nSkipped:\n" + s.skipped.map((x) => `- ${x.name}: ${x.reason}`).join("\n");
  return text;
}

document.getElementById("startBtn").addEventListener("click", async () => {
  // A stored batch is RESUMED where it left off - never restarted from
  // contact 1, which would re-text everyone already sent. Stop clears it.
  const existing = (await chrome.storage.local.get("famfitBatch")).famfitBatch;
  if (existing) {
    if (existing.autoSend && !confirm(`Resume AUTO-SEND at contact ${existing.index + 1} of ${existing.contacts.length}?\n\n(To start a different batch instead, click Stop first.)`)) {
      statusEl.textContent = "Cancelled.";
      return;
    }
    const resp = await sendToActiveTab({ type: "FAMFIT_START" });
    if (resp && resp.ok) runStatusEl.textContent = `Resumed at contact ${existing.index + 1} of ${existing.contacts.length}. (Click Stop first to start a new batch.)`;
    return;
  }
  if (!loadedContacts || !loadedContacts.length) {
    statusEl.textContent = "Load contacts from the CRM, or paste a list, first.";
    return;
  }
  const messageProblems = famfitTemplateProblems(templateText.value);
  if (messageProblems.length) {
    statusEl.textContent = "Fix the message first: " + messageProblems[0];
    return;
  }
  const textCount = numOrNull("textCount");
  const contactsToSend = textCount && textCount > 0 ? loadedContacts.slice(0, textCount) : loadedContacts;
  const autoSend = document.getElementById("autoSend").checked;
  if (autoSend) {
    const confirmed = confirm(
      `Auto-send is ON.\n\nThis will automatically click Send for all ${contactsToSend.length} contact(s) with no per-person review or manual click - each message goes out as soon as it's filled in.\n\nContinue?`
    );
    if (!confirmed) {
      statusEl.textContent = "Cancelled.";
      return;
    }
  }
  const batch = {
    contacts: contactsToSend,
    templateText: templateText.value,
    staff: document.getElementById("staff").value,
    location: document.getElementById("location").value,
    autoSend,
    delaySec: Math.max(1, numOrNull("delaySec") || 5),
    // Auto-send only texts inside these hours (local time); null = any time.
    sendWindow: document.getElementById("sendHoursOn").checked
      ? { start: document.getElementById("sendStart").value || "09:00", end: document.getElementById("sendEnd").value || "20:00" }
      : null,
    cooldownDays: cooldownDaysValue(),
    // Rotate: each batch starts at a random version, then takes the next
    // one per contact. Off: everyone gets the first version.
    rotate: document.getElementById("rotateVariants").checked,
    variantOffset: Math.floor(Math.random() * Math.max(1, famfitSplitVariants(templateText.value).length)),
    index: 0,
  };
  await chrome.storage.local.set({ famfitBatch: batch });
  const resp = await sendToActiveTab({ type: "FAMFIT_START" });
  if (!resp || !resp.ok) {
    // Don't leave a phantom "batch in progress" behind when it never started.
    await chrome.storage.local.remove("famfitBatch");
    return; // sendToActiveTab already put the reason in the status line
  }
  statusEl.textContent = `Started. ${contactsToSend.length} of ${loadedContacts.length} loaded contact(s) queued.`;
  runStatusEl.textContent = "";
});

document.getElementById("stopBtn").addEventListener("click", async () => {
  const b = (await chrome.storage.local.get("famfitBatch")).famfitBatch;
  if (b) {
    const stats = b.stats || { sent: 0, skipped: [] };
    await chrome.storage.local.set({
      famfitLastRun: { finishedAt: Date.now(), total: b.contacts.length, sent: stats.sent, skipped: stats.skipped, stoppedAt: b.index },
    });
  }
  await chrome.storage.local.remove("famfitBatch");
  await sendToActiveTab({ type: "FAMFIT_STOP" });
  statusEl.textContent = "Stopped.";
  runStatusEl.textContent = b ? `Stopped at contact ${b.index + 1} of ${b.contacts.length}: ${runSummary(b.stats, b.contacts.length)}` : "";
});

chrome.storage.local.get(["famfitBatch", "famfitLastRun"], (data) => {
  const b = data.famfitBatch;
  if (b) {
    runStatusEl.textContent = `Batch in progress: contact ${b.index + 1} of ${b.contacts.length} - ${runSummary(b.stats, b.contacts.length)}\nStart resumes it; Stop ends it.`;
  } else if (data.famfitLastRun) {
    const r = data.famfitLastRun;
    runStatusEl.textContent = `Last run (${new Date(r.finishedAt).toLocaleString()}): ${runSummary({ sent: r.sent, skipped: r.skipped }, r.total)}`;
  }
});
