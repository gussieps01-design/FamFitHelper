// Shared templates file: lets every Chrome profile on this computer use the
// same saved templates. The user picks ONE json file once (shared.html); its
// handle is kept in IndexedDB (per profile - each profile picks the same
// file once). Saved templates still live in chrome.storage.local too, so
// everything keeps working if the file is unavailable; the file is a sync
// layer: read it, merge, write it back.
//
// A saved entry is { id, name, text, updatedAt } (ms). A deleted one is a
// tombstone { id, name: "", text: "", updatedAt, deleted: true }, kept 90 days
// so a delete made in one profile isn't undone by another profile's copy.

const FAMFIT_SHARED_VERSION = 1;
const FAMFIT_TOMBSTONE_DAYS = 90;

function famfitValidEntry(t) {
  if (!t || typeof t !== "object" || typeof t.id !== "string" || !t.id) return false;
  if (t.updatedAt !== undefined && typeof t.updatedAt !== "number") return false;
  if (t.deleted === true) return true;
  return typeof t.name === "string" && typeof t.text === "string";
}

function famfitNewer(x, y) {
  const ux = x.updatedAt || 0;
  const uy = y.updatedAt || 0;
  if (ux !== uy) return ux > uy;
  if (!!x.deleted !== !!y.deleted) return !!x.deleted; // a delete wins a tie
  return JSON.stringify(x) > JSON.stringify(y); // any fixed rule, same on every computer
}

// Merge two lists of saved entries (either may include tombstones). The same
// two inputs always give the same output, in either order.
function famfitMergeTemplates(a, b, now, starterNames) {
  const byId = new Map();
  [a || [], b || []].forEach((list) => list.forEach((t) => {
    if (!famfitValidEntry(t)) return;
    const cur = byId.get(t.id);
    if (!cur || famfitNewer(t, cur)) byId.set(t.id, t);
  }));
  const keep = (starterNames || []).map((n) => n.toLowerCase());
  let list = Array.from(byId.values()).filter(
    (t) => !(t.deleted && now - (t.updatedAt || 0) > FAMFIT_TOMBSTONE_DAYS * 86400000)
  );
  list.sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  // Two profiles may each have made a different template with the same name.
  // The older one keeps the name; the other gets "(2)", "(3)"...
  const used = new Set(keep);
  list
    .filter((t) => !t.deleted)
    .sort((p, q) => (p.updatedAt || 0) - (q.updatedAt || 0) || (p.id < q.id ? -1 : 1))
    .forEach((t) => {
      let name = t.name;
      if (used.has(name.toLowerCase())) {
        let n = 2;
        const base = t.name;
        do {
          const suffix = ` (${n++})`;
          name = base.slice(0, FAMFIT_NAME_MAX - suffix.length) + suffix;
        } while (used.has(name.toLowerCase()));
        const i = list.indexOf(t);
        list[i] = { ...t, name, updatedAt: Math.max(now, (t.updatedAt || 0) + 1) };
      }
      used.add(name.toLowerCase());
    });
  return list;
}

function famfitSharedFileText(entries, now) {
  return JSON.stringify({ app: "FamFitHelper", kind: "templates", version: FAMFIT_SHARED_VERSION, updatedAt: now, templates: entries }, null, 2) + "\n";
}

// Throws an Error with a plain-language message when the file isn't ours.
function famfitParseSharedFile(text) {
  if (!text || !text.trim()) return []; // brand-new empty file
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error("The shared file isn't readable (it may be damaged or a different kind of file)."); }
  if (!data || data.app !== "FamFitHelper" || data.kind !== "templates" || !Array.isArray(data.templates)) {
    throw new Error("That file isn't a FamFitHelper templates file, so I left it alone.");
  }
  if (typeof data.version === "number" && data.version > FAMFIT_SHARED_VERSION) {
    throw new Error("The shared file was made by a newer FamFitHelper. Update this copy first.");
  }
  return data.templates.filter(famfitValidEntry);
}

// ---- file handle storage (IndexedDB) ---------------------------------------
const FAMFIT_IDB_NAME = "famfitShared";
function famfitIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FAMFIT_IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function famfitIdbOp(mode, fn) {
  const db = await famfitIdb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("kv", mode);
      const r = fn(tx.objectStore("kv"));
      tx.oncomplete = () => resolve(r && r.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
// Tests replace this to supply a fake handle (real handles can't be faked
// into IndexedDB).
let famfitSharedHandleProvider = {
  get: () => famfitIdbOp("readonly", (s) => s.get("handle")),
  set: (h) => famfitIdbOp("readwrite", (s) => s.put(h, "handle")),
  clear: () => famfitIdbOp("readwrite", (s) => s.delete("handle")),
};

function famfitWithTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(what + " took too long")), ms); }),
  ]).finally(() => clearTimeout(t));
}

// Read the shared file, merge it with `local`, write it back if it changed.
// Never throws. Returns
//   { state: "none" | "ok" | "needs-permission" | "error", fileName, merged, error }
// `merged` is the combined list (only meaningful when state is "ok").
// interactive=true may show Chrome's permission prompt (needs a user click).
async function famfitSyncShared(local, starterNames, interactive) {
  let handle;
  try { handle = await famfitSharedHandleProvider.get(); } catch (e) { return { state: "error", error: "Couldn't open the shared-file settings: " + e.message }; }
  if (!handle) return { state: "none" };
  const fileName = handle.name || "shared file";
  try {
    let perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted" && interactive) perm = await handle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") return { state: "needs-permission", fileName };

    const file = await famfitWithTimeout(handle.getFile(), 5000, "Reading the shared file");
    const remote = famfitParseSharedFile(await famfitWithTimeout(file.text(), 5000, "Reading the shared file"));
    const now = Date.now();
    const merged = famfitMergeTemplates(local, remote, now, starterNames);
    const sameAsRemote = JSON.stringify(merged) === JSON.stringify(famfitMergeTemplates(remote, [], now, starterNames));
    if (!sameAsRemote || !file.size) {
      const w = await handle.createWritable();
      try {
        await w.write(famfitSharedFileText(merged, now));
        await w.close();
      } catch (e) {
        try { await w.abort(); } catch (e2) { /* already closed */ }
        throw e;
      }
    }
    return { state: "ok", fileName, merged };
  } catch (e) {
    const gone = e && (e.name === "NotFoundError" || e.name === "NotAllowedError" || e.name === "SecurityError");
    return { state: "error", fileName, error: gone ? "The shared file can't be opened (moved, deleted, or no permission). Open Manage to pick it again." : e.message };
  }
}
