# FamFitHelper - Handoff (2026-10-01)

## Status in one line
The Chrome extension v1.4.2 works on the live CRM (user-confirmed: auto-send "Done: 5 sent, 0 skipped of 5") and is the **stable baseline**. **v1.5.1** (all known gaps fixed, plus a fix the new mock CRM found) is built and tested against the realistic mock on branch `fix-gaps` / PR #4, published as a pre-release, and **waiting for the user's live test**. The desktop app is archived.

## STABLE BASELINE: extension v1.4.2
**Build every future version on top of it.**
- git: tag **`extension-stable-1.4.2`** and branch **`stable`**. `master` contains the same extension code (0 files differ).
- Release (marked "stable baseline"): https://github.com/gussieps01-design/FamFitHelper/releases/tag/extension-v1.4.2
- Start new work: `git checkout -b <new-branch> extension-stable-1.4.2` (or from `master`). Compare: `git diff extension-stable-1.4.2`. If a later version breaks, the baseline zip is the fallback.
- **Don't regress the live-CRM behaviour** (see "CRM facts"): close any open message window before opening the next contact (the open link is a toggle); use the *visible* SMS form; record the extension's own Send click directly; treat the window closing/refreshing or the green banner as "sent".

## What's in the repo
- `chrome-extension/` - the product (Manifest V3, unpacked): `content.js` (search + batch engine, runs on the CRM page), `popup.html/js` (UI), `templates.js` (20 starter templates x 3 rotating versions), `manifest.json`, `README.md`.
- `HOW-TO-USE.txt` - plain-language install/use/update guide for non-technical staff (also shipped in each release zip).
- `README.md` - overview; `HANDOFF.md` - this file.
- Repo: https://github.com/gussieps01-design/FamFitHelper. History: PR #1 (extension v1.1 -> v1.4.2), PR #2 (archive desktop app).

