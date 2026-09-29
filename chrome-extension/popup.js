const templateSelect = document.getElementById("templateSelect");
const templateText = document.getElementById("templateText");
const statusEl = document.getElementById("status");
const loadedSummaryEl = document.getElementById("loadedSummary");

let loadedContacts = null; // set once either Load or "use pasted list" runs

FAMFIT_TEMPLATES.forEach((t, i) => {
  const opt = document.createElement("option");
  opt.value = i;
  opt.textContent = t.name;
  templateSelect.appendChild(opt);
});
templateSelect.addEventListener("change", () => {
  templateText.value = FAMFIT_TEMPLATES[templateSelect.value].text;
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
  return chrome.tabs.sendMessage(tab.id, message);
}

document.getElementById("loadBtn").addEventListener("click", async () => {
  const filters = {
    status: document.getElementById("fStatus").value,
    priority: document.getElementById("fPriority").value,
    location: document.getElementById("fLocation").value,
    staff: document.getElementById("fStaff").value,
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
});

document.getElementById("usePastedBtn").addEventListener("click", () => {
  loadedContacts = parseContacts(document.getElementById("contacts").value);
  loadedSummaryEl.textContent = `${loadedContacts.length} contact(s) from pasted list.`;
});

document.getElementById("startBtn").addEventListener("click", async () => {
  if (!loadedContacts || !loadedContacts.length) {
    statusEl.textContent = "Load contacts from the CRM, or paste a list, first.";
    return;
  }
  const batch = {
    contacts: loadedContacts,
    templateText: templateText.value,
    staff: document.getElementById("staff").value,
    location: document.getElementById("location").value,
    index: 0,
  };
  await chrome.storage.local.set({ famfitBatch: batch });
  const resp = await sendToActiveTab({ type: "FAMFIT_START" });
  statusEl.textContent = resp && resp.ok
    ? `Started. ${loadedContacts.length} contact(s) queued.`
    : "Couldn't reach the page - refresh the CRM tab and try again.";
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
