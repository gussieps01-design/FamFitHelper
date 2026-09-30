# FamFitHelper - Handoff (2026-09-30)

## What this is
- Chrome extension (`chrome-extension\`, v1.2.0) that pre-fills SMS templates for batches of contacts in the live production CRM at `https://crm.healthyimagefitness.com` (real gym customers), and can optionally auto-send them.
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
- After a successful send the CRM closes the message modal (no new banner seen by the user).
- After reloading the unpacked extension, refresh the CRM tab or the old content script is dead.

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
