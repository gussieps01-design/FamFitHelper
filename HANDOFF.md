# FamFitHelper - Handoff (2026-09-29)

## What this is
- Desktop app (`app.py`, exe in `dist\`) plus a Chrome extension (`chrome-extension\`) that pre-fills SMS templates for batches of contacts in the CRM at `https://crm.healthyimagefitness.com`.
- Repo: https://github.com/gussieps01-design/FamFitHelper (public). Latest release: v1.1.0.
- **Target is the live production CRM** (real gym customers, real staff account). The user says the SMS "goes to another server, not a human" - this is unverified from the code. Treat every Send as potentially real.

## State of the repo
- Last commit: `f72f379`. **All work from this session is uncommitted and unpushed** (5 modified files in `chrome-extension\`: README.md, content.js, manifest.json, popup.html, popup.js). Nothing was committed or pushed.
- The desktop app (`app.py`) was not touched and has none of the new features.

## What changed this session (extension only)
1. **Auto-send mode**: opt-in checkbox in the popup (default off), with a `confirm()` dialog on every Start. When on, `content.js` clicks `#submit_sms_message` ~400ms after filling each message. Advancing still depends on the CRM's green `#flash_notice` / `.alert-success` banner (send detection has never been verified against a real send).
2. **Bug fix - manifest**: `content_scripts` only injected `content.js`, so `famfitRenderTemplate` (in `templates.js`) was undefined and every batch silently died at "Finding X...". Now `["templates.js", "content.js"]`.
3. **Bug fix - wrong textarea**: the CRM reuses `id="customer_message_message"` in both the Email form (hidden, first in DOM) and `form#new_sms_customer_message` (visible). `getElementById` returned the hidden one, so text never appeared. New `getSmsTextarea()` in `content.js` is scoped to the SMS form; used in the fill, the wait-for-ready check, and the Ctrl+Enter handler.
4. **Filters**: Status / Priority / Location / Staff are now `<select multiple>` populated by scanning the live CRM (`FAMFIT_GET_FILTER_OPTIONS`, default 10 pages, per-page progress in the on-page badge). Matching is OR across selected values, exact case-insensitive (`multiMatch`). Each box has an "Any (click to clear all)" first option. Idle min/max, Signed-within, Max-pages remain plain number inputs. Bottom Staff/Location fallbacks are single-selects.
5. **Persistence**: `popup.js` saves the whole form (filters, template, fallbacks, autoSend, Text-how-many, loaded contacts + summary) to `chrome.storage.local` key `famfitPopupState` and restores on open. The active run lives separately in key `famfitBatch` (unchanged).
6. **Text how many**: number field next to the loaded count ("of N loaded, to text"). Blank = all; otherwise Start slices the first N of the loaded list.

## Things learned the hard way
- The CRM endpoint `/customers_grid.json` is slow: 1-7 s per 100-row page (21.5k customers total). Scans of 30 pages looked frozen; hence the 10-page default and progress badge.
- After reloading the unpacked extension, already-open CRM tabs keep a dead content script. **Refresh the CRM tab after every reload** or messages silently go nowhere (popup then hangs on "Searching CRM...").
- Popup JS state dies whenever the popup closes; that is why persistence was added.
- A GateGuard hook in this environment requires stating importers / affected API / the user's instruction before the first Edit/Write per file (and before the first Bash command); running a Grep or Glob right before the Edit satisfied it.

## Testing limits (important for honesty about what is verified)
- Claude's browser tooling cannot open `chrome://` or `chrome-extension://` pages or click the toolbar icon, so it can never drive the real popup. Claude verified logic by running copies of the `content.js` functions in the CRM tab's main world.
- **Correction**: early "fill verified" claims were false positives - they wrote into the hidden Email textarea. Fixed and visually confirmed only after the user reported an empty box.
- User-confirmed in the real extension: Load, Start, message fill (after the fixes), dropdown scan ("all working").
- **Not yet confirmed by the user in the real popup** (added after "all working"): the "Any" clear option, popup close/reopen persistence, and the "Text how many" field. Ask the user to reload the extension, refresh the CRM tab, and test those.
- **Never tested**: the real send path, banner-based send detection, auto-advance to contact 2+, and Auto-send end to end. No Send was ever clicked by Claude.

## Known limitations / open items
- `findContactRowLink` only finds contacts present in the **currently rendered on-page table**. A batch of 86 from the JSON feed will fail for anyone not on the visible grid page ("Couldn't find X on this page"). Biggest functional gap for large batches; needs pagination handling or a different way to open a contact.
- Failure modes are silent: `popup.js` has no try/catch around `chrome.tabs.sendMessage`, so a dead content script leaves the UI stuck instead of showing an error.
- Filter-option scan samples only the ~1,000 most recent customers; rare values may be missing until "Refresh dropdown options".
- `manifest.json` description still says "Never clicks Send" (now inaccurate); version still 1.0.0. A stale comment sits at popup.js line 7.
- Contacts loaded via the "paste a list" path carry no staff/location, so those come from the fallback fields.

## Update (later on 2026-09-29): fixes + offline tests
- **On-page limitation fixed**: CRM-loaded contacts now carry the customer `id`; `openContactModal` clicks a synthetic remote-modal link `/customers/<id>/customer_journal_items/new`. Pasted contacts (no id) still use the on-page row lookup.
- **Stale-modal guard**: waits for NEW modal nodes (or a SMS form action naming this customer id) before filling; skips if the form belongs to a different customer.
- **Stop now really stops**: `runId` cancels pending auto-send clicks and advance timers.
- **popup.js**: try/catch around `sendMessage` (shows "refresh the CRM tab"), Start failure leaves no phantom batch, saved filter picks survive a failed option scan, "Any" clears other picks even with ctrl-click.
- manifest -> 1.1.0 with accurate description; README updated.
- Tested against a local mock CRM (real content.js/popup.js/popup.html, stubbed chrome.*): 30/30 content-script, 23/23 popup, 20/20 filter-logic checks. **Not tested on the live CRM**: opening a modal by id there was blocked by the permission classifier. Needs the user to verify with a manual run (no Send) on 2-3 contacts that are not on the visible grid page. Previously loaded contacts have no id: click Load again.

## Suggested next steps
1. Have the user reload the extension + refresh the CRM tab and test the three untested popup features above.
2. Fix the on-page-table limitation for batches larger than one grid page.
3. Add error handling to popup `sendToActiveTab` calls.
4. Commit (5 files) and decide whether to push / cut a release; consider porting features to the desktop app if wanted.
5. Do not enable Auto-send against real customers until send detection is verified on a single low-stakes contact.