## How the extension works
- **Load:** Status / Priority / Staff / Idle / Signed-within are sent to the CRM's grid endpoint (`/customers_grid.json`, Kendo `filter[...]` params) so all ~21.5k customers are searched; one plain-AND query per value combination (the CRM's OR groups are broken), every row re-checked client-side. Location, Dead/bounced/unsubscribed/no-phone exclusion, duplicate-phone removal and the re-text cooldown are applied in the extension.
- **Open:** closes any open message window first, then clicks a synthetic remote-modal link `/customers/<id>/customer_journal_items/new` (CRM-loaded contacts carry their id; pasted contacts must be on the visible grid page). Old window content is marked `data-famfit-stale`; only fresh, visible content is used.
- **Fill:** picks the template version (rotation: random start per batch, then next per contact; or always version 1), renders `{{first_name}} {{last_name}} {{staff}} {{location}}`; never auto-sends text with a blank `{{field}}`.
- **Send:** manual (human clicks Send / Ctrl+Enter) or auto-send (clicks only when the visible box holds this contact's message). "Sent" = Send clicked AND then the window closed, the window refreshed (new/emptied box), or the green banner appeared.
- **Batch engine** (`chrome.storage.local.famfitBatch`): failures skip + log; 3 in a row stop the run; `inFlight` prevents double-texting after a reload; auto-send runs auto-resume after a page reload (within 10 min); only the owning tab acts (heartbeat in `famfitHeartbeat`). `famfitSentLog` = per-phone last-texted time for the cooldown (this Chrome profile only). `famfitLastRun` = last summary.
- **Popup:** Start resumes a stored batch; Stop ends it and saves a summary. Shows the version in its title and an "Update available" notice (checks GitHub releases, cached 6h).
- Every badge/skip reason starts with "FamFitHelper vX.Y.Z:" and failures include a page snapshot `[page: N SMS form(s), N visible, N message window(s) open]` - ask the user to paste it when debugging.

## CRM facts (recorded live, read-only)
- The open link (`data-remote` + `data-toggle="modal"` + `data-target="#modal-window"`) is a Bootstrap **toggle** - clicking it while the window is open closes it. The page has TWO `#modal-window` elements (the first is used).
- Window: `#journal-history-modal` > `a[href="#messages"]` > `a[href="#smss"]` (SMS active by default) > `form#new_sms_customer_message` (data-remote, action `/customers/<id>/customer_messages.js`) > `textarea#customer_message_message` (same id also on the Email form).
- Send = `a#submit_sms_message.submit_message`; its own click handler: `if (sent) return; sent = true;` then `$.post` the form; on success evals the JS reply and inserts `.alert-success #flash_notice` ("Message is sended") before `#main_content`. `var sent = false` is reset by the window's inline scripts on every load. After a send the window may stay open (refreshed).
- Grid filters: status only by numeric code (0 Member, 1 Guest, 2 Trial, 3 Corporate, 4 Contest Box, 5 Phone Inquiry, 6 Former Member, 7 Member Referral, 9 Event); priority by name; `user_id`; `idle` gte/lte; `created_at` gte `YYYY-MM-DD`. Broken: nested OR groups, `location`/`location_id`, `user` by name, `neq`. `created_at` comes back as `MM/DD/YYYY hh:mm AM/PM`.

## Working on it - lessons learned
- **Mock tests are not enough.** v1.2-v1.4.1 all passed a local mock CRM but failed live. The breakthrough was recording the real CRM (passive MutationObserver + event logger in a Claude-group Chrome tab while the user clicked). Do that first when something fails live.
- Claude is blocked from opening message windows or sending on the live CRM (real customers); live checks need the user. Read-only GETs to `/customers_grid.json` are fine.
- **Test against `mock-crm/` first** (in the repo since v1.5.1): `node mock-crm/server.js`, then http://localhost:4567/customers?harness=1 runs the real content.js end to end against a mock built from the recording (real jQuery 1.12 / Bootstrap 3 / jquery_ujs, the CRM's own Send code, the grid's filter quirks, message history). The control panel `/mock` switches refresh/close-after-send, rejects, latency, logged out, history down; `?slow=<ms>` slows window animations; `?content=/mock/<file>.js` tests another copy of content.js side by side. `node mock-crm/make-test-extension.js` builds a copy that works ONLY on the mock, to try the real popup. See `mock-crm/README.md`. On its first run the mock caught a v1.5.0 bug (opening the next contact while the CRM window was still animating) - fixed in v1.5.1.
- After reloading the unpacked extension, refresh the CRM tab (old content scripts go dead). Updating = Remove + Load unpacked the new folder (unzipping elsewhere does NOT update Chrome's copy); the popup title shows the version actually loaded.
- Releases: zip of `chrome-extension/` + `HOW-TO-USE.txt` via `git archive`, published with `gh release create extension-vX.Y.Z --latest` (gh is installed at `C:\Program Files\GitHub CLI\gh.exe`, signed in). Bump `manifest.json` version each release.

## Known gaps -> fixed in v1.5.x (branch `fix-gaps`, pre-release `extension-v1.5.1`)
All five gaps listed for v1.4.2 are fixed in v1.5.0. **v1.5.0 still needs a live test by the user** before it becomes the new baseline - until then v1.4.2 stays the stable baseline and v1.5.0 is published as a GitHub *pre-release* (the popup's update notice ignores pre-releases).
- **Rejected send then closed box counted as sent** -> "sent" now requires the CRM's green `#flash_notice` banner ("Message is sended", only added on success) or, failing that, the message appearing in the customer's CRM history (`/customers/<id>/customer_messages.json?message_type=sms`). Not in history = reported "NOT sent" (not counted for the cooldown). History unreadable = "not confirmed" and counted for the cooldown (no double texts).
- **Hidden tabs slowed timers** -> `background.js` service worker provides wake-ups over a `"famfit-timer"` port (`later()` / `every()` in content.js race it against the page's own setTimeout; requests at least every 20s keep the worker alive; reconnects if the worker restarts).
- **Cooldown only knew this Chrome profile** -> right before each text the extension also reads the CRM's message history: the newest outgoing, non-failed/bounced text by a staff user (not `SYSTEM`) within the cooldown -> skip "(CRM history)".
- **No time-of-day limit** -> popup "Only auto-send between [09:00] and [20:00]" (default on); `batch.sendWindow`; outside it auto-send shows a paused badge and rechecks every 15s; windows may cross midnight; manual mode is not limited.
- **No auto-update** -> can't be done without the user's own Chrome Web Store developer account ($5). Prepared everything: icons (`chrome-extension/icons/`), minimal permissions (only `storage` + the CRM host; unused `activeTab`/`scripting` removed), `store/STORE-LISTING.md`, `store/PRIVACY.md`, `store/PUBLISHING.md`, and a `FamFitHelper-WebStore-vX.Y.Z.zip` (manifest at root) attached to each release.

CRM message history format (read-only GET, verified live): `{data: [...], total}` newest first; rows `{user, category: "sms"|"sms_response", message_type: "outgoing"|"incoming", status: "sent"|"failed"|"bounced"|"received", contact, message, subject, created_at: "MM/DD/YYYY hh:mm AM", error_message}`. `user: "SYSTEM"` = the CRM's automated texts.

## Desktop app (archived 2026-10-01)
User decision: the extension replaces it. Removed from `master` in PR #2; last code at tag `desktop-app-final`; exe in release `v1.1.0` (titled "desktop app - archived"). Local build leftovers (dist/, build/, .spec, __pycache__) were deleted. It had unfixed bugs (CRM worker errors leave the UI stuck via a `lambda: ...(e)` NameError; "Signed up within" never matches due to the CRM's date format; Copy & Next marks contacts done without copying when placeholders are blank; corrupt JSON crashes startup) - don't revive it without fixing those.
