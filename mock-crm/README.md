# Mock CRM

A stand-in for the Healthy Image Fitness CRM, for testing FamFitHelper **without touching the real CRM or texting real people**. All customers are fake.

It copies the real CRM as recorded on 2026-10-01 (see `../HANDOFF.md`, "CRM facts"):
- the same libraries: jQuery 1.12, Bootstrap 3 and Rails' `jquery_ujs`. So the message window really is a Bootstrap toggle, tabs really fade, and links really load over Ajax.
- the same page structure and ids: two `#modal-window` elements, the Journal / Messaging tabs, SMS selected by default, and the shared textarea id.
- the CRM's own Send-button code: `if (sent) return; ...`, the background post, and the green "Message is sended" banner.
- the same data endpoints and quirks:
  - `/customers_grid.json` with Kendo filters: status only by number, location ignored, OR groups broken.
  - message history (`customer_messages.json`), opening a customer's window, sending.

Needs only Node (no `npm install`). The page loads jQuery and Bootstrap from cdnjs, so it needs internet.

## Run it

```
node mock-crm/server.js
```

Then open http://localhost:4567. The **control panel** at http://localhost:4567/mock switches behaviours:
- whether the window refreshes or closes after a send
- rejected sends
- slow server
- logged out
- message history down

It also lists every text "sent" through the mock.

## Automated tests (the real extension code)

With the server running, open http://localhost:4567/customers?harness=1. The real `content.js` runs inside the mock page with a stand-in for Chrome's extension API. It goes through:
- Load and filter options
- manual send and Ctrl+Enter
- auto-send with refresh and with close after send
- rejected sends and logged out
- the CRM-history cooldown and sending hours
- template rotation, Stop, and a page reload mid-run

Results show at the top of the page (and in `window.results`).

Add `&port=1` to also exercise the background-worker timers.

## Try the real popup against the mock

```
node mock-crm/make-test-extension.js
```

This writes `mock-crm/test-extension/`, a copy of the extension that works **only** on the mock (`http://localhost:4567`), never on the real CRM. In Chrome:
1. Go to `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick `mock-crm/test-extension`.
3. Open http://localhost:4567 and use the popup as usual.

Texts only go to the mock, and appear in its control panel. Remove the test copy when you're done, so it doesn't sit next to the real one.
