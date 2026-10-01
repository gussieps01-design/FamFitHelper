# CLAUDE.md - FamFitHelper

Instructions for Claude working in this repo. Read this first. `HANDOFF.md` has the longer history and details.

## What this is
A Chrome extension (`chrome-extension/`, Manifest V3, loaded unpacked) that texts filtered lists of customers from the **Healthy Image Fitness CRM** (`https://crm.healthyimagefitness.com`). That's a **live production system with real customers**. Sending is either manual (a person clicks Send / Ctrl+Enter) or opt-in Auto-send. The user is the owner, Gus; staff use the extension. The old desktop app is archived (tag `desktop-app-final`): don't revive or extend it unless asked.

## Hard rules
- **Never open message windows, send texts, or click anything on the live CRM yourself.** It's blocked anyway, and it would text real people. Read-only GETs to `/customers_grid.json` and `/customers/<id>/customer_messages.json` are OK.
- **Live tests are the user's job.** Ask for small batches (3-5 people) and the full red badge text.
- **Test every extension change against the mock CRM first** (below). Many versions passed hand-made mocks and failed live; the mock in `mock-crm/` is built from a recording of the real CRM.
- **Don't merge or mark a release stable until the user confirms it works on the live CRM.** Publish new versions as GitHub **pre-releases** first.
- **Keep the stable baseline safe.** v1.4.2 is the last user-confirmed version (tag `extension-stable-1.4.2`, branch `stable`, release `extension-v1.4.2` marked Latest).
- Commit on a branch and open a PR. Don't push to `master` directly.

## Current state (update this section when it changes)
- **v1.5.1 is in testing:** branch `fix-gaps`, PR #4 (open, NOT merged), pre-release `extension-v1.5.1`. It fixes all known gaps:
  - CRM-confirmed sends
  - background-tab timers via `background.js`
  - the re-text cooldown also checks CRM history
  - auto-send sending hours
  - Chrome Web Store prep in `store/`
  - waiting for the CRM window to finish animating
- **Waiting on:** the user's live test of v1.5.1.
- **If it passes:**
  - Merge PR #4.
  - Make `extension-v1.5.1` a full, Latest release titled "(stable baseline)".
  - Add tag `extension-stable-1.5.1`, move branch `stable`, and update this section, HANDOFF.md and memory.
