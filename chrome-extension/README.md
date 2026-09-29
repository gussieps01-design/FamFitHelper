# FamFitHelper CRM Assist (Chrome extension)

Pre-fills text messages for a batch of CRM contacts, one at a time, and automatically advances to the next contact **after you click Send yourself** in the real CRM. It never clicks Send — it only watches for the CRM's own success confirmation (the green banner it shows after a real send) and moves on once that appears.

## Install (no Chrome Web Store needed)

1. Go to `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `chrome-extension` folder.
4. Pin the extension so it's easy to reach.

## Use

1. Open the CRM's customer list in the same tab (already logged in - the extension reuses your existing session, no separate login).
2. Click the extension icon.
3. **Load from CRM (live)**: fill in any of Status / Priority / Location / Staff / Idle days / Signed up within, and how many pages to search, then click **Load matching contacts**. This calls the CRM's own data endpoint directly and filters client-side - same logic as the desktop app's live connection. Leave everything blank to just pull the plain list.
   - Or, if you'd rather not filter live, expand **"Or paste a list manually instead"** and paste `Name<TAB>Phone` lines, then click **Use this pasted list**.
4. Pick a template, optionally fill in fallback Staff/Location (only used if a contact doesn't already carry that info from the CRM).
5. Click **Start batch**. It finds the first loaded contact on the page, opens their message box, and fills in the rendered message.
6. **You review it and click Send yourself in the CRM** - or press **Ctrl+Enter** while your cursor is in the message box, which does the exact same thing as clicking Send, just without reaching for the mouse. Either way, it's still your deliberate action on that specific message.
7. Once the CRM confirms the send, the extension automatically opens the next contact and fills in their message. The badge shows the name and phone number in large text first, since "is this the right person" is the one check worth never skipping.
8. Repeat until the badge says "All done."

Click **Stop** anytime to halt auto-advancing.

## Important limitations - please read

- **The live-fetch/filter logic uses the same JSON endpoint and field names already verified in the desktop app** (status, priority, location, staff, idle, sign-up date, and the Dead/bounced/unsubscribed auto-exclusion) - this part is well-tested.
- **The send-detection logic was built by reverse-engineering the CRM's own JavaScript, not by testing an actual send.** I (the AI that built this) will not click a real Send button to a real customer to test it, so "did this message actually get sent" has not been verified end-to-end against a live send. **Test it carefully on one low-stakes contact first** before trusting it for a real batch.
- It can only find contacts that are visible on the *current* customer list page/filter. If someone isn't on the page you're looking at, it'll tell you and skip them - navigate to find them and resume manually.
- If the CRM's page layout, tab structure, or success-banner markup ever changes, this will likely need updating.
- It only substitutes `{{first_name}}`, `{{last_name}}`, `{{staff}}`, `{{location}}` - not appointment dates.
