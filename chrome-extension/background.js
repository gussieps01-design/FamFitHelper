// FamFitHelper CRM Assist - background service worker.
//
// Timer service for the content script. Chrome slows timers in background
// (hidden) tabs - after a few minutes down to about once a minute - which
// would stall a long auto-send run whenever the CRM tab isn't in front. The
// extension's service worker isn't slowed, so the content script asks it
// for wake-ups over a port: {type: "after", id, ms} -> {type: "fired", id}.
// The content script races these against its own setTimeout, so a missing
// or restarted service worker never makes anything slower than before.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "famfit-timer") return;
  const timers = new Map();
  port.onMessage.addListener((msg) => {
    if (!msg || msg.type !== "after") return;
    clearTimeout(timers.get(msg.id));
    timers.set(
      msg.id,
      setTimeout(() => {
        timers.delete(msg.id);
        try {
          port.postMessage({ type: "fired", id: msg.id });
        } catch (e) {
          /* the tab went away */
        }
      }, Math.max(0, Number(msg.ms) || 0))
    );
  });
  port.onDisconnect.addListener(() => {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  });
});
