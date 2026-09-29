const templateSelect = document.getElementById("templateSelect");
const templateText = document.getElementById("templateText");
const statusEl = document.getElementById("status");

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

async function sendToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes("crm.healthyimagefitness.com")) {
    statusEl.textContent = "Open the CRM's customer list tab first, then try again.";
    return null;
  }
  return chrome.tabs.sendMessage(tab.id, message);
}

document.getElementById("startBtn").addEventListener("click", async () => {
  const contacts = parseContacts(document.getElementById("contacts").value);
  if (!contacts.length) {
    statusEl.textContent = "Paste at least one contact first.";
    return;
  }
  const batch = {
    contacts,
    templateText: templateText.value,
    staff: document.getElementById("staff").value,
    location: document.getElementById("location").value,
    index: 0,
  };
  await chrome.storage.local.set({ famfitBatch: batch });
  const resp = await sendToActiveTab({ type: "FAMFIT_START" });
  statusEl.textContent = resp && resp.ok
    ? `Started. ${contacts.length} contact(s) queued. Pre-filling ${contacts[0].name}...`
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
