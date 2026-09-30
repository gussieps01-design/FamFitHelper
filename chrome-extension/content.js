// FamFitHelper CRM Assist - content script
//
// What this does: pre-fills the SMS textarea for one contact at a time.
// By default it NEVER clicks the CRM's own "Send message" button - a human
// clicks Send (or Ctrl+Enter), and once the send is seen to finish it moves
// on to pre-filling the next contact.
//
// Exception: if the batch has autoSend: true (set via the popup's "Auto-send"
// checkbox, opt-in and confirmed per batch), this script clicks the real
// Send button itself for every contact, unattended - see "batch engine".
//
// "Sent" = Send was clicked for this contact AND then either the CRM closed
// the message modal (what the live CRM does) or showed its green
// #flash_notice / .alert-success banner.

(function () {
  const STATUS_ID = "famfit-status-badge";
  // Shown on every badge, so it's obvious which version is actually loaded.
  let VERSION = "";
  try { VERSION = "v" + chrome.runtime.getManifest().version; } catch (e) { /* not in an extension */ }
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
    line.textContent = `FamFitHelper${VERSION ? " " + VERSION : ""}: ` + text;
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

  // Re-checks on every DOM change (MutationObserver callbacks aren't slowed
  // when the tab is in the background, unlike timers), with a slow interval
  // as a fallback. The deadline is only enforced on the fallback tick, so a
  // throttled background tab fails late rather than falsely.
  function waitFor(checkFn, timeoutMs) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      let done = false;
      const finish = (fn, v) => { done = true; obs.disconnect(); clearInterval(iv); fn(v); };
      const check = () => {
        if (done) return;
        const result = checkFn();
        if (result) finish(resolve, result);
      };
      const obs = new MutationObserver(check);
      obs.observe(document.body, { childList: true, subtree: true, attributes: true });
      const iv = setInterval(() => {
        check();
        if (!done && Date.now() - start > timeoutMs) finish(reject, new Error("timeout"));
      }, 250);
      check();
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
  //
  // The same ids can also appear on SEVERAL SMS forms at once (e.g. an old,
  // hidden copy left behind when the CRM redraws its message window), so
  // never trust getElementById here either: use the SMS form that's actually
  // visible, falling back to the newest one.
  function getSmsForm() {
    const forms = Array.from(document.querySelectorAll('form[id="new_sms_customer_message"]'));
    return forms.find((f) => isVisible(f.querySelector('[id="customer_message_message"]'))) || forms[forms.length - 1] || null;
  }

  function getSmsTextarea() {
    const smsForm = getSmsForm();
    return smsForm ? smsForm.querySelector('[id="customer_message_message"]') : null;
  }

  // Is a CRM message window (Bootstrap modal) showing?
  function messageWindowOpen() {
    return Array.from(document.querySelectorAll('#modal-window, .modal')).some(isVisible);
  }

  // Short description of the page's message-window state, added to skip
  // reasons so a failure on the live CRM says what the page looked like.
  function pageState() {
    const forms = Array.from(document.querySelectorAll('form[id="new_sms_customer_message"]'));
    const visible = forms.filter((f) => isVisible(f.querySelector('[id="customer_message_message"]'))).length;
    const windows = Array.from(document.querySelectorAll('#modal-window, .modal')).filter(isVisible).length;
    return `[page: ${forms.length} SMS form(s), ${visible} visible, ${windows} message window(s) open]`;
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
    const form = getSmsForm();
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

  // ---------- batch engine ----------
  // Built to run unattended for as long as the list is:
  //  - Every step re-reads the batch from storage and checks this tab still
  //    OWNS the run, so a second CRM tab can never run the same batch.
  //  - A contact that can't be opened/filled/confirmed is skipped and logged
  //    instead of pausing the whole run; MAX_CONSECUTIVE_FAILURES in a row
  //    (expired login, CRM change) stops the run rather than burning
  //    through the list.
  //  - `inFlight` marks a contact whose Send was clicked but not yet
  //    confirmed. If the page reloads right then, that contact is skipped on
  //    resume (logged as unconfirmed) - never texted twice.
  //  - A reloaded page auto-resumes an auto-send run that was active in the
  //    last AUTO_RESUME_WINDOW_MS.
  const MAX_CONSECUTIVE_FAILURES = 3;
  const SEND_CONFIRM_TIMEOUT_MS = 20000;
  const AUTO_RESUME_WINDOW_MS = 10 * 60 * 1000;
  const RESUME_STALE_MS = 15000; // don't take over a run another tab is actively driving
  const LAST_RUN_KEY = "famfitLastRun";
  const INSTANCE = Math.random().toString(36).slice(2);

  // Re-text cooldown: when each phone was last texted through this
  // extension ({last-10-digits: epoch ms}), in this browser. Entries older
  // than a year are dropped so it can't grow forever.
  const SENT_LOG_KEY = "famfitSentLog";
  const SENT_LOG_MAX_AGE_MS = 365 * 86400000;

  async function getSentLog() {
    return (await chrome.storage.local.get(SENT_LOG_KEY))[SENT_LOG_KEY] || {};
  }

  async function recordSent(phone) {
    const key = normalizePhone(phone);
    if (!key) return;
    const log = await getSentLog();
    const cutoff = Date.now() - SENT_LOG_MAX_AGE_MS;
    for (const k of Object.keys(log)) if (log[k] < cutoff) delete log[k];
    log[key] = Date.now();
    await chrome.storage.local.set({ [SENT_LOG_KEY]: log });
  }

  // Days since this phone was last texted, if that's within the cooldown;
  // otherwise null.
  function textedWithin(log, phone, cooldownDays) {
    if (!cooldownDays || cooldownDays <= 0) return null;
    const at = log[normalizePhone(phone)];
    if (!at) return null;
    const ageMs = Date.now() - at;
    return ageMs < cooldownDays * 86400000 ? Math.floor(ageMs / 86400000) : null;
  }

  const daysAgoText = (d) => (d === 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`);

  // Bumped by Start and Stop so timers from an old/stopped run (auto-send
  // click, advance-to-next) can't fire after the user hit Stop.
  let runId = 0;
  let activeRun = false; // this tab is currently driving a batch
  let currentIndex = -1; // batch index of the contact awaiting a send

  async function getBatch() {
    return (await chrome.storage.local.get("famfitBatch")).famfitBatch || null;
  }

  async function saveBatch(batch) {
    batch.lastActivity = Date.now();
    await chrome.storage.local.set({ famfitBatch: batch });
  }

  // The batch as this run should see it, or null if the run is over, was
  // stopped, or another tab took it over.
  async function ownedBatch(myRun) {
    if (myRun !== runId) return null;
    const batch = await getBatch();
    if (!batch || batch.owner !== INSTANCE || myRun !== runId) {
      if (myRun === runId) activeRun = false;
      return null;
    }
    return batch;
  }

  function skippedList(stats) {
    const s = (stats && stats.skipped) || [];
    if (!s.length) return "";
    const shown = s.slice(0, 8).map((x) => `${x.name} (${x.reason})`).join("; ");
    return ` Skipped: ${shown}${s.length > 8 ? `; +${s.length - 8} more (see popup)` : ""}.`;
  }

  async function finishRun(batch) {
    const stats = batch.stats || { sent: 0, skipped: [] };
    activeRun = false;
    awaitingSendFor = null;
    await chrome.storage.local.set({
      [LAST_RUN_KEY]: { finishedAt: Date.now(), total: batch.contacts.length, sent: stats.sent, skipped: stats.skipped },
    });
    await chrome.storage.local.remove("famfitBatch");
    showBadge(`Done: ${stats.sent} sent, ${stats.skipped.length} skipped of ${batch.contacts.length}.${skippedList(stats)}`, "#2a7a2a");
  }

  // Move past the current contact. outcome: {sent: true} or
  // {skipped: "<reason>", failure: true|false}. `failure` counts toward the
  // consecutive-failure stop; a plain skip (e.g. unconfirmed after reload)
  // doesn't.
  async function advance(myRun, outcome) {
    const batch = await ownedBatch(myRun);
    if (!batch) return;
    const contact = batch.contacts[batch.index];
    batch.stats = batch.stats || { sent: 0, skipped: [] };
    if (outcome.sent) {
      batch.stats.sent++;
      batch.consecutiveFailures = 0;
      await recordSent(contact.phone);
    } else {
      batch.stats.skipped.push({ name: contact.name, reason: outcome.skipped });
      if (outcome.failure) batch.consecutiveFailures = (batch.consecutiveFailures || 0) + 1;
    }
    batch.inFlight = null;
    batch.index++;
    if ((batch.consecutiveFailures || 0) >= MAX_CONSECUTIVE_FAILURES && batch.index < batch.contacts.length) {
      batch.running = false;
      await saveBatch(batch);
      activeRun = false;
      showBadge(
        `Stopped: ${MAX_CONSECUTIVE_FAILURES} contacts in a row failed - something's wrong (logged out? CRM page changed?). ` +
          `Fix it, then click Start to continue from contact ${batch.index + 1} of ${batch.contacts.length}.${skippedList(batch.stats)}`,
        "#a33"
      );
      return;
    }
    await saveBatch(batch);
    const delayMs = outcome.sent && batch.autoSend ? Math.max(1, batch.delaySec || 5) * 1000 : 1500;
    setTimeout(() => openAndFillContact(myRun), delayMs);
  }

  async function openAndFillContact(myRun) {
    const batch = await ownedBatch(myRun);
    if (!batch) return;
    const index = batch.index;
    if (index >= batch.contacts.length) {
      await finishRun(batch);
      return;
    }
    const contact = batch.contacts[index];
    // Send was clicked for this contact but the page reloaded before it was
    // confirmed - it may well have gone out, so never send it again.
    if (batch.inFlight === index) {
      await advance(myRun, { skipped: "send not confirmed before the page reloaded - check it in the CRM", failure: false });
      return;
    }
    // Checked again right before texting (not just at Load): catches people
    // texted since the list was loaded, e.g. Stop then Start on the same list.
    const recent = textedWithin(await getSentLog(), contact.phone, batch.cooldownDays);
    if (recent !== null) {
      await advance(myRun, { skipped: `already texted ${daysAgoText(recent)}`, failure: false });
      return;
    }
    showBadge(`Finding ${contact.name} (${index + 1} of ${batch.contacts.length})...`);

    // Mark whatever modal is already in the page as stale, so the waits
    // below only succeed once the CRM has loaded FRESH content for this
    // contact - otherwise the leftover form (a previous contact's, or this
    // same contact's from an earlier attempt, even while hidden or briefly
    // still showing) would be filled instead of the real one.
    const STALE = "data-famfit-stale";
    document.querySelectorAll('a[href="#messages"]').forEach((el) => el.setAttribute(STALE, "1"));
    document.querySelectorAll('form[id="new_sms_customer_message"] [id="customer_message_message"]').forEach((el) => el.setAttribute(STALE, "1"));
    // Fresh = new nodes, or (if the CRM re-uses the same nodes) the form now
    // names THIS contact and its box has been emptied.
    const isFresh = (el) =>
      !!el &&
      (!el.hasAttribute(STALE) || (smsFormExplicitlyFor(contact) && !!getSmsTextarea() && getSmsTextarea().value === ""));

    if (!openContactModal(contact)) {
      showBadge(`Couldn't find "${contact.name}" on this page - skipping.`, "#a33");
      awaitingSendFor = null;
      await advance(myRun, { skipped: "not on this page (pasted contact)", failure: true });
      return;
    }

    let step = "the message window to load";
    try {
      // A fresh Messaging tab link (there can be leftover copies on the page).
      const messagesTab = await waitFor(
        () => Array.from(document.querySelectorAll('a[href="#messages"]')).find(isFresh) || null,
        15000
      );
      const root = messagesTab.closest("#modal-window, .modal") || document;
      messagesTab.click();
      step = "the SMS tab";
      const smsTab = await waitFor(() => root.querySelector('a[href="#smss"]'), 8000);
      smsTab.click();
      // The CRM can redraw the window while loading; keep nudging it back to
      // the SMS tab until the SMS box is showing.
      step = "the SMS box to show";
      let lastNudge = Date.now();
      await waitFor(() => {
        const t = getSmsTextarea();
        if (isFresh(t) && isVisible(t)) return t;
        if (Date.now() - lastNudge > 1000) {
          lastNudge = Date.now();
          showSmsTab();
        }
        return null;
      }, 10000);
      step = "a box for the right customer";
      if (!smsFormBelongsTo(contact)) throw new Error("wrong contact in modal");
    } catch (e) {
      if (myRun !== runId) return;
      showBadge(`Couldn't open the message box for ${contact.name} - skipping.`, "#a33");
      awaitingSendFor = null;
      await advance(myRun, { skipped: `message box didn't open - gave up waiting for ${step} ${pageState()}`, failure: true });
      return;
    }
    if (myRun !== runId) return;

    const [firstName, ...rest] = (contact.name || "").split(" ");
    // Rotate through the template's versions: each contact gets the next
    // one, starting from a random version per batch.
    const variants = famfitSplitVariants(batch.templateText);
    const pick = batch.rotate === false ? 0 : ((batch.variantOffset || 0) + index) % Math.max(1, variants.length);
    const variant = variants.length ? variants[pick] : "";
    const rendered = famfitRenderTemplate(variant, {
      first_name: firstName || "",
      last_name: rest.join(" "),
      staff: contact.staff || batch.staff || "",
      location: contact.location || batch.location || "",
    });

    const textarea = getSmsTextarea();
    fillBox(textarea, rendered);
    textarea.scrollIntoView({ behavior: "smooth", block: "center" });
    textarea.focus();

    // famfitRenderTemplate leaves {{field}} in place when the value is empty
    // (e.g. no staff on the contact and no fallback picked) - never let that
    // literal text go out unattended.
    const unfilled = [...new Set(rendered.match(/\{\{\w+\}\}/g) || [])];
    if (unfilled.length && batch.autoSend) {
      await advance(myRun, { skipped: `message had blank ${unfilled.join(", ")}`, failure: true });
      return;
    }

    awaitingSendFor = contact;
    currentIndex = index;
    ensureSendObserver();
    ensureSendListeners();
    watchForSend(contact, myRun, batch.autoSend && !unfilled.length, unfilled.length ? "" : rendered, textarea);

    if (unfilled.length) {
      showBadge(
        `${contact.name}: the message still has ${unfilled.join(", ")} - fill it in by hand before sending.`,
        "#a33"
      );
    } else if (batch.autoSend) {
      showBadge(
        `Auto-sending to ${contact.name} (${index + 1} of ${batch.contacts.length}) - no manual review`,
        "#a33"
      );
      setTimeout(async () => {
        if (myRun !== runId || awaitingSendFor !== contact) return;
        // Right before the irreversible click: only click when the visible
        // box for THIS contact holds this message. The CRM gets a few
        // seconds to settle, and may reformat the text a little (spacing,
        // line endings, something appended) - the message just has to be in
        // there. If a check still fails, skip with the exact reason.
        let why = "";
        const ready = () => {
          const box = getSmsTextarea();
          const btn = getSendButton();
          if (!btn) { why = "the CRM's Send button wasn't found"; return null; }
          if (!box || !isVisible(box)) { why = "the message box wasn't visible"; return null; }
          if (!smsFormBelongsTo(contact)) { why = "the message box was for a different customer"; return null; }
          if (!normText(rendered)) { why = "the message is empty"; return null; }
          if (!normText(box.value).includes(normText(rendered))) {
            why = `the message box text didn't match what was typed (box has ${box.value.length} characters, message has ${rendered.length})`;
            return null;
          }
          return btn;
        };
        let sendBtn = null;
        try { sendBtn = await waitFor(ready, 8000); } catch (e) { /* why says which check failed */ }
        if (myRun !== runId || awaitingSendFor !== contact) return;
        if (!sendBtn) {
          awaitingSendFor = null;
          advance(myRun, { skipped: `auto-send didn't click Send - ${why} ${pageState()}`, failure: true });
          return;
        }
        // Record the send as in flight first, so a reload can't resend it.
        const b = await ownedBatch(myRun);
        if (!b || b.index !== index || awaitingSendFor !== contact) return;
        b.inFlight = index;
        await saveBatch(b);
        if (myRun !== runId || awaitingSendFor !== contact) return;
        sendBtn.click();
      }, 400);
      // If the CRM rejects the send, the box just stays open. Skip and keep
      // going rather than stall; the skip is logged, and repeated failures
      // stop the run. Never resend: the send may have gone out undetected.
      setTimeout(() => {
        if (myRun !== runId || awaitingSendFor !== contact) return;
        awaitingSendFor = null;
        advance(myRun, { skipped: "send not confirmed within 20s - check it in the CRM", failure: true });
      }, SEND_CONFIRM_TIMEOUT_MS);
    } else {
      showReadyBadge(contact, index + 1, batch.contacts.length);
    }
  }

  // Whitespace/line-ending-insensitive form of a message, for comparing what
  // was typed with what the CRM's box ends up holding.
  function normText(s) {
    return (s || "").normalize("NFC").replace(/\s+/g, " ").trim();
  }

  function isVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  // The SMS form's own Send button; falls back to a visible element with that
  // id in case the button sits outside the form (ids are duplicated on this
  // page, so never trust a bare getElementById).
  function getSendButton() {
    const smsForm = getSmsForm();
    const scoped = smsForm && smsForm.querySelector('[id="submit_sms_message"]');
    if (scoped) return scoped;
    return Array.from(document.querySelectorAll('[id="submit_sms_message"]')).find(isVisible) || null;
  }

  // Set when Send is clicked (by mouse, Ctrl+Enter, or auto-send) for the
  // contact currently awaiting a send. A send only counts as done after this.
  let sendClicked = false;
  // The SMS box and its text at the moment Send was clicked - to recognise
  // the CRM refreshing the message window after a send (fresh empty box)
  // rather than closing it.
  let sendClickedBox = null;
  let sendClickedText = "";

  function fillBox(box, text) {
    box.value = text;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Bring the SMS tab of the message window back to the front.
  function showSmsTab() {
    // The open message window (the newest one if several), else the page.
    const open = Array.from(document.querySelectorAll('#modal-window, .modal')).filter(isVisible);
    const root = open[open.length - 1] || document.getElementById("modal-window") || document;
    const smsPane = root.querySelector("#smss");
    const messagesTab = root.querySelector('a[href="#messages"]');
    const smsTab = root.querySelector('a[href="#smss"]');
    if (messagesTab && !(smsPane && isVisible(smsPane))) messagesTab.click();
    if (smsTab) smsTab.click();
  }

  const CLOSED_AFTER_MS = 1500;
  const MAX_TAB_FIXES = 6;

  // The CRM closes the message modal after a successful send. Once Send was
  // clicked, the box disappearing = sent -> advance. If the box closes WITHOUT
  // a Send click, the contact is left where it is so Start brings them back.
  //
  // The CRM also redraws the message window on its own (e.g. after loading
  // the conversation), which can briefly remove the SMS box, swap in a fresh
  // empty one, or flip back to another tab. None of that is "closed":
  //  - "closed" = the SMS box has been gone for CLOSED_AFTER_MS straight
  //    while the message window itself is not showing
  //  - window showing but SMS box hidden -> click back to the SMS tab
  //  - a NEW, empty SMS box -> type the message into it again (a box the
  //    user has edited is never overwritten)
  function watchForSend(contact, myRun, autoSend, rendered, filledBox) {
    sendClicked = false;
    let done = false;
    let lastSeen = Date.now();
    let tabFixes = 0;
    let lastTabFix = 0;
    const stop = () => { done = true; obs.disconnect(); clearInterval(iv); };
    const check = () => {
      if (done) return;
      if (myRun !== runId || awaitingSendFor !== contact) { stop(); return; }
      const box = getSmsTextarea();
      if (isVisible(box)) {
        lastSeen = Date.now();
        // After Send: the CRM refreshing the window (a new box, or the
        // message cleared out of it) means the send went through.
        if (sendClicked && sendClickedText && (box !== sendClickedBox || !normText(box.value))) {
          stop();
          handleSendDetected();
          return;
        }
        if (!sendClicked && box !== filledBox && rendered && !normText(box.value) && smsFormBelongsTo(contact)) {
          fillBox(box, rendered);
          filledBox = box;
        }
        return;
      }
      if (!sendClicked && messageWindowOpen()) {
        lastSeen = Date.now();
        if (tabFixes < MAX_TAB_FIXES && Date.now() - lastTabFix > 700) {
          tabFixes++;
          lastTabFix = Date.now();
          showSmsTab();
        }
        return;
      }
      if (Date.now() - lastSeen < CLOSED_AFTER_MS) return;
      stop();
      if (sendClicked) {
        handleSendDetected();
      } else if (autoSend) {
        awaitingSendFor = null;
        advance(myRun, { skipped: `message box closed before sending ${pageState()}`, failure: true });
      } else {
        awaitingSendFor = null;
        activeRun = false;
        showBadge(`${contact.name}'s message box was closed without sending. Reopen the popup and click Start to bring them back up.`, "#b7791f");
      }
    };
    // DOM changes (modal hiding) re-check immediately, even in a background
    // tab; the interval is a fallback.
    const obs = new MutationObserver(check);
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    const iv = setInterval(check, 300);
  }

  // Capture phase on window, so the CRM's own handlers on the message box
  // can't swallow the keypress/click before we see it.
  //
  // Ctrl+Enter while the message box is focused clicks the exact same real
  // Send button a mouse click would - this is a faster INPUT method for the
  // same human decision, not a different decision. It only fires while focus
  // is inside THIS contact's SMS form, so it can't fire accidentally from
  // elsewhere on the page or for a message not on screen.
  let listenersStarted = false;
  function ensureSendListeners() {
    if (listenersStarted) return;
    listenersStarted = true;
    window.addEventListener("click", (e) => {
      if (!awaitingSendFor) return;
      if (!(e.target.closest && e.target.closest('[id="submit_sms_message"]'))) return;
      sendClicked = true;
      sendClickedBox = getSmsTextarea();
      sendClickedText = normText(sendClickedBox && sendClickedBox.value);
      // A human's click: mark it in flight too, so a reload right now can't
      // bring this contact back up to be texted again.
      const idx = currentIndex;
      getBatch().then((b) => {
        if (b && b.owner === INSTANCE && b.index === idx && b.inFlight !== idx) {
          b.inFlight = idx;
          saveBatch(b);
        }
      });
    }, true);
    window.addEventListener("keydown", (e) => {
      if (!awaitingSendFor) return;
      if (!(e.key === "Enter" && (e.ctrlKey || e.metaKey))) return;
      const smsForm = getSmsForm();
      if (!smsForm || !smsForm.contains(document.activeElement)) return;
      e.preventDefault();
      e.stopPropagation();
      const sendBtn = getSendButton();
      if (sendBtn) sendBtn.click();
    }, true);
  }

  function ensureSendObserver() {
    if (observerStarted) return;
    observerStarted = true;
    const observer = new MutationObserver((mutations) => {
      if (!awaitingSendFor || !sendClicked) return;
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
    if (!awaitingSendFor) return; // banner and modal-close can both fire for one send
    const sentContact = awaitingSendFor;
    const myRun = runId;
    awaitingSendFor = null;
    showBadge(`Sent to ${sentContact.name}. Moving to next...`, "#2a7a2a");
    await advance(myRun, { sent: true });
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

  // ---- CRM-side filtering. The grid endpoint accepts Kendo-style filters,
  // checked against the live CRM:
  //   works:   status (by numeric code, NOT name), priority (by name),
  //            user_id, idle gte/lte, created_at gte (YYYY-MM-DD), all
  //            ANDed together with one value per field
  //   broken:  nested OR groups (a status OR-group plus any other filter
  //            returns 0 rows), location / location_id (bogus totals),
  //            user by name, "neq"
  // So multiple picks in one box become one plain-AND query per value
  // combination, merged; location and the Dead/bounced/unsubscribed
  // exclusions stay client-side; and every row is re-checked with
  // contactMatchesFilters - the server can only narrow the list, never add
  // a wrong contact. ----
  const MAPS_KEY = "famfitCrmMaps"; // {statusCodes: {name: code}, staffIds: {name: [ids]}}
  const MAX_STATUS_CODE = 24;
  const MAX_SERVER_QUERIES = 12;

  // clauses: [[field, op, value], ...] - one value each, ANDed.
  function filterParams(clauses) {
    const out = [];
    if (!clauses.length) return out;
    out.push(["filter[logic]", "and"]);
    clauses.forEach(([field, op, value], i) => {
      const pre = `filter[filters][${i}]`;
      out.push([`${pre}[field]`, field], [`${pre}[operator]`, op], [`${pre}[value]`, String(value)]);
    });
    return out;
  }

  // Multi-value clauses -> every single-value combination. If that would be
  // more than MAX_SERVER_QUERIES queries, the widest fields are dropped from
  // the server side (still enforced client-side) until it fits.
  function expandClauses(clauses) {
    const list = clauses.map((c) => c.slice());
    const count = () => list.reduce((n, [, , vals]) => n * vals.length, 1);
    const dropped = [];
    while (count() > MAX_SERVER_QUERIES) {
      let widest = 0;
      list.forEach((c, i) => { if (c[2].length > list[widest][2].length) widest = i; });
      dropped.push(list[widest][0]);
      list.splice(widest, 1);
    }
    let combos = [[]];
    for (const [field, op, vals] of list) {
      combos = combos.flatMap((combo) => vals.map((v) => [...combo, [field, op, v]]));
    }
    return { combos, dropped };
  }

  function localDateString(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // Returns the server clauses plus which filters they cover. A filter whose
  // values can't all be mapped (e.g. a staff name with no known id) is left
  // off the server query entirely and handled client-side.
  function buildServerClauses(f, maps) {
    const clauses = [];
    const used = [];
    const statusCodes = (maps && maps.statusCodes) || {};
    const staffIds = (maps && maps.staffIds) || {};
    if (f.status && f.status.length) {
      const codes = f.status.map((s) => statusCodes[s]);
      if (codes.every((c) => c !== undefined)) { clauses.push(["status", "eq", codes]); used.push("status"); }
    }
    if (f.priority && f.priority.length) { clauses.push(["priority", "eq", f.priority]); used.push("priority"); }
    if (f.staff && f.staff.length) {
      const ids = f.staff.map((s) => staffIds[s]);
      if (ids.every((x) => x && x.length)) { clauses.push(["user_id", "eq", [].concat(...ids)]); used.push("staff"); }
    }
    if (f.idleMin != null) { clauses.push(["idle", "gte", [f.idleMin]]); used.push("idle min"); }
    if (f.idleMax != null) { clauses.push(["idle", "lte", [f.idleMax]]); used.push("idle max"); }
    if (f.signedWithinDays != null) {
      // One extra day of slack so timezone differences can only widen the
      // server result; the exact cut is made client-side.
      clauses.push(["created_at", "gte", [localDateString(new Date(Date.now() - (f.signedWithinDays + 1) * 86400000))]]);
      used.push("signed within");
    }
    return { clauses, used };
  }

  async function fetchGrid(page, pageSize, extraParams) {
    const params = new URLSearchParams({ take: pageSize, skip: (page - 1) * pageSize, page, pageSize });
    for (const [k, v] of extraParams || []) params.append(k, v);
    const resp = await fetch(`/customers_grid.json?${params}`, { credentials: "include" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return resp.json();
  }

  // Status names -> numeric codes, by asking the CRM for 1 row per code.
  // Also yields the complete status list with counts (the page scan only
  // sees statuses present among the most recent customers).
  async function probeStatusCodes() {
    const statusCodes = {};
    await Promise.all(
      Array.from({ length: MAX_STATUS_CODE + 1 }, (_, code) =>
        fetchGrid(1, 1, filterParams([["status", "eq", code]]))
          .then((p) => {
            const row = (p.data || [])[0];
            if (p.total && row && row.status) statusCodes[row.status.trim()] = code;
          })
          .catch(() => {})
      )
    );
    return statusCodes;
  }

  async function loadMaps() {
    const data = await chrome.storage.local.get(MAPS_KEY);
    return data[MAPS_KEY] || { statusCodes: {}, staffIds: {} };
  }

  async function fetchCustomersPage(page, extraParams) {
    const payload = await fetchGrid(page, 100, extraParams);
    const contacts = (payload.data || [])
      .filter((r) => r.fullname)
      .map((r) => ({
        id: r.id,
        name: r.fullname,
        phone: r.phone || "",
        staff: r.user || "",
        staff_id: r.user_id,
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
    const staffIds = {};
    let total = 0;
    let page = 1;
    const statusProbe = probeStatusCodes();
    for (; page <= maxPages; page++) {
      const { contacts, total: t } = await fetchCustomersPage(page);
      total = t;
      if (!contacts.length) break;
      for (const c of contacts) {
        if (c.status) statuses.add(c.status.trim());
        if (c.priority) priorities.add(c.priority.trim());
        if (c.location) locations.add(c.location.trim());
        if (c.staff) {
          const name = c.staff.trim();
          staff.add(name);
          if (c.staff_id != null) {
            staffIds[name] = staffIds[name] || [];
            if (!staffIds[name].includes(c.staff_id)) staffIds[name].push(c.staff_id);
          }
        }
      }
      if (progressCb) progressCb(page, total);
    }
    const statusCodes = await statusProbe;
    Object.keys(statusCodes).forEach((s) => statuses.add(s));
    await chrome.storage.local.set({ [MAPS_KEY]: { statusCodes, staffIds } });
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

  async function searchFilteredContacts(filters, maxPages, progressCb, cooldownDays) {
    const maps = await loadMaps();
    const sentLog = await getSentLog();
    let recentlyTexted = 0;
    // Selected statuses with no known code (maps from an older scan) -> re-probe once.
    if ((filters.status || []).some((s) => maps.statusCodes[s] === undefined)) {
      maps.statusCodes = { ...maps.statusCodes, ...(await probeStatusCodes()) };
      await chrome.storage.local.set({ [MAPS_KEY]: maps });
    }
    const { clauses, used } = buildServerClauses(filters, maps);
    const { combos, dropped } = expandClauses(clauses);
    const fieldLabel = { status: "status", priority: "priority", user_id: "staff" };
    const serverFiltered = used.filter((u) => !dropped.some((d) => fieldLabel[d] === u));

    // maxPages is a budget across all combination queries together.
    const matches = [];
    const seen = new Set();
    const seenPhones = new Set();
    let duplicates = 0;
    let total = 0;
    let pagesSearched = 0;
    let excluded = 0;
    let complete = true;
    for (const combo of combos) {
      const extra = filterParams(combo);
      let comboTotal = 0;
      let page = 1;
      for (; ; page++) {
        if (pagesSearched >= maxPages) { complete = false; break; }
        const { contacts, total: t } = await fetchCustomersPage(page, extra);
        pagesSearched++;
        if (page === 1) { comboTotal = t; total += t; }
        for (const c of contacts) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          // No phone = can't be texted; under auto-send the CRM would reject
          // the send and stall the batch.
          if (contactIsAutoExcluded(c) || !c.phone.trim()) {
            excluded++;
            continue;
          }
          if (!contactMatchesFilters(c, filters)) continue;
          if (textedWithin(sentLog, c.phone, cooldownDays) !== null) {
            recentlyTexted++;
            continue;
          }
          // Several customer records can share one phone - text it once.
          const phoneKey = normalizePhone(c.phone);
          if (seenPhones.has(phoneKey)) {
            duplicates++;
            continue;
          }
          seenPhones.add(phoneKey);
          matches.push(c);
        }
        if (progressCb) progressCb(pagesSearched, matches.length, total);
        if (!contacts.length || page * 100 >= comboTotal) break;
      }
    }
    return { matches, pagesSearched, total, excluded, duplicates, recentlyTexted, serverFiltered, complete };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "FAMFIT_START") {
      startRun().then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: e.message }));
      return true; // async response
    } else if (message.type === "FAMFIT_STOP") {
      runId++;
      activeRun = false;
      awaitingSendFor = null;
      hideBadge();
      sendResponse({ ok: true });
    } else if (message.type === "FAMFIT_LOAD_FILTERED") {
      showBadge("Searching CRM...");
      searchFilteredContacts(message.filters, message.maxPages || 5, (page, found, total) => {
        showBadge(`Searching... ${page} page(s) read, ${found} match(es) so far.`);
      }, message.cooldownDays)
        .then((result) => {
          showBadge(
            result.complete
              ? `Loaded ${result.matches.length} matching contact(s) - searched all ${result.total} CRM match(es), ${result.excluded} auto-excluded.`
              : `Loaded ${result.matches.length} contact(s) from the first ${result.pagesSearched} page(s) of ${result.total} CRM match(es) - raise "Search up to N pages" to get the rest.`,
            result.complete ? "#2a7a2a" : "#b7791f"
          );
          sendResponse({ ok: true, ...result });
        })
        .catch((e) => {
          showBadge(`CRM search failed: ${e.message}`, "#a33");
          sendResponse({ ok: false, error: e.message });
        });
      return true; // async response
    } else if (message.type === "FAMFIT_GET_FILTER_OPTIONS") {
      // Runs every time the popup opens - keep it from overwriting the badge
      // of a batch this tab is running.
      const scanBadge = (text, color) => { if (!activeRun) showBadge(text, color); };
      const scanPages = message.maxPages || 10;
      scanBadge(`Scanning filter options... page 1 of ${scanPages}`);
      fetchFilterOptions(scanPages, (page, total) => {
        scanBadge(`Scanning filter options... page ${page} of ${scanPages} (${total} customers total)`);
      })
        .then((result) => {
          scanBadge(
            `Loaded filter options (scanned ${result.pagesSearched} page(s) of ${result.total} total).`,
            "#2a7a2a"
          );
          sendResponse({ ok: true, ...result });
        })
        .catch((e) => {
          scanBadge(`Couldn't load filter options: ${e.message}`, "#a33");
          sendResponse({ ok: false, error: e.message });
        });
      return true; // async response
    }
    return true;
  });

  // Claim the stored batch for this tab and drive it.
  async function startRun() {
    const myRun = ++runId;
    awaitingSendFor = null;
    const batch = await getBatch();
    if (!batch) return;
    batch.owner = INSTANCE;
    batch.running = true;
    batch.consecutiveFailures = 0;
    await saveBatch(batch);
    activeRun = true;
    openAndFillContact(myRun);
  }

  // While this tab drives a run, keep a heartbeat fresh so another tab
  // loading the CRM can tell the run is alive and not take it over. It has
  // its own key: re-saving the whole batch here could overwrite a newer
  // batch (e.g. just-advanced index) with a stale copy.
  const HEARTBEAT_KEY = "famfitHeartbeat";
  setInterval(() => {
    if (activeRun) chrome.storage.local.set({ [HEARTBEAT_KEY]: Date.now() });
  }, 5000);

  async function lastRunActivity(batch) {
    const hb = (await chrome.storage.local.get(HEARTBEAT_KEY))[HEARTBEAT_KEY] || 0;
    return Math.max(batch.lastActivity || 0, hb);
  }

  // Page (re)loaded with a batch stored: an auto-send run that was active
  // recently resumes by itself; anything else waits for Start.
  getBatch().then(async (b) => {
    if (!b) return;
    const seen = await lastRunActivity(b);
    const idle = Date.now() - seen;
    if (b.autoSend && b.running && idle < AUTO_RESUME_WINDOW_MS) {
      const wait = Math.max(3000, RESUME_STALE_MS - idle);
      showBadge(`Page reloaded - resuming auto-send at contact ${b.index + 1} of ${b.contacts.length} in ${Math.round(wait / 1000)}s (Stop in the popup to cancel)...`, "#b7791f");
      setTimeout(async () => {
        const now = await getBatch();
        // Stopped meanwhile, or another tab is actively running it.
        if (!now || !now.running) { hideBadge(); return; }
        const nowSeen = await lastRunActivity(now);
        if (nowSeen !== seen && Date.now() - nowSeen < RESUME_STALE_MS) { hideBadge(); return; }
        startRun();
      }, wait);
    } else {
      showBadge(`Batch in progress (${b.index + 1}/${b.contacts.length}). Reopen the popup and click Start to resume.`);
    }
  });
})();
