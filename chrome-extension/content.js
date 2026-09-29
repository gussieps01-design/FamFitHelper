// FamFitHelper CRM Assist - content script
//
// What this does: pre-fills the SMS textarea for one contact at a time.
// It NEVER clicks the CRM's own "Send message" button. It only watches for
// the CRM's own success signal (the green flash banner it shows after a
// real, human-clicked send) and, once that's seen, moves on to pre-filling
// the next contact. The actual send stays a manual, deliberate click by a
// human on the CRM's real page, every single time.
//
// How the CRM's send works (reverse engineered from its own JS, never
// triggered by this script): clicking "Send message" runs
//   $.post({ url: <form action>, data: <form fields>, dataType: 'script' })
// and on success inserts a banner: #flash_notice inside .alert-success
// before #main_content. That banner is this script's only "it was sent"
// signal - a MutationObserver watches for it appearing.

(function () {
  const STATUS_ID = "famfit-status-badge";
  let awaitingSendFor = null; // {name, phone} of the contact whose modal is currently open and pre-filled
  let observerStarted = false;

  function showBadge(text, color) {
    let el = document.getElementById(STATUS_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = STATUS_ID;
      el.style.cssText =
        "position:fixed;top:12px;right:12px;z-index:999999;background:#2B2724;color:#fff;" +
        "padding:10px 14px;border-radius:6px;font:13px Segoe UI,sans-serif;max-width:320px;" +
        "box-shadow:0 2px 8px rgba(0,0,0,.3);";
      document.body.appendChild(el);
    }
    el.style.background = color || "#2B2724";
    el.innerHTML = "";
    const line = document.createElement("div");
    line.textContent = "FamFitHelper: " + text;
    el.appendChild(line);
  }

  // The single highest-value check per message is "is this the right
  // person" - so that gets its own large, hard-to-miss line, separate from
  // the smaller status text, instead of buried in a sentence.
  function showReadyBadge(contact, position, total) {
    let el = document.getElementById(STATUS_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = STATUS_ID;
      el.style.cssText =
        "position:fixed;top:12px;right:12px;z-index:999999;background:#C6552B;color:#fff;" +
        "padding:12px 16px;border-radius:6px;font:13px Segoe UI,sans-serif;max-width:340px;" +
        "box-shadow:0 2px 8px rgba(0,0,0,.3);";
      document.body.appendChild(el);
    }
    el.style.background = "#C6552B";
    el.innerHTML =
      `<div style="font-size:16px;font-weight:bold;margin-bottom:2px;">${escapeHtml(contact.name)}</div>` +
      `<div style="opacity:.9;margin-bottom:6px;">${escapeHtml(contact.phone || "")}</div>` +
      `<div style="font-size:11px;opacity:.85;">Contact ${position} of ${total} - review, then Send ` +
      `(or Ctrl+Enter while in the message box)</div>`;
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function hideBadge() {
    const el = document.getElementById(STATUS_ID);
    if (el) el.remove();
  }

  function waitFor(checkFn, timeoutMs) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const iv = setInterval(() => {
        const result = checkFn();
        if (result) {
          clearInterval(iv);
          resolve(result);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(iv);
          reject(new Error("timeout"));
        }
      }, 200);
    });
  }

  function normalizePhone(p) {
    return (p || "").replace(/\D/g, "").slice(-10);
  }

  function findContactRowLink(contact) {
    const rows = Array.from(document.querySelectorAll("table tbody tr"));
    for (const row of rows) {
      const nameLink = row.querySelector("a");
      if (!nameLink) continue;
      const rowText = row.textContent || "";
      const nameMatches = contact.name && nameLink.textContent.trim().toLowerCase() === contact.name.trim().toLowerCase();
      const phoneMatches = contact.phone && normalizePhone(rowText).includes(normalizePhone(contact.phone));
      if (nameMatches || (contact.phone && phoneMatches)) {
        // The clickable "open messages" element is the journal/message icon
        // link, which points at .../customer_journal_items/new
        const journalLink = Array.from(row.querySelectorAll("a")).find((a) =>
          (a.getAttribute("href") || "").includes("customer_journal_items/new")
        );
        return journalLink || null;
      }
    }
    return null;
  }

  async function openAndFillContact(batch, index) {
    if (index >= batch.contacts.length) {
      showBadge(`All ${batch.contacts.length} contact(s) done!`, "#2a7a2a");
      awaitingSendFor = null;
      await chrome.storage.local.remove("famfitBatch");
      return;
    }
    const contact = batch.contacts[index];
    showBadge(`Finding ${contact.name}...`);

    const link = findContactRowLink(contact);
    if (!link) {
      showBadge(
        `Couldn't find "${contact.name}" on this page. Navigate to the page/filter that shows them, then reopen the popup and click Start again.`,
        "#a33"
      );
      awaitingSendFor = null;
      return;
    }

    link.click();

    try {
      await waitFor(() => document.querySelector('a[href="#messages"]'), 8000);
      const messagingTab = document.querySelector('a[href="#messages"]');
      messagingTab.click();
      await waitFor(() => document.querySelector('a[href="#smss"]'), 4000);
      const smsTab = document.querySelector('a[href="#smss"]');
      smsTab.click();
      await waitFor(() => document.getElementById("customer_message_message"), 4000);
    } catch (e) {
      showBadge(`Couldn't open the message box for ${contact.name}. Skipping - check them manually.`, "#a33");
      awaitingSendFor = null;
      const nextBatch = { ...batch, index: index + 1 };
      await chrome.storage.local.set({ famfitBatch: nextBatch });
      setTimeout(() => openAndFillContact(nextBatch, index + 1), 1500);
      return;
    }

    const [firstName, ...rest] = (contact.name || "").split(" ");
    const rendered = famfitRenderTemplate(batch.templateText, {
      first_name: firstName || "",
      last_name: rest.join(" "),
      staff: batch.staff || "",
      location: batch.location || "",
    });

    const textarea = document.getElementById("customer_message_message");
    textarea.value = rendered;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    textarea.scrollIntoView({ behavior: "smooth", block: "center" });
    textarea.focus();

    awaitingSendFor = contact;
    showReadyBadge(contact, index + 1, batch.contacts.length);
    ensureSendObserver();
    ensureSendShortcut();
  }

  // Ctrl+Enter while the message box is focused clicks the exact same real
  // Send button a mouse click would - this is a faster INPUT method for the
  // same human decision, not a different decision. It only fires while the
  // textarea for THIS specific message is actively focused, so it can't fire
  // accidentally from elsewhere on the page or for a message not on screen.
  let shortcutStarted = false;
  function ensureSendShortcut() {
    if (shortcutStarted) return;
    shortcutStarted = true;
    document.addEventListener("keydown", (e) => {
      if (!awaitingSendFor) return;
      const textarea = document.getElementById("customer_message_message");
      if (document.activeElement !== textarea) return;
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const sendLink = document.getElementById("submit_sms_message");
        if (sendLink) sendLink.click();
      }
    });
  }

  function ensureSendObserver() {
    if (observerStarted) return;
    observerStarted = true;
    const observer = new MutationObserver((mutations) => {
      if (!awaitingSendFor) return;
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const isSuccessBanner =
            (node.id === "flash_notice" || node.querySelector?.("#flash_notice")) ||
            node.classList?.contains("alert-success") ||
            node.querySelector?.(".alert-success");
          if (isSuccessBanner) {
            handleSendDetected();
            return;
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function handleSendDetected() {
    const sentContact = awaitingSendFor;
    awaitingSendFor = null;
    showBadge(`Sent to ${sentContact.name}. Moving to next...`, "#2a7a2a");
    const data = await chrome.storage.local.get("famfitBatch");
    if (!data.famfitBatch) return;
    const nextIndex = data.famfitBatch.index + 1;
    const nextBatch = { ...data.famfitBatch, index: nextIndex };
    await chrome.storage.local.set({ famfitBatch: nextBatch });
    setTimeout(() => openAndFillContact(nextBatch, nextIndex), 1200);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "FAMFIT_START") {
      chrome.storage.local.get("famfitBatch", (data) => {
        if (data.famfitBatch) {
          openAndFillContact(data.famfitBatch, data.famfitBatch.index);
        }
      });
      sendResponse({ ok: true });
    } else if (message.type === "FAMFIT_STOP") {
      awaitingSendFor = null;
      hideBadge();
      sendResponse({ ok: true });
    }
    return true;
  });

  // Resume a batch already in progress if the page reloads mid-run.
  chrome.storage.local.get("famfitBatch", (data) => {
    if (data.famfitBatch) {
      showBadge(`Batch in progress (${data.famfitBatch.index + 1}/${data.famfitBatch.contacts.length}). Reopen the popup and click Start to resume.`);
    }
  });
})();
