# FamFitHelper CRM Assist (Chrome extension)

Pre-fills text messages for a batch of CRM contacts, one at a time, and automatically advances to the next contact **after you click Send yourself** in the real CRM. It never clicks Send — it only watches for the CRM's own success confirmation (the green banner it shows after a real send) and moves on once that appears.

## Install (no Chrome Web Store needed)

1. Go to `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `chrome-extension` folder.
4. Pin the extension so it's easy to reach.

## Use

1. Open the CRM's customer list in the same tab.
2. Click the extension icon.
3. Paste your contact list (one per line: `Name<TAB>Phone`, or just `Name`).
4. Pick a template, optionally fill in Staff/Location (applied to every message in the batch).
5. Click **Start batch**. It finds the first contact on the page, opens their message box, and fills in the rendered message.
6. **You review it and click Send yourself in the CRM.** Once the CRM confirms the send, the extension automatically opens the next contact and fills in their message.
7. Repeat until the badge in the top-right says "All done."

Click **Stop** anytime to halt auto-advancing.

## Important limitations - please read

- **This was built by reverse-engineering the CRM's own JavaScript, not by testing an actual send.** I (the AI that built this) will not click a real Send button to a real customer to test it, so the "detect a successful send" logic has not been verified end-to-end against a live send. **Test it carefully on one low-stakes contact first** before trusting it for a real batch.
- It can only find contacts that are visible on the *current* customer list page/filter. If someone isn't on the page you're looking at, it'll tell you and skip them - navigate to find them and resume manually.
- If the CRM's page layout, tab structure, or success-banner markup ever changes, this will likely need updating.
- It only substitutes `{{first_name}}`, `{{last_name}}`, `{{staff}}`, `{{location}}` - not appointment dates.
