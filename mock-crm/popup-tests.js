// Automated tests for the popup's template feature. Open
// http://localhost:4567/popup-tests : it drives the REAL popup.html/popup.js in
// an iframe (stubbed chrome.* APIs, see popup-chrome.js) and reloads the iframe
// to simulate closing and re-opening the popup.
// Results: window.results (array of {name, ok, detail}), window.testsDone.
(function () {
  window.results = [];
  window.testsDone = false;
  const out = document.getElementById("out");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const SAVED = "famfitSavedTemplates";
  const NEW = "new";

  let frame = null;
  let w = null;
  let d = null;
  const $ = (id) => d.getElementById(id);
  const store = (k) => w.chrome.storage.local.get(k).then((o) => o[k]);

  async function openPopup() {
    if (!frame) { frame = document.createElement("iframe"); frame.style.cssText = "width:420px;height:900px;border:1px solid #888"; document.body.appendChild(frame); }
    await new Promise((res) => { frame.onload = res; frame.src = "/popup?ts=" + Date.now(); });
    w = frame.contentWindow; d = w.document;
    for (let i = 0; i < 100 && !w.eval("stateReady"); i++) await wait(20);
    await wait(60);
  }
  async function resetAll() { sessionStorage.clear(); await openPopup(); }
  async function type(el, value) { el.value = value; el.dispatchEvent(new w.Event("input", { bubbles: true })); await wait(30); }
  async function pick(key) { $("templateSelect").value = key; $("templateSelect").dispatchEvent(new w.Event("change", { bubbles: true })); await wait(60); }
  async function click(id) { $(id).click(); await wait(80); }
  const answers = (...a) => { w.confirmAnswers.push(...a); };
  const names = () => Array.from($("templateSelect").options).map((o) => o.textContent);
  const keyNow = () => w.eval("currentKey");
  const msg = () => $("templateMsg").textContent;

  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });
  const check = (cond, detail) => { if (!cond) throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail)); };

  test("starter templates: exactly the requested 8, then 'Write my own'", async () => {
    await resetAll();
    check(JSON.stringify(names()) === JSON.stringify([
      "Personal training", "Holiday notice", "Relocation", "Membership expired win-back", "Former members",
      "Free pass / trial follow-up", "Missed guests", "Re-engagement (cold lead)", "Write my own message...",
    ]), names());
    check(keyNow() === "b:0", keyNow());
    check(w.famfitSplitVariants($("templateText").value).length === 3, "3 versions");
  });

  test("every starter is clean: allowed fields only, short enough, no problems, fills with real values", async () => {
    await resetAll();
    w.eval("FAMFIT_TEMPLATES").forEach((t) => {
      check(t.variants.length === 3, t.name + " has " + t.variants.length + " versions");
      check(!w.famfitTemplateProblems(w.famfitTemplateText(t)).length, t.name + ": " + w.famfitTemplateProblems(w.famfitTemplateText(t)));
      t.variants.forEach((v) => {
        check(v.includes("{{first_name}}"), t.name + " has no first name: " + v);
        const r = w.famfitRenderTemplate(v, { first_name: "A", last_name: "B", staff: "C", location: "D" });
        check(!/\{\{|\}\}/.test(r), t.name + " leaves a placeholder: " + r);
        check(v.length <= 300, t.name + " is " + v.length + " chars");
      });
    });
  });

  test("editing a starter: shows 'not saved', can't overwrite it, needs a name to save a copy", async () => {
    await resetAll();
    await type($("templateText"), $("templateText").value + "\nEXTRA LINE");
    check($("templateInfo").textContent.includes("not saved"), $("templateInfo").textContent);
    check($("tplSave").style.display === "none", "Save must be hidden for a starter");
    await click("tplSaveAs");
    check(msg().startsWith("Not saved") && msg().includes("name"), msg());
    check(!(await store(SAVED)), "nothing should be stored");
  });

  test("save a copy of a starter under my own name; the starter itself stays unchanged", async () => {
    await resetAll();
    const original = $("templateText").value;
    await type($("templateText"), "Hi {{first_name}}, SPRING PROMO from {{staff}} at {{location}}!");
    await type($("templateName"), "Spring promo");
    await click("tplSaveAs");
    const saved = await store(SAVED);
    check(saved.length === 1 && saved[0].name === "Spring promo" && saved[0].text.includes("SPRING PROMO"), saved);
    check(keyNow() === "u:" + saved[0].id, keyNow());
    check(msg() === 'Saved "Spring promo".', msg());
    check($("templateInfo").textContent === "", "should not show unsaved after saving");
    check(names().includes("Spring promo"), names());
    await pick("b:0");
    check($("templateText").value === original, "starter changed!");
  });

  test("name rules: blank, duplicate (any case), starter's name, too long", async () => {
    await resetAll();
    await type($("templateText"), "Hi {{first_name}}!");
    await type($("templateName"), "Promo A");
    await click("tplSaveAs");
    check((await store(SAVED)).length === 1, "first save");
    await pick(NEW);
    await type($("templateText"), "Hi {{first_name}} again");
    for (const [bad, why] of [["", "blank"], ["  promo a ", "duplicate"], ["PERSONAL TRAINING", "starter name"], ["x".repeat(61), "too long"]]) {
      await type($("templateName"), bad);
      await click("tplSave");
      check(msg().startsWith("Not saved"), why + ": " + msg());
      check((await store(SAVED)).length === 1, why + ": stored count changed");
    }
  });

  test("edit a saved template: Save changes updates in place (same id, no duplicate)", async () => {
    await resetAll();
    await pick(NEW);
    await type($("templateText"), "Hi {{first_name}}, version one");
    await type($("templateName"), "Mine");
    await click("tplSave");
    const id = (await store(SAVED))[0].id;
    check($("tplSave").disabled, "Save changes should be disabled with nothing changed");
    await type($("templateText"), "Hi {{first_name}}, version TWO");
    check(!$("tplSave").disabled && $("templateInfo").textContent.includes("not saved"), "dirty state");
    await click("tplSave");
    const saved = await store(SAVED);
    check(saved.length === 1 && saved[0].id === id && saved[0].text.includes("version TWO"), saved);
    check($("tplSave").disabled, "clean again after save");
  });

  test("rename a saved template; can't rename onto another saved name", async () => {
    await resetAll();
    for (const n of ["Alpha", "Beta"]) {
      await pick(NEW);
      await type($("templateText"), "Hi {{first_name}} " + n);
      await type($("templateName"), n);
      await click("tplSave");
    }
    await type($("templateName"), "alpha");
    await click("tplSave");
    check(msg().startsWith("Not saved"), msg());
    await type($("templateName"), "Gamma");
    await click("tplSave");
    const saved = await store(SAVED);
    check(saved.map((t) => t.name).join() === "Alpha,Gamma", saved.map((t) => t.name));
  });

  test("'Save as new' on a saved template needs a new name, then makes a copy", async () => {
    await resetAll();
    await pick(NEW);
    await type($("templateText"), "Hi {{first_name}} base");
    await type($("templateName"), "Base");
    await click("tplSave");
    await click("tplSaveAs");
    check(msg().includes("new name"), msg());
    check((await store(SAVED)).length === 1, "no copy yet");
    await type($("templateName"), "Base copy");
    await type($("templateText"), "Hi {{first_name}} base changed");
    await click("tplSaveAs");
    const saved = await store(SAVED);
    check(saved.length === 2 && saved[0].text === "Hi {{first_name}} base" && saved[1].name === "Base copy", saved);
  });

  test("bad messages are refused (typo'd field, stray brace, spaced field, empty) and nothing is stored", async () => {
    await resetAll();
    await pick(NEW);
    await type($("templateName"), "Bad");
    for (const bad of ["Hi {{firstname}}!", "Hi {first_name}!", "Hi {{ first_name }}!", "Hi {{first_name}} }", "   \n---\n  "]) {
      await type($("templateText"), bad);
      if (bad.trim() && !/^\s*-/.test(bad)) check($("templateProblems").style.display === "block", "no warning shown for: " + bad);
      await click("tplSave");
      check(msg().startsWith("Not saved"), bad + " -> " + msg());
    }
    check(!(await store(SAVED)), "something was stored");
    await type($("templateText"), "Hi {{first_name}} {{last_name}} {{staff}} {{location}}");
    check($("templateProblems").style.display === "none", "good message flagged");
  });

  test("insert buttons: at the cursor, replacing a selection; 'new version' adds a version", async () => {
    await resetAll();
    await pick(NEW);
    const ta = $("templateText");
    await type(ta, "Hi , welcome");
    ta.setSelectionRange(3, 3);
    d.querySelector('[data-insert="{{first_name}}"]').click();
    await wait(50);
    check(ta.value === "Hi {{first_name}}, welcome", ta.value);
    ta.setSelectionRange(ta.value.length, ta.value.length);
    Array.from(d.querySelectorAll("button[data-insert]")).find((b) => b.dataset.insert === "\n---\n").click();
    await wait(50);
    await type(ta, ta.value + "Second wording {{first_name}}");
    check(w.famfitSplitVariants(ta.value).length === 2, ta.value);
    check($("variantCount").textContent.startsWith("2 versions"), $("variantCount").textContent);
  });

  test("closing and re-opening the popup keeps the template, an unsaved edit, and the saved list", async () => {
    await resetAll();
    await pick("b:2");
    await type($("templateText"), "Draft edit {{first_name}}");
    await type($("templateName"), "half typed name");
    await openPopup();
    check(keyNow() === "b:2", keyNow());
    check($("templateText").value === "Draft edit {{first_name}}", $("templateText").value);
    check($("templateName").value === "half typed name", "name draft");
    check($("templateInfo").textContent.includes("not saved"), "still marked unsaved");
    await click("tplSaveAs");
    await openPopup();
    check(keyNow().startsWith("u:") && $("templateText").value === "Draft edit {{first_name}}" && $("templateInfo").textContent === "", [keyNow(), $("templateText").value]);
    check(names().includes("half typed name"), names());
  });

  test("switching away from unsaved edits asks first; 'No' keeps them, 'Yes' discards", async () => {
    await resetAll();
    await type($("templateText"), "my unsaved words {{first_name}}");
    answers(false);
    await pick("b:3");
    check(keyNow() === "b:0" && $("templateSelect").value === "b:0" && $("templateText").value.includes("unsaved words"), [keyNow(), $("templateSelect").value]);
    answers(true);
    await pick("b:3");
    check(keyNow() === "b:3" && !$("templateText").value.includes("unsaved words"), keyNow());
    const before = w.confirmLog.length;
    await pick("b:4"); // clean switch: no prompt
    check(w.confirmLog.length === before && keyNow() === "b:4", "prompted on a clean switch");
  });

  test("Undo changes restores the saved/starter text", async () => {
    await resetAll();
    const original = $("templateText").value;
    await type($("templateText"), "oops");
    await click("tplUndo");
    check($("templateText").value === original && $("templateInfo").textContent === "", "starter undo");
  });

  test("delete: 'No' keeps it, 'Yes' removes it and goes back to the first starter", async () => {
    await resetAll();
    await pick(NEW);
    await type($("templateText"), "Hi {{first_name}} del");
    await type($("templateName"), "Temp");
    await click("tplSave");
    answers(false);
    await click("tplDelete");
    check((await store(SAVED)).length === 1 && keyNow().startsWith("u:"), "deleted despite No");
    answers(true);
    await click("tplDelete");
    check((await store(SAVED)).length === 0 && keyNow() === "b:0" && !names().includes("Temp"), [await store(SAVED), keyNow()]);
    check(w.confirmLog[w.confirmLog.length - 1].includes('"Temp"'), w.confirmLog[w.confirmLog.length - 1]);
  });

  test("'Write my own': Clear asks first, Save template stores it", async () => {
    await resetAll();
    await pick(NEW);
    check($("templateText").value === "" && $("tplSaveAs").style.display === "none", "blank start");
    await type($("templateText"), "Brand new {{first_name}}");
    answers(false);
    await click("tplUndo");
    check($("templateText").value !== "", "cleared despite No");
    await type($("templateName"), "Custom one");
    await click("tplSave");
    const saved = await store(SAVED);
    check(saved.length === 1 && saved[0].name === "Custom one" && keyNow() === "u:" + saved[0].id, saved);
  });

  test("storage trouble: a failing or silently-dropped save says 'Not saved' and loses nothing", async () => {
    await resetAll();
    await pick(NEW);
    await type($("templateText"), "Keep me {{first_name}}");
    await type($("templateName"), "Fragile");
    const realSet = w.chrome.storage.local.set;
    w.chrome.storage.local.set = () => Promise.reject(new Error("quota exceeded"));
    await click("tplSave");
    check(msg().startsWith("Not saved") && msg().includes("quota"), msg());
    check($("templateText").value === "Keep me {{first_name}}" && keyNow() === "new" && !$("tplSave").disabled, "state after failure");
    w.chrome.storage.local.set = () => Promise.resolve(); // pretends to save, keeps nothing
    await click("tplSave");
    check(msg().startsWith("Not saved"), msg());
    w.chrome.storage.local.set = realSet;
    await click("tplSave");
    check(msg() === 'Saved "Fragile".' && (await store(SAVED)).length === 1, msg());
  });

  test("double-clicking Save quickly saves once", async () => {
    await resetAll();
    await pick(NEW);
    await type($("templateText"), "Twice {{first_name}}");
    await type($("templateName"), "Once only");
    $("tplSave").click(); $("tplSave").click();
    await wait(200);
    check((await store(SAVED)).length === 1, await store(SAVED));
  });

  test("Start refuses a bad message, and the batch is never stored", async () => {
    await resetAll();
    $("contacts").value = "Test Person\t(555) 123-4567";
    await click("usePastedBtn");
    await type($("templateText"), "Hi {{firstname}}, bad");
    await click("startBtn");
    check($("status").textContent.startsWith("Fix the message first"), $("status").textContent);
    check(!(await store("famfitBatch")), "batch stored");
    await type($("templateText"), "   ");
    await click("startBtn");
    check($("status").textContent.includes("message is empty"), $("status").textContent);
  });

  test("preview shows real-looking text (no raw placeholders) and flags long messages", async () => {
    await resetAll();
    $("previewBox").open = true;
    const first = d.querySelector("#previewList .pv").textContent;
    check(first.includes("Jamie") && !/\{\{/.test(first), first);
    await type($("templateText"), "Hi {{first_name}} " + "word ".repeat(60));
    check(d.querySelector("#previewList .pv small").textContent.includes("text segments"), d.querySelector("#previewList .pv small").textContent);
  });

  test("old saved popup state (from before this version) and junk in storage don't break the popup", async () => {
    sessionStorage.clear();
    sessionStorage.setItem("famfitMockChromeStorage", JSON.stringify({
      famfitPopupState: { templateIndex: "16", templateText: "old text", templatesVersion: 2, fIdleMin: "5" },
      [SAVED]: [null, { id: 5 }, { id: "ok1", name: "Good", text: "Hi {{first_name}}" }, "junk"],
    }));
    await openPopup();
    check(keyNow() === "b:0", keyNow());
    check($("fIdleMin").value === "5", "other settings should still restore");
    check(names().includes("Good") && !names().includes("5"), names());
    check((await store(SAVED)).length === 4, "junk entries must not be rewritten unless the user saves");
  });

  test("template names/text are shown as plain text, never as HTML", async () => {
    await resetAll();
    await pick(NEW);
    await type($("templateText"), "Hi {{first_name}} <img src=x onerror=\"window.pwned=1\">");
    await type($("templateName"), "<b>bold</b>");
    await click("tplSave");
    await wait(100);
    check(!d.querySelector("#previewList img") && !d.querySelector("#templateSelect img") && !w.pwned, "HTML was interpreted");
    check(names().includes("<b>bold</b>"), names());
  });

  test("a saved template with two versions comes back intact after re-opening", async () => {
    await resetAll();
    await pick(NEW);
    await type($("templateText"), "Hi {{first_name}}, saved text A\n---\nHey {{first_name}}, saved text B");
    await type($("templateName"), "Two versions");
    await click("tplSave");
    await openPopup();
    check(w.famfitSplitVariants($("templateText").value).join("|") === "Hi {{first_name}}, saved text A|Hey {{first_name}}, saved text B", $("templateText").value);
  });

  (async function run() {
    for (const t of tests) {
      let ok = true, detail = "";
      try { await t.fn(); } catch (e) { ok = false; detail = e.message; }
      window.results.push({ name: t.name, ok, detail });
      const li = document.createElement("div");
      li.textContent = (ok ? "PASS " : "FAIL ") + t.name + (ok ? "" : " -- " + detail);
      li.style.color = ok ? "#2E7D32" : "#B3261E";
      out.appendChild(li);
    }
    window.testsDone = true;
    document.title = `popup tests: ${window.results.filter((r) => r.ok).length}/${window.results.length} passed`;
  })();
})();
