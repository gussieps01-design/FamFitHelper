// Extra stubs so the REAL popup.html / popup.js run in a normal browser tab at
// http://localhost:4567/popup (loaded after harness-chrome.js, which provides
// chrome.storage and chrome.runtime). Storage lives in sessionStorage, so a
// page reload behaves like closing and re-opening the popup.
(function () {
  // No CRM tab here: popup actions that talk to the page report "open the CRM tab".
  window.chrome.tabs = { query: async () => [], sendMessage: async () => null };
  // Never reach out to GitHub from a test page (the update check).
  window.fetch = () => Promise.reject(new Error("offline (test page)"));
  // Tests answer confirm() dialogs by queueing answers: window.confirmAnswers = [true, false].
  // With nothing queued, confirm() answers false (the safe choice) and is logged.
  window.confirmLog = [];
  window.confirmAnswers = [];
  window.confirm = (msg) => {
    window.confirmLog.push(msg);
    return window.confirmAnswers.length ? !!window.confirmAnswers.shift() : false;
  };
})();
