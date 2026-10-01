# FamFitHelper - Handoff (2026-10-01)

## STABLE BASELINE: extension v1.4.2
**v1.4.2 is the known-good version. Build every future version on top of it.**
- Confirmed by the user on the live CRM (2026-10-01): auto-send "Done: 5 sent, 0 skipped of 5"; the user called it "everything works good".
- Marked in git: tag **`extension-stable-1.4.2`** and branch **`stable`** (both point at the baseline). Release: https://github.com/gussieps01-design/FamFitHelper/releases/tag/extension-v1.4.2
- To start new work: `git checkout -b <new-branch> extension-stable-1.4.2`. To compare a change against the baseline: `git diff extension-stable-1.4.2`. If a later version breaks, the baseline zip on the release page is the fallback.
- Don't regress the hard-won CRM behaviour (see "CRM facts learned"): close any open message window before opening the next contact (the open link is a toggle); use the *visible* SMS form; record the extension's own Send click directly; treat the window closing/refreshing or the green banner as "sent".

## What this is
- Chrome extension (`chrome-extension\`, v1.4.2) that pre-fills SMS templates for batches of contacts in the live production CRM at `https://crm.healthyimagefitness.com` (real gym customers), and can optionally auto-send them.
- A desktop app (`app.py`) also exists; it was out of scope for this work and has known, unfixed bugs (see bottom).
- Repo: https://github.com/gussieps01-design/FamFitHelper. Extension work landed via PR #1 (`extension-v1.1-open-by-id`).

## How the extension works now
- **Load** sends Status / Priority / Staff / Idle / Signed-within to the CRM's own grid endpoint (`/customers_grid.json`, Kendo-style `filter[...]` params), so it searches all ~21.5k customers. Location, the Dead/bounced/unsubscribed/no-phone exclusions, and duplicate-phone removal happen in the extension. Every returned row is re-checked client-side.
- **Opening a contact** clicks a synthetic remote-modal link `/customers/<id>/customer_journal_items/new` (CRM-loaded contacts carry their id). Pasted contacts (no id) must be on the visible grid page.
- **Filling** targets the textarea inside `form#new_sms_customer_message` (the page reuses the same id for a hidden Email textarea). The previous modal is marked `data-famfit-stale` so only freshly loaded content is filled.
- **Sent** = Send was clicked for this contact AND then the modal closed (what the live CRM does) or the green `.alert-success` banner appeared.
- **Batch engine** (`content.js`): state in `chrome.storage.local.famfitBatch` (`index`, `stats`, `inFlight`, `owner`, `running`, `lastActivity`, `delaySec`, ...). Failures skip + log; 3 in a row stop the run; `inFlight` prevents double-texting after a reload; a reloaded page auto-resumes an auto-send run active in the last 10 min; only the owning tab acts. Auto-send only clicks when the visible box holds exactly the rendered message. `famfitLastRun` keeps the last summary.
- **Popup**: Start resumes a stored batch (never restarts at contact 1); Stop ends it and saves the summary.

## CRM facts learned (live, read-only checks)
- Grid filter support: status works only by numeric code (0 Member, 1 Guest, 2 Trial, 3 Corporate, 4 Contest Box, 5 Phone Inquiry, 6 Former Member, 7 Member Referral, 9 Event); priority by name; `user_id`; `idle` gte/lte; `created_at` gte `YYYY-MM-DD`.
- Broken server-side: nested OR groups (a status OR-group + any other filter returns 0), `location`/`location_id`, `user` by name, `neq`. Hence one plain-AND query per value combination.
- `created_at` comes back as `MM/DD/YYYY hh:mm AM/PM`.
- After reloading the unpacked extension, refresh the CRM tab or the old content script is dead.
- Recorded live (2026-10-01): the open link (`data-remote` + `data-toggle="modal"` + `data-target="#modal-window"`) is a Bootstrap TOGGLE - clicking it while the window is open closes it. The page has TWO `#modal-window` elements (the first one is used). The SMS tab (`#smss`) is active by default. Send = `a#submit_sms_message.submit_message` whose own click handler does `if (sent) return; sent = true;` then `$.post` of `#new_sms_customer_message` (action `/customers/<id>/customer_messages.js`, data-remote) and on success evals the JS reply and inserts `.alert-success #flash_notice` ("Message is sended") before `#main_content`. `var sent = false` is reset by the window's inline scripts on every load.
- After a send the window may stay open (refreshed) rather than close. v1.4.2 closes any open window (its X) before opening the next contact - this fixed the "every other contact fails" bug. Confirmed live: 5 sent, 0 skipped.

## Verification status
- Mock-CRM harness (real extension files, stubbed `chrome.*`; lives in a session scratchpad, not the repo): 48 content-script, 4 page-reload, 29 popup, 20 filter-logic checks - all pass.
- Live CRM, read-only: server-side filtering checked on 6 combinations - 0 missed, 0 wrong.
- User-confirmed live: open-by-id + fill + advance for off-page contacts; on 2026-09-30 the user tested v1.2 on the live CRM and reported it working.
- Claude cannot drive the real popup or send real texts; live checks are the user's.

## Next steps
- Merge PR #1 into master (the auto-mode classifier blocks Claude from merging without review).
- Share `HOW-TO-USE.txt` with other staff; start with small batches.
- Possible follow-up: after Stop, Start re-runs the loaded list from the top (documented; not guarded in code).

## Known gaps
- Click Send, CRM rejects it, then close the box -> counted as sent (rare now that no-phone contacts are excluded).
- Chrome still slows timers (pacing, 20s confirm) in hidden tabs; keep the CRM tab visible.
- Desktop app (`app.py`), untouched: CRM worker errors leave the UI stuck (`lambda: ...(e)` NameError), "Signed up within" never matches (date format), Copy & Next marks contacts done without copying when placeholders are blank, corrupt JSON files crash startup.
