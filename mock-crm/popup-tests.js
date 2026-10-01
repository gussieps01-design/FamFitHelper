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
    check((await store(SAVED)).filter((t) => !t.deleted).length === 0 && keyNow() === "b:0" && !names().includes("Temp"), [await store(SAVED), keyNow()]);
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

  // ---- shared file (computer-wide templates) --------------------------------
  // A fake file handle (what showSaveFilePicker / showOpenFilePicker return)
  // and two simulated Chrome profiles that each have their own storage.
  function fakeFile(initial) {
    const f = {
      name: "FamFitHelper-templates.json", text: initial || "", perm: "granted", writes: 0, failWrite: false, grantOnRequest: true,
      queryPermission: async () => f.perm,
      requestPermission: async () => { if (f.grantOnRequest) f.perm = "granted"; return f.perm; },
      getFile: async () => ({ size: f.text.length, text: async () => f.text }),
      createWritable: async () => {
        let buf = "";
        return { write: async (s) => { buf += s; }, close: async () => { if (f.failWrite) throw new Error("disk full"); f.text = buf; f.writes++; }, abort: async () => {} };
      },
    };
    return f;
  }
  const fileTemplates = (f) => JSON.parse(f.text).templates;
  const liveNames = (f) => fileTemplates(f).filter((t) => !t.deleted).map((t) => t.name).sort();
  const STORE_KEY = "famfitMockChromeStorage";
  const profiles = {};
  let currentProfile = "A";
  async function useProfile(name, handle) {
    profiles[currentProfile] = sessionStorage.getItem(STORE_KEY);
    currentProfile = name;
    if (profiles[name]) sessionStorage.setItem(STORE_KEY, profiles[name]); else sessionStorage.removeItem(STORE_KEY);
    window.fakeHandle = handle;
    await openPopup();
  }
  async function freshShared(initialText) {
    sessionStorage.clear();
    for (const k of Object.keys(profiles)) delete profiles[k];
    currentProfile = "A";
    const file = fakeFile(initialText);
    window.fakeHandle = file;
    await openPopup();
    return file;
  }
  async function saveNew(name, text) {
    await pick(NEW);
    await type($("templateText"), text);
    await type($("templateName"), name);
    await click("tplSave");
  }

  test("sharing: with no shared file it says so, and the button opens the setup page", async () => {
    window.fakeHandle = undefined;
    await resetAll();
    check($("sharedLine").textContent.includes("this Chrome profile only"), $("sharedLine").textContent);
    $("sharedBtn").click(); await wait(60);
    check(w.openedTabs.length === 1 && w.openedTabs[0].endsWith("shared.html"), w.openedTabs);
  });

  test("sharing: a save goes into the file; a second profile sees it at open", async () => {
    const file = await freshShared("");
    check($("sharedLine").textContent.includes("in sync"), $("sharedLine").textContent);
    await saveNew("Promo", "Hi {{first_name}}, promo text");
    check(msg() === 'Saved "Promo" and shared it.', msg());
    check(liveNames(file).join() === "Promo" && JSON.parse(file.text).app === "FamFitHelper", file.text);
    await useProfile("B", file);
    check(names().includes("Promo"), names());
    await pick("u:" + (await store(SAVED))[0].id);
    check($("templateText").value === "Hi {{first_name}}, promo text", $("templateText").value);
  });

  test("sharing: an edit in one profile reaches the other; the newer edit wins", async () => {
    const file = await freshShared("");
    await saveNew("Promo", "version 1 {{first_name}}");
    await useProfile("B", file);
    await pick("u:" + (await store(SAVED))[0].id);
    await type($("templateText"), "version 2 from B {{first_name}}");
    await wait(5);
    await click("tplSave");
    await useProfile("A", file);
    await pick("u:" + (await store(SAVED))[0].id);
    check($("templateText").value === "version 2 from B {{first_name}}", $("templateText").value);
    check(fileTemplates(file).length === 1, "duplicate entry in file");
  });

  test("sharing: a delete in one profile stays deleted (the other profile's old copy doesn't bring it back)", async () => {
    const file = await freshShared("");
    await saveNew("Promo", "Hi {{first_name}} one");
    await saveNew("Keeper", "Hi {{first_name}} keep");
    await useProfile("B", file);
    await pick("u:" + (await store(SAVED)).find((t) => t.name === "Promo").id);
    answers(true);
    await click("tplDelete");
    check(!names().includes("Promo") && msg() === 'Deleted "Promo".', [names(), msg()]);
    await useProfile("A", file); // A still has its own old copy of Promo
    check(!names().includes("Promo") && names().includes("Keeper"), names());
    check(liveNames(file).join() === "Keeper" && fileTemplates(file).some((t) => t.deleted), file.text);
  });

  test("sharing: two different templates with the same name both survive ('(2)' on the newer)", async () => {
    window.fakeHandle = undefined;
    sessionStorage.clear();
    for (const k of Object.keys(profiles)) delete profiles[k];
    currentProfile = "A";
    await openPopup();
    await saveNew("Promo", "A's promo {{first_name}}");   // profile A, not shared yet
    await wait(5);
    const file = fakeFile("");
    await useProfile("B", file);                          // profile B shares first
    await saveNew("Promo", "B's promo {{first_name}}");
    await useProfile("A", file);                          // A joins the same file later
    const all = (await store(SAVED)).filter((t) => !t.deleted);
    check(all.length === 2 && all.map((t) => t.name).sort().join() === "Promo,Promo (2)", all);
    check(all.some((t) => t.text.startsWith("A's")) && all.some((t) => t.text.startsWith("B's")), "a text was lost");
    check(liveNames(file).join() === "Promo,Promo (2)", liveNames(file));
  });

  test("sharing: needs permission after a restart - saving still works here, Reconnect catches up", async () => {
    const file = await freshShared("");
    await saveNew("First", "Hi {{first_name}} first");
    file.perm = "prompt"; // Chrome forgot the permission
    await openPopup();
    check($("sharedLine").textContent.includes("needs your OK") && $("sharedBtn").textContent === "Reconnect", $("sharedLine").textContent);
    await saveNew("Offline one", "Hi {{first_name}} offline");
    check(msg().includes("NOT in the shared file yet"), msg());
    check((await store(SAVED)).length === 2 && !liveNames(file).includes("Offline one"), "local save must work, file untouched");
    await click("sharedBtn");
    check($("sharedLine").textContent.includes("in sync") && liveNames(file).join() === "First,Offline one", [$("sharedLine").textContent, liveNames(file)]);
    check(msg() === "Shared file reconnected.", msg());
  });

  test("sharing: Reconnect that is refused opens the setup page instead", async () => {
    const file = await freshShared("");
    file.perm = "prompt"; file.grantOnRequest = false;
    await openPopup();
    await click("sharedBtn");
    check(w.openedTabs.length === 1 && w.openedTabs[0].endsWith("shared.html"), w.openedTabs);
  });

  test("sharing: a damaged / foreign / newer file is never overwritten, and saving still works", async () => {
    for (const bad of ["this is not json", JSON.stringify({ app: "SomethingElse", templates: [] }), JSON.stringify({ app: "FamFitHelper", kind: "templates", version: 99, templates: [] })]) {
      const file = await freshShared(bad);
      check($("sharedLine").textContent.startsWith("Shared file problem"), $("sharedLine").textContent);
      await saveNew("Safe", "Hi {{first_name}} safe");
      check(msg().includes("NOT in the shared file yet"), msg());
      check(file.text === bad && file.writes === 0, "file was modified: " + file.text);
      check((await store(SAVED)).length === 1, "local save lost");
    }
  });

  test("sharing: a failed write to the file keeps the local save and says so", async () => {
    const file = await freshShared("");
    file.failWrite = true;
    await saveNew("Local only", "Hi {{first_name}} local");
    check(msg().includes("NOT in the shared file yet") && (await store(SAVED)).length === 1, msg());
    check($("sharedLine").textContent.includes("disk full"), $("sharedLine").textContent);
    file.failWrite = false;
    await openPopup();
    check(liveNames(file).join() === "Local only", liveNames(file));
  });

  test("sharing: a template deleted elsewhere while open: clean -> back to the first starter; typed text -> kept as a new draft", async () => {
    for (const typed of [false, true]) {
      const file = await freshShared("");
      await saveNew("Doomed", "Hi {{first_name}} doomed");
      const id = (await store(SAVED))[0].id;
      file.perm = "prompt";
      await openPopup();
      await pick("u:" + id);
      // another profile deletes it
      const t = fileTemplates(file); const i = t.findIndex((x) => x.id === id);
      t[i] = { id, name: "", text: "", updatedAt: Date.now() + 1000, deleted: true };
      file.text = JSON.stringify({ app: "FamFitHelper", kind: "templates", version: 1, updatedAt: Date.now(), templates: t });
      if (typed) await type($("templateText"), "my unsaved words {{first_name}}");
      await click("sharedBtn");
      if (typed) check(keyNow() === "new" && $("templateText").value.includes("my unsaved words"), [keyNow(), $("templateText").value]);
      else check(keyNow() === "b:0", keyNow());
      check(!names().includes("Doomed"), names());
    }
  });

  test("merge rules (unit): order doesn't matter, newer wins, delete beats older edit, old delete markers expire, junk dropped", async () => {
    const m = w.famfitMergeTemplates;
    const now = 1e12, DAY = 86400000, T = now - 1000; // recent timestamps (old delete markers expire)
    const A = [{ id: "a", name: "One", text: "old", updatedAt: T + 100 }, { id: "b", name: "Two", text: "t", updatedAt: T + 100 }];
    const B = [{ id: "a", name: "One", text: "new", updatedAt: T + 200 }, { id: "b", name: "", text: "", updatedAt: T + 150, deleted: true }, { id: "c", name: "Three", text: "c", updatedAt: T + 1 }];
    const r1 = m(A, B, now, []), r2 = m(B, A, now, []);
    check(JSON.stringify(r1) === JSON.stringify(r2), "order matters");
    check(r1.find((t) => t.id === "a").text === "new" && r1.find((t) => t.id === "b").deleted === true && r1.some((t) => t.id === "c"), r1);
    check(JSON.stringify(m(r1, r1, now, [])) === JSON.stringify(r1), "not idempotent");
    const editedAfterDelete = m([{ id: "b", name: "Two", text: "back", updatedAt: T + 999 }], B, now, []);
    check(editedAfterDelete.find((t) => t.id === "b").text === "back", "newer edit should beat older delete");
    const expired = m([{ id: "z", name: "", text: "", updatedAt: now - 91 * DAY, deleted: true }, { id: "y", name: "", text: "", updatedAt: now - 10 * DAY, deleted: true }], [], now, []);
    check(expired.length === 1 && expired[0].id === "y", expired);
    check(m([null, { id: 5 }, "x", { id: "ok", name: "N", text: "T" }], undefined, now, []).length === 1, "junk not dropped");
    const clash = m([{ id: "p", name: "Personal training", text: "x", updatedAt: 5 }], [], now, ["Personal training"]);
    check(clash[0].name === "Personal training (2)", clash);
  });

  test("setup page: create the file, join from a second profile, refuse a foreign file, stop sharing", async () => {
    const file = fakeFile("");
    window.fakeHandle = file;
    sessionStorage.clear();
    await openPopup();
    await saveNew("Shared one", "Hi {{first_name}} shared");   // file exists, popup saved to it
    // open the setup page in an iframe
    const sf = document.createElement("iframe"); sf.style.cssText = "width:560px;height:500px"; document.body.appendChild(sf);
    const load = async () => { await new Promise((r) => { sf.onload = r; sf.src = "/shared?ts=" + Date.now(); }); await wait(150); return sf.contentWindow; };
    let sw = await load();
    check(sw.document.getElementById("status").textContent.includes('Connected to "FamFitHelper-templates.json"'), sw.document.getElementById("status").textContent);
    // "Create": the picker returns a NEW empty file
    const created = fakeFile("");
    window.fakeHandle = null;
    sw.showSaveFilePicker = async () => created;
    window.fakeHandle = created; // handle slot (set() replaces it)
    sw.document.getElementById("createBtn").click(); await wait(300);
    check(sw.document.getElementById("status").className === "ok" && created.text.includes("Shared one"), [sw.document.getElementById("status").textContent, created.text]);
    // a foreign file is refused, untouched, and not remembered
    const foreign = fakeFile(JSON.stringify({ hello: "world" }));
    window.fakeHandle = created;
    sw.showOpenFilePicker = async () => [foreign];
    sw.document.getElementById("openBtn").click(); await wait(300);
    check(sw.document.getElementById("status").className === "err" && foreign.text === JSON.stringify({ hello: "world" }) && foreign.writes === 0, [sw.document.getElementById("status").textContent, foreign.text]);
    check(window.fakeHandle === null, "bad file should not be remembered");
    // stop sharing
    window.fakeHandle = created;
    sw.confirmAnswers.push(true);
    sw.document.getElementById("disconnectBtn").click(); await wait(150);
    check(window.fakeHandle === null && sw.document.getElementById("status").textContent.includes("Sharing stopped"), sw.document.getElementById("status").textContent);
    sf.remove();
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
