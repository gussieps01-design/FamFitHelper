// End-to-end tests: the REAL extension content script against the mock CRM
// (real jQuery/Bootstrap/jquery_ujs behaviour, the CRM's own Send code).
// Open http://localhost:4567/customers?harness=1 - results show on the page
// and in window.results / window.testsDone.
(function () {
  const $ = window.jQuery;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const badge = () => (document.getElementById("famfit-status-badge") || {}).textContent || "";
  async function until(fn, ms = 10000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch (e) { /* not yet */ } await sleep(150); } return false; }
  const api = (path, body) => fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  const results = (window.results = window.results || []);
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });

  const visibleBox = () => $('#modal-window').first().find('#new_sms_customer_message textarea').filter(function () { return this.offsetWidth || this.offsetHeight; })[0];
  const humanSend = () => $('#modal-window').first().find('#submit_sms_message')[0].click();
  const TEMPLATE = "Hi {{first_name}}, this is {{staff}} from {{location}}!";
  const render = (c, tpl) => (tpl || TEMPLATE).replace("{{first_name}}", c.name.split(" ")[0]).replace("{{staff}}", c.staff).replace("{{location}}", c.location);

  async function resetAll(settings) {
    await sendMsg({ type: "FAMFIT_STOP" });
    window.mockStore.clear();
    await api("/mock/reset", {});
    if (settings) await api("/mock/settings", settings);
    $("#modal-window").first().modal("hide");
    $(".alert").remove();
    await sleep(700);
  }

  // Customers the extension would text: has a phone, not Dead/bounced/
  // unsubscribed, unique phone. Their seeded history is cleared so the
  // re-text cooldown doesn't interfere unless a test wants it to.
  let pool = null;
  async function textable(n) {
    if (!pool) {
      const all = await api("/mock/customers");
      const seen = new Set();
      pool = all.filter((c) => c.phone && c.priority !== "Dead" && c.phone_subscription_status === "phone_active" && c.user !== "Unassigned" && !seen.has(c.phone) && seen.add(c.phone));
    }
    const picked = pool.splice(0, n);
    for (const c of picked) await api("/mock/history", { id: c.id, rows: [] });
    return picked.map((c) => ({ id: c.id, name: c.fullname, phone: c.phone, staff: c.user, location: c.location }));
  }

  async function startBatch(contacts, extra) {
    await window.mockStore.set("famfitBatch", { contacts, templateText: TEMPLATE, staff: "", location: "", autoSend: false, delaySec: 1, cooldownDays: 0, index: 0, rotate: true, variantOffset: 0, sendWindow: null, ...extra });
    return sendMsg({ type: "FAMFIT_START" });
  }
  const sentNow = () => api("/mock/sent");

  async function run() {
    const phase = sessionStorage.getItem("famfitMockTestPhase");
    if (phase === "afterReload") return afterReload();

    // ---- Load: filter options and search, with the CRM's real filter quirks
    await resetAll();
    const opts = await sendMsg({ type: "FAMFIT_GET_FILTER_OPTIONS", maxPages: 5 });
    check("filter options: every status (found via status codes), priority and staff are listed", opts.ok && ["Member", "Guest", "Trial", "Corporate", "Contest Box", "Phone Inquiry", "Former Member", "Member Referral", "Event"].every((s) => opts.statuses.includes(s)) && opts.priorities.includes("Hot") && opts.staff.includes("Alex Demo"), opts);
    const filters = { status: ["Trial", "Guest"], priority: [], location: [], staff: ["Alex Demo", "Sam Example"], idleMin: 10, idleMax: null, signedWithinDays: null };
    const res = await sendMsg({ type: "FAMFIT_LOAD_FILTERED", filters, maxPages: 20, cooldownDays: 0 });
    const all = await api("/mock/customers");
    const seen = new Set();
    const brute = all.filter((c) => ["Trial", "Guest"].includes(c.status) && ["Alex Demo", "Sam Example"].includes(c.user) && c.idle >= 10 && c.phone && c.priority !== "Dead" && !["phone_bounced", "phone_unsubscribed"].includes(c.phone_subscription_status)).filter((c) => { const k = c.phone.replace(/\D/g, "").slice(-10); if (seen.has(k)) return false; seen.add(k); return true; });
    const got = (res.matches || []).map((c) => c.id).sort().join();
    check("Load finds exactly the right customers (status OR + staff OR + idle, despite the CRM's broken OR groups)", res.ok && got === brute.map((c) => c.id).sort().join() && brute.length > 0, { got: (res.matches || []).length, want: brute.length });

    // ---- Manual: fill, human clicks Send, advances
    await resetAll();
    let cs = await textable(2);
    await startBatch(cs);
    const filled1 = await until(() => visibleBox() && visibleBox().value === render(cs[0]));
    check("manual: opens the first customer's SMS box (Messaging > SMS) and fills it", filled1, badge());
    humanSend();
    const filled2 = await until(() => visibleBox() && visibleBox().value === render(cs[1]), 15000);
    const s1 = await sentNow();
    check("manual: Send goes through the CRM's own code, and it moves to the next customer", filled2 && s1.length === 1 && s1[0].id === cs[0].id && s1[0].text === render(cs[0]), { badge: badge(), sent: s1 });
    // Ctrl+Enter on the second
    visibleBox().focus();
    visibleBox().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    const ce = await until(async () => (await sentNow()).length === 2 && /Done: 2 sent/.test(badge()), 15000);
    check("manual: Ctrl+Enter sends too", ce, badge());

    // ---- Auto-send, window REFRESHES after each send (what the live CRM did)
    await resetAll({ afterSend: "refresh" });
    cs = await textable(5);
    await startBatch(cs, { autoSend: true });
    const okR = await until(() => /Done: 5 sent, 0 skipped of 5/.test(badge()), 60000);
    let s = await sentNow();
    check("auto-send, window refreshes after send: all 5 sent, in order, right text, once each", okR && s.map((x) => x.id).join() === cs.map((c) => c.id).join() && s.every((x, i) => x.text === render(cs[i])), { badge: badge(), sent: s.map((x) => x.id) });

    // ---- Same, with slow window animations (a background tab slows the
    // CRM's own timers): the next contact must not be opened while the
    // window is still animating - the open link is a toggle.
    if (new URLSearchParams(location.search).get("slow")) {
      await resetAll({ afterSend: "refresh" });
      cs = await textable(4);
      await startBatch(cs, { autoSend: true });
      const okSlow = await until(() => /Done: 4 sent, 0 skipped of 4/.test(badge()), 120000);
      check("slow window animations (background tab): all 4 sent, none skipped", okSlow, badge());
    }

    // ---- Auto-send, window CLOSES after each send
    await resetAll({ afterSend: "close" });
    cs = await textable(3);
    await startBatch(cs, { autoSend: true });
    const okC = await until(() => /Done: 3 sent, 0 skipped of 3/.test(badge()), 45000);
    s = await sentNow();
    check("auto-send, window closes after send: all 3 sent once", okC && s.length === 3, { badge: badge(), sent: s.length });

    // ---- A send the CRM rejects
    await resetAll();
    cs = await textable(3);
    await api("/mock/settings", { rejectIds: [cs[1].id] });
    await startBatch(cs, { autoSend: true, cooldownDays: 7 });
    const okRj = await until(() => /Done: 2 sent, 1 skipped of 3/.test(badge()), 60000);
    check("rejected send: reported NOT sent (and the others still go out)", okRj && new RegExp(cs[1].name + " \\(NOT sent").test(badge()) && !(window.mockStore.get("famfitSentLog") || {})[cs[1].phone.replace(/\D/g, "").slice(-10)], badge());

    // ---- Logged out
    await resetAll();
    cs = await textable(4);
    await api("/mock/settings", { loggedOut: true });
    await startBatch(cs, { autoSend: true });
    const okLo = await until(() => /Stopped: 3 contacts in a row failed/.test(badge()), 90000);
    check("logged out: stops after 3 failures instead of burning through the list", okLo && (await sentNow()).length === 0, badge());

    // ---- Re-text cooldown from the CRM's own history
    await resetAll();
    cs = await textable(3);
    await api("/mock/history", { id: cs[0].id, rows: [{ user: "Sam Example", status: "sent", daysAgo: 2 }] });
    await api("/mock/history", { id: cs[1].id, rows: [{ user: "SYSTEM", status: "sent", daysAgo: 1 }] });
    await api("/mock/history", { id: cs[2].id, rows: [{ user: "Sam Example", status: "failed", daysAgo: 1 }] });
    await startBatch(cs, { autoSend: true, cooldownDays: 7 });
    const okH = await until(() => /Done: 2 sent, 1 skipped of 3/.test(badge()), 45000);
    check("cooldown checks CRM history: staff text 2 days ago skipped; automated and failed texts don't block", okH && /already texted 2 days ago \(CRM history\)/.test(badge()), badge());

    // ---- Sending hours
    await resetAll();
    cs = await textable(2);
    const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    await startBatch(cs, { autoSend: true, sendWindow: { start: hhmm(new Date(Date.now() + 2 * 3600000)), end: hhmm(new Date(Date.now() + 3 * 3600000)) } });
    await sleep(3000);
    const paused = /Auto-send paused - outside sending hours/.test(badge()) && (await sentNow()).length === 0;
    const b = window.mockStore.get("famfitBatch"); b.sendWindow = null; await window.mockStore.set("famfitBatch", b);
    const okHr = await until(() => /Done: 2 sent/.test(badge()), 45000);
    check("sending hours: pauses outside them, carries on when they start", paused && okHr, badge());

    // ---- Rotating versions
    await resetAll();
    cs = await textable(3);
    const tpl = "A {{first_name}}\n---\nB {{first_name}}";
    await startBatch(cs, { autoSend: true, templateText: tpl, rotate: true, variantOffset: 0 });
    await until(() => /Done: 3 sent/.test(badge()), 45000);
    s = await sentNow();
    check("rotation: versions A, B, A", s.map((x) => x.text.split(" ")[0]).join() === "A,B,A", s.map((x) => x.text));

    // ---- Stop mid-run
    await resetAll();
    cs = await textable(4);
    await startBatch(cs, { autoSend: true, delaySec: 4 });
    await until(async () => (await sentNow()).length === 1, 20000);
    await sendMsg({ type: "FAMFIT_STOP" });
    await sleep(8000);
    check("Stop mid-run: nothing more is sent", (await sentNow()).length === 1, (await sentNow()).length);

    // ---- Page reload mid-run (continues in afterReload())
    await resetAll();
    cs = await textable(3);
    sessionStorage.setItem("famfitMockReloadIds", JSON.stringify(cs.map((c) => c.id)));
    await startBatch(cs, { autoSend: true, delaySec: 3 });
    await until(async () => (await sentNow()).length === 1, 20000);
    sessionStorage.setItem("famfitMockTestPhase", "afterReload");
    sessionStorage.setItem("famfitMockResults", JSON.stringify(results));
    location.reload();
  }

  async function afterReload() {
    sessionStorage.removeItem("famfitMockTestPhase");
    results.push(...JSON.parse(sessionStorage.getItem("famfitMockResults") || "[]"));
    const ids = JSON.parse(sessionStorage.getItem("famfitMockReloadIds") || "[]");
    const ok = await until(() => /Done: 3 sent, 0 skipped of 3|Done: 2 sent, 1 skipped of 3/.test(badge()), 60000);
    const s = await sentNow();
    const unique = new Set(s.map((x) => x.id)).size === s.length;
    check("page reload mid-run: resumes by itself, finishes, nobody texted twice", ok && unique && s.every((x) => ids.includes(x.id)), { badge: badge(), sent: s.map((x) => x.id) });
    finish();
  }

  function finish() {
    window.testsDone = true;
    const pass = results.filter((r) => r.ok).length;
    const box = document.createElement("div");
    box.style.cssText = "margin:12px 16px;padding:10px;border:2px solid " + (pass === results.length ? "#2a7a2a" : "#a33") + ";font:13px Segoe UI,sans-serif;background:#fff";
    box.innerHTML = `<b>Mock CRM tests: ${pass}/${results.length} passed</b><br>` + results.map((r) => `${r.ok ? "PASS" : "<b style='color:#a33'>FAIL</b>"} ${r.name}`).join("<br>");
    document.body.insertBefore(box, document.body.firstChild);
  }

  // ?harness=manual loads the extension without running the tests.
  if (new URLSearchParams(location.search).get("harness") === "manual") return;

  window.addEventListener("load", () => {
    setTimeout(() => {
      run().then(() => { if (!sessionStorage.getItem("famfitMockTestPhase")) finish(); })
        .catch((e) => { window.testError = String((e && e.stack) || e); finish(); });
    }, 500);
  });
})();