- **If it fails:** reproduce it in the mock, fix it, add a mock test, and release v1.5.2 as a pre-release.
- **Optional (user's decision):** publish on the Chrome Web Store (unlisted). It needs the user's own $5 developer account; see `store/PUBLISHING.md`.

## Commands
```bash
node mock-crm/server.js                 # mock CRM at http://localhost:4567 (control panel: /mock)
# then open http://localhost:4567/customers?harness=1  -> real content.js, 14 end-to-end checks
node mock-crm/make-test-extension.js    # mock-ONLY copy of the extension in mock-crm/test-extension/ (git-ignored)
node --check chrome-extension/content.js    # quick syntax check (no build step, no npm)
```
- Mock page options:
  - `?harness=manual`: extension loaded, no tests
  - `?slow=<ms>`: slow window animations
  - `?content=/mock/<file>.js`: run an old copy of content.js side by side
  - `&port=1`: test the background-worker timers
- Control panel `/mock`: refresh or close after send, reject sends, latency, logged out, history down.
- Use the in-app Browser pane to run the harness, and read results with `window.results` / `window.testsDone`.
- `gh` is at `C:\Program Files\GitHub CLI\gh.exe` (signed in as gussieps01-design). The shell is Git Bash on Windows.

## Architecture (chrome-extension/)
- `content.js`: runs on the CRM page.
  - **Load:** CRM-side filtering via Kendo `filter[...]` params, one plain-AND query per value combination, with every row re-checked client-side.
  - **Batch engine:** `chrome.storage.local.famfitBatch`, with `owner`, `inFlight`, `running`, stats, auto-resume after reload, and a stop after 3 failures in a row.
  - **Open, fill and send,** plus the send-confirmation logic.
- `background.js`: timer service over the `"famfit-timer"` port. content.js `later()` / `every()` race it against setTimeout so hidden tabs don't stall runs.
- `popup.js` / `popup.html`: the UI.
  - Start resumes a stored batch; Stop ends it.
  - The update notice uses the GitHub releases API and ignores pre-releases.
  - `isCrmUrl()` uses the manifest's match patterns.
- `templates.js`: `FAMFIT_TEMPLATES` (8 starter templates x 3 versions, split by a line with only `---`), `famfitRenderTemplate` (`{{first_name}} {{last_name}} {{staff}} {{location}}`), and the validators `famfitTemplateProblems` / `famfitNameProblem` (unknown or malformed `{{fields}}` can't be saved or started).
- Saved templates: `chrome.storage.local.famfitSavedTemplates` = `[{id, name, text}]`. The popup picks templates by key (`b:<n>` starter, `u:<id>` saved, `new`), tracks unsaved edits against a baseline, and verifies every save by reading it back. `content.js` is unchanged: a batch still just carries `templateText`.
- Popup tests: `http://localhost:4567/popup-tests` (22 checks, drives the real popup in an iframe; `/popup` is the popup alone).
- **Storage keys:** `famfitBatch`, `famfitPopupState`, `famfitSentLog` (phone -> last-texted ms), `famfitLastRun`, `famfitHeartbeat`, `famfitCrmMaps`, `famfitUpdateCheck`.
- **Permissions:** only `storage` plus the CRM host. Keep them minimal.

## CRM gotchas (recorded live; don't regress these)
- The open link (`data-toggle="modal"` `data-target="#modal-window"` `data-remote`) is a **Bootstrap toggle**: clicking it while a window is open or animating closes it. Wait until no window is open and no `.modal-backdrop` exists, and only close a fully open (`.in`) window, via its X.
- **Ids are duplicated:** two `#modal-window` elements, and `#customer_message_message` on both the SMS and Email forms. Never trust `getElementById`; use the **visible** SMS form (`getSmsForm()`).
- **After a send the window may refresh (stay open) or close.** "Sent" = Send was clicked AND (the green `#flash_notice` "Message is sended" banner OR the message in the CRM history). A rejected send counts as NOT sent.
- **The CRM's Send handler has `if (sent) return; sent = true;`** (reset on each window load). The extension records its own Send click directly; don't rely on page events to report it.
- **Grid filter quirks:**
  - Status works only by numeric code: 0 Member, 1 Guest, 2 Trial, 3 Corporate, 4 Contest Box, 5 Phone Inquiry, 6 Former Member, 7 Member Referral, 9 Event.
  - Priority by name; `user_id`; idle gte/lte; `created_at` gte `YYYY-MM-DD`.
  - Broken: nested OR groups, location/location_id, user by name, `neq`.
  - Dates come back as `MM/DD/YYYY hh:mm AM`.
- **Message history:** `message_type` is `outgoing` or `incoming`; status is `sent`, `failed`, `bounced` or `received`; user `"SYSTEM"` = automated texts (don't count them for the cooldown).
- When live behaviour differs from the mock: record it (a passive observer in a Claude-group Chrome tab while the user clicks), then **update `mock-crm/` to match**.

## Pitfalls
- **The in-app Browser pane collapses to 0x0 when hidden.** Don't rely on element sizes. `isWindowShown()` uses computed display plus `.in`.
- **Git converts files to CRLF on checkout (autocrlf)**, so regex-based test extraction must normalize `\r\n`.
- **After the user reloads the unpacked extension, the CRM tab must be refreshed.** Updating = Remove + Load unpacked the new folder; the popup title shows the loaded version.
- **A GateGuard hook asks for "facts"** (importers, affected API, data, the user's verbatim instruction) before the first edit of each file and before the first Bash command. State them briefly and retry.

## Releasing
1. Bump `chrome-extension/manifest.json` `version`. Commit on a branch, then open a PR.
2. Build the zips with `git archive`:
   - user zip: `--prefix=FamFitHelper-Chrome-Extension-vX.Y.Z/`, with `chrome-extension` + `HOW-TO-USE.txt`
   - store zip: `HEAD:chrome-extension`, so the manifest is at the root
3. Run `gh release create extension-vX.Y.Z --prerelease ...` with both zips plus `HOW-TO-USE.txt`.
4. After the user confirms on the live CRM, make it Latest/stable (see "Current state").
5. Update `HOW-TO-USE.txt`, the READMEs and this file when behaviour changes. Write user-facing text in plain language.
