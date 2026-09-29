const templateSelect = document.getElementById("templateSelect");
const templateText = document.getElementById("templateText");
const statusEl = document.getElementById("status");
const loadedSummaryEl = document.getElementById("loadedSummary");
const textCountOfEl = document.getElementById("textCountOf");

let loadedContacts = null; // set once either Load or "use pasted list" runs

function updateTextCountLabel() {
  textCountOfEl.textContent = `of ${loadedContacts ? loadedContacts.length : 0} loaded, to text`;
}

FAMFIT_TEMPLATES.forEach((t, i) => {
  const opt = document.createElement("option");
  opt.value = i;
  opt.textContent = t.name;
  templateSelect.appendChild(opt);
});
templateSelect.addEventListener("change", () => {
  templateText.value = FAMFIT_TEMPLATES[templateSelect.value].text;
  saveFormState();
});
templateText.value = FAMFIT_TEMPLATES[0].text;

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

async function sendToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes("crm.healthyimagefitness.com")) {
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
    templateIndex: templateSelect.value,
    templateText: templateText.value,
    staff: document.getElementById("staff").value,
    location: document.getElementById("location").value,
    autoSend: document.getElementById("autoSend").checked,
    textCount: document.getElementById("textCount").value,
    loadedContacts,
    loadedSummary: loadedSummaryEl.textContent,
  };
}

async function saveFormState() {
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
  document.getElementById("fMaxPages").value = state.fMaxPages || "5";
  if (state.templateIndex !== undefined && FAMFIT_TEMPLATES[state.templateIndex]) {
    templateSelect.value = state.templateIndex;
  }
  templateText.value = state.templateText || FAMFIT_TEMPLATES[0].text;
  document.getElementById("autoSend").checked = !!state.autoSend;
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
  "staff", "location", "autoSend", "textCount",
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
templateText.addEventListener("input", saveFormState);

(async () => {
  const restored = await restoreFormState();
  await loadFilterOptions(restored);
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
  const maxPages = numOrNull("fMaxPages") || 5;
  loadedSummaryEl.textContent = "Searching CRM (see badge on the page)...";
  const resp = await sendToActiveTab({ type: "FAMFIT_LOAD_FILTERED", filters, maxPages });
  if (!resp) return;
  if (!resp.ok) {
    loadedSummaryEl.textContent = "Search failed: " + resp.error;
    return;
  }
  loadedContacts = resp.matches;
  loadedSummaryEl.textContent = `${resp.matches.length} contact(s) loaded (searched ${resp.pagesSearched} page(s) of ${resp.total} total, ${resp.excluded} auto-excluded).`;
  updateTextCountLabel();
  await saveFormState();
});

document.getElementById("usePastedBtn").addEventListener("click", async () => {
  loadedContacts = parseContacts(document.getElementById("contacts").value);
  loadedSummaryEl.textContent = `${loadedContacts.length} contact(s) from pasted list.`;
  updateTextCountLabel();
  await saveFormState();
});

document.getElementById("startBtn").addEventListener("click", async () => {
  if (!loadedContacts || !loadedContacts.length) {
    statusEl.textContent = "Load contacts from the CRM, or paste a list, first.";
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
});

document.getElementById("stopBtn").addEventListener("click", async () => {
  await chrome.storage.local.remove("famfitBatch");
  await sendToActiveTab({ type: "FAMFIT_STOP" });
  statusEl.textContent = "Stopped.";
});

chrome.storage.local.get("famfitBatch", (data) => {
  if (data.famfitBatch) {
    const b = data.famfitBatch;
    statusEl.textContent = `Batch in progress: contact ${b.index + 1} of ${b.contacts.length}.`;
  }
});
