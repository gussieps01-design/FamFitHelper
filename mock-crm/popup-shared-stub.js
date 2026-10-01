// Test-only: loaded right after sharedfile.js on /popup and /shared. Real file
// handles can't be faked into IndexedDB, so tests put a fake handle on the
// parent test page (window.fakeHandle) and the page under test gets it from
// there. With no fakeHandle set (e.g. opening /popup by hand) the real
// IndexedDB provider is used.
(function () {
  const real = famfitSharedHandleProvider;
  const holder = () => (window.parent !== window ? window.parent : window);
  famfitSharedHandleProvider = {
    get: async () => (holder().fakeHandle !== undefined ? holder().fakeHandle : real.get()),
    set: async (h) => { if (holder().fakeHandle !== undefined) holder().fakeHandle = h; else await real.set(h); },
    clear: async () => { if (holder().fakeHandle !== undefined) holder().fakeHandle = null; else await real.clear(); },
  };
})();
