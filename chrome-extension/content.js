// FamFitHelper CRM Assist - content script
//
// What this does: pre-fills the SMS textarea for one contact at a time.
// By default it NEVER clicks the CRM's own "Send message" button - it only
// watches for the CRM's own success signal (the green flash banner it shows
// after a send) and, once that's seen, moves on to pre-filling the next
// contact. The actual send is a manual, deliberate click by a human on the
// CRM's real page, every single time.
//
// Exception: if the batch has autoSend: true (set via the popup's "Auto-send"
// checkbox, opt-in and confirmed per batch), this script clicks the real
// Send button itself for every contact, unattended. Same success-banner
// detection gates advancing either way.
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

  // The page reuses id="customer_message_message" for BOTH the Email and SMS
  // compose forms (invalid HTML, but that's what the CRM renders). getElementById
  // always returns the first match, which is the hidden Email one - so any fill
  // that used getElementById directly was silently writing into the wrong,
  // invisible textarea. Scope the lookup to the SMS form specifically.
  function getSmsTextarea() {
    const smsForm = document.getElementById("new_sms_customer_message");
    return smsForm ? smsForm.querySelector("#customer_message_message") : null;
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

  // Contacts loaded from the live CRM carry their customer id, so they can be
  // opened no matter which grid page is showing: build the same remote-modal
  // link the grid renders for each row and click it. Pasted contacts have no
  // id and fall back to searching the rendered table.
  function openContactModal(contact) {
    if (contact.id) {
      const a = document.createElement("a");
      a.href = `/customers/${contact.id}/customer_journal_items/new`;
      a.setAttribute("data-remote", "true");
      a.setAttribute("data-toggle", "modal");
      a.setAttribute("data-target", "#modal-window");
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    }
    const link = findContactRowLink(contact);
    if (!link) return false;
    link.click();
    return true;
  }

  // If the modal's SMS form names a customer id in its action URL, it must be
  // this contact's - guards against filling a stale modal left over from the
  // previous contact. Forms with no id in the action pass (can't tell).
  function smsFormCustomerId() {
    const form = document.getElementById("new_sms_customer_message");
    const m = ((form && form.getAttribute("action")) || "").match(/customers\/(\d+)/);
    return m ? m[1] : null;
  }

  function smsFormBelongsTo(contact) {
    if (!contact.id) return true;
    const formId = smsFormCustomerId();
    return !formId || formId === String(contact.id);
  }

  function smsFormExplicitlyFor(contact) {
    return !!contact.id && smsFormCustomerId() === String(contact.id);
  }

  // Bumped by Start and Stop so timers from an old/stopped run (auto-send
  // click, advance-to-next) can't fire after the user hit Stop.
  let runId = 0;

  async function openAndFillContact(batch, index, myRun) {
    if (myRun !== runId) return;
    if (index >= batch.contacts.length) {
      showBadge(`All ${batch.contacts.length} contact(s) done!`, "#2a7a2a");
      awaitingSendFor = null;
      await chrome.storage.local.remove("famfitBatch");
      return;
    }
    const contact = batch.contacts[index];
    showBadge(`Finding ${contact.name}...`);

    // Remember the previous contact's modal pieces so the waits below only
    // succeed once the CRM has swapped in NEW content for this contact -
    // otherwise contact 2+ would instantly "find" contact 1's leftover form
    // and fill the wrong person's message box.
    const oldMessagesTab = document.querySelector('a[href="#messages"]');
    const oldTextarea = getSmsTextarea();

    if (!openContactModal(contact)) {
      showBadge(
        `Couldn't find "${contact.name}" on this page. Navigate to the page/filter that shows them, then reopen the popup and click Start again.`,
        "#a33"
      );
      awaitingSendFor = null;
      return;
    }

    try {
      await waitFor(() => {
        const t = document.querySelector('a[href="#messages"]');
        return t && (t !== oldMessagesTab || smsFormExplicitlyFor(contact)) ? t : null;
      }, 10000);
      document.querySelector('a[href="#messages"]').click();
      await waitFor(() => document.querySelector('a[href="#smss"]'), 4000);
      document.querySelector('a[href="#smss"]').click();
      await waitFor(() => {
        const t = getSmsTextarea();
        return t && (t !== oldTextarea || smsFormExplicitlyFor(contact)) ? t : null;
      }, 4000);
      if (!smsFormBelongsTo(contact)) throw new Error("wrong contact in modal");
    } catch (e) {
      if (myRun !== runId) return;
      showBadge(`Couldn't open the message box for ${contact.name}. Skipping - check them manually.`, "#a33");
      awaitingSendFor = null;
      const nextBatch = { ...batch, index: index + 1 };
      await chrome.storage.local.set({ famfitBatch: nextBatch });
      setTimeout(() => openAndFillContact(nextBatch, index + 1, myRun), 1500);
      return;
    }
    if (myRun !== runId) return;

    const [firstName, ...rest] = (contact.name || "").split(" ");
    const rendered = famfitRenderTemplate(batch.templateText, {
      first_name: firstName || "",
      last_name: rest.join(" "),
      staff: contact.staff || batch.staff || "",
      location: contact.location || batch.location || "",
    });

    const textarea = getSmsTextarea();
    textarea.value = rendered;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    textarea.scrollIntoView({ behavior: "smooth", block: "center" });
    textarea.focus();

    awaitingSendFor = contact;
    ensureSendObserver();
    ensureSendShortcut();

    if (batch.autoSend) {
      showBadge(
        `Auto-sending to ${contact.name} (${index + 1} of ${batch.contacts.length}) - no manual review`,
        "#a33"
      );
      setTimeout(() => {
        if (myRun !== runId || awaitingSendFor !== contact) return;
        const sendLink = document.getElementById("submit_sms_message");
        if (sendLink) sendLink.click();
      }, 400);
    } else {
      showReadyBadge(contact, index + 1, batch.contacts.length);
    }
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
      const textarea = getSmsTextarea();
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
    const myRun = runId;
    awaitingSendFor = null;
    showBadge(`Sent to ${sentContact.name}. Moving to next...`, "#2a7a2a");
    const data = await chrome.storage.local.get("famfitBatch");
    if (!data.famfitBatch || myRun !== runId) return;
    const nextIndex = data.famfitBatch.index + 1;
    const nextBatch = { ...data.famfitBatch, index: nextIndex };
    await chrome.storage.local.set({ famfitBatch: nextBatch });
    setTimeout(() => openAndFillContact(nextBatch, nextIndex, myRun), 1200);
  }

  // ---------- live CRM fetch: same JSON endpoint and filter logic as the
  // desktop app, ported to JS. Runs from the content script so it's
  // same-origin with the CRM and automatically carries the user's own
  // session cookies - no separate login needed. ----------

  function daysSince(isoTimestamp) {
    if (!isoTimestamp) return null;
    const then = new Date(isoTimestamp);
    if (isNaN(then.getTime())) return null;
    return Math.floor((Date.now() - then.getTime()) / 86400000);
  }

  function contactIsAutoExcluded(c) {
    if ((c.priority || "").trim().toLowerCase() === "dead") return true;
    if (["phone_bounced", "phone_unsubscribed"].includes(c.phone_subscription_status)) return true;
    return false;
  }

  function multiMatch(wantArr, have) {
    if (!wantArr || !wantArr.length) return true;
    const haveNorm = (have || "").trim().toLowerCase();
    return wantArr.some((w) => haveNorm === String(w).trim().toLowerCase());
  }

  function contactMatchesFilters(c, f) {
    if (!multiMatch(f.status, c.status)) return false;
    if (!multiMatch(f.priority, c.priority)) return false;
    if (!multiMatch(f.location, c.location)) return false;
    if (!multiMatch(f.staff, c.staff)) return false;
    if (f.idleMin != null || f.idleMax != null) {
      if (typeof c.idle !== "number") return false;
      if (f.idleMin != null && c.idle < f.idleMin) return false;
      if (f.idleMax != null && c.idle > f.idleMax) return false;
    }
    if (f.signedWithinDays != null) {
      const age = daysSince(c.created_at);
      if (age === null || age > f.signedWithinDays) return false;
    }
    return true;
  }

  async function fetchCustomersPage(page) {
    const params = new URLSearchParams({ take: 100, skip: (page - 1) * 100, page, pageSize: 100 });
    const resp = await fetch(`/customers_grid.json?${params}`, { credentials: "include" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const payload = await resp.json();
    const contacts = (payload.data || [])
      .filter((r) => r.fullname)
      .map((r) => ({
        id: r.id,
        name: r.fullname,
        phone: r.phone || "",
        staff: r.user || "",
        location: r.location || "",
        status: r.status || "",
        priority: r.priority || "",
        phone_subscription_status: r.phone_subscription_status,
        idle: r.idle,
        created_at: r.created_at,
      }));
    return { contacts, total: payload.total || 0 };
  }

  async function fetchFilterOptions(maxPages, progressCb) {
    const statuses = new Set();
    const priorities = new Set();
    const locations = new Set();
    const staff = new Set();
    let total = 0;
    let page = 1;
    for (; page <= maxPages; page++) {
      const { contacts, total: t } = await fetchCustomersPage(page);
      total = t;
      if (!contacts.length) break;
      for (const c of contacts) {
        if (c.status) statuses.add(c.status.trim());
        if (c.priority) priorities.add(c.priority.trim());
        if (c.location) locations.add(c.location.trim());
        if (c.staff) staff.add(c.staff.trim());
      }
      if (progressCb) progressCb(page, total);
    }
    const sortFn = (a, b) => a.localeCompare(b);
    return {
      statuses: Array.from(statuses).sort(sortFn),
      priorities: Array.from(priorities).sort(sortFn),
      locations: Array.from(locations).sort(sortFn),
      staff: Array.from(staff).sort(sortFn),
      pagesSearched: page - 1,
      total,
    };
  }

  async function searchFilteredContacts(filters, maxPages, progressCb) {
    const matches = [];
    let total = 0;
    let page = 1;
    let excluded = 0;
    for (; page <= maxPages; page++) {
      const { contacts, total: t } = await fetchCustomersPage(page);
      total = t;
      if (!contacts.length) break;
      for (const c of contacts) {
        if (contactIsAutoExcluded(c)) {
          excluded++;
          continue;
        }
        if (contactMatchesFilters(c, filters)) matches.push(c);
      }
      if (progressCb) progressCb(page, matches.length, total);
    }
    return { matches, pagesSearched: page - 1, total, excluded };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "FAMFIT_START") {
      const myRun = ++runId;
      awaitingSendFor = null;
      chrome.storage.local.get("famfitBatch", (data) => {
        if (data.famfitBatch) {
          openAndFillContact(data.famfitBatch, data.famfitBatch.index, myRun);
        }
      });
      sendResponse({ ok: true });
    } else if (message.type === "FAMFIT_STOP") {
      runId++;
      awaitingSendFor = null;
      hideBadge();
      sendResponse({ ok: true });
    } else if (message.type === "FAMFIT_LOAD_FILTERED") {
      showBadge("Searching CRM...");
      searchFilteredContacts(message.filters, message.maxPages || 5, (page, found, total) => {
        showBadge(`Searching... page ${page}, ${found} match(es) so far (of ${total} total).`);
      })
        .then((result) => {
          showBadge(
            `Loaded ${result.matches.length} matching contact(s) (searched ${result.pagesSearched} page(s) of ${result.total} total, ${result.excluded} auto-excluded).`,
            "#2a7a2a"
          );
          sendResponse({ ok: true, ...result });
        })
        .catch((e) => {
          showBadge(`CRM search failed: ${e.message}`, "#a33");
          sendResponse({ ok: false, error: e.message });
        });
      return true; // async response
    } else if (message.type === "FAMFIT_GET_FILTER_OPTIONS") {
      const scanPages = message.maxPages || 10;
      showBadge(`Scanning filter options... page 1 of ${scanPages}`);
      fetchFilterOptions(scanPages, (page, total) => {
        showBadge(`Scanning filter options... page ${page} of ${scanPages} (${total} customers total)`);
      })
        .then((result) => {
          showBadge(
            `Loaded filter options (scanned ${result.pagesSearched} page(s) of ${result.total} total).`,
            "#2a7a2a"
          );
          sendResponse({ ok: true, ...result });
        })
        .catch((e) => {
          showBadge(`Couldn't load filter options: ${e.message}`, "#a33");
          sendResponse({ ok: false, error: e.message });
        });
      return true; // async response
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
