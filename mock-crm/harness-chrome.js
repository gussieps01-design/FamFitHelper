// Stand-in for the chrome.* extension API, so the REAL content script can run
// inside the mock CRM page for automated tests (/customers?harness=1).
// Storage is kept in sessionStorage, so a real page reload keeps the batch -
// just like chrome.storage.local does.
(function () {
  const KEY = "famfitMockChromeStorage";
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const saveAll = (obj) => sessionStorage.setItem(KEY, JSON.stringify(obj));
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  let listener = null;

  const storage = {
    get(keys, cb) {
      const all = load();
      const out = {};
      if (keys == null) Object.assign(out, all);
      else [].concat(keys).forEach((k) => { if (k in all) out[k] = clone(all[k]); });
      if (cb) { setTimeout(() => cb(out)); return undefined; }
      return Promise.resolve(out);
    },
    set(obj) { const all = load(); Object.assign(all, clone(obj)); saveAll(all); return Promise.resolve(); },
    remove(keys) { const all = load(); [].concat(keys).forEach((k) => delete all[k]); saveAll(all); return Promise.resolve(); },
  };

  const runtime = {
    getManifest: () => ({ version: "mock" }),
    onMessage: { addListener: (fn) => { listener = fn; } },
  };

  // ?port=1: also emulate the background service worker's timer port.
  if (new URLSearchParams(location.search).get("port")) {
    window.portStats = { connects: 0, afters: 0 };
    runtime.connect = ({ name }) => {
      window.portStats.connects++;
      const msgL = [];
      const discL = [];
      return {
        name,
        onMessage: { addListener: (f) => msgL.push(f) },
        onDisconnect: { addListener: (f) => discL.push(f) },
        postMessage: (msg) => {
          window.portStats.afters++;
          setTimeout(() => msgL.forEach((f) => f({ type: "fired", id: msg.id })), msg.ms);
        },
      };
    };
  }

  window.chrome = { storage: { local: storage }, runtime };

  // Test helpers: talk to the content script like the popup does, and
  // inspect/reset the stored state.
  window.sendMsg = (m) => new Promise((res) => listener(m, {}, res));
  window.mockStore = { all: () => load(), get: (k) => load()[k], set: (k, v) => storage.set({ [k]: v }), clear: () => sessionStorage.removeItem(KEY) };
})();
