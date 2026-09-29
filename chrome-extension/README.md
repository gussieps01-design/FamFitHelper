# FamFitHelper CRM Assist (Chrome extension)

Pre-fills text messages for a batch of CRM contacts, one at a time, and automatically advances to the next contact **after you click Send yourself** in the real CRM. By default it never clicks Send — it only watches for the CRM's own success confirmation (the green banner it shows after a real send) and moves on once that appears.

**Auto-send mode**: the popup has an opt-in "Auto-send" checkbox (off by default, confirmed via a popup dialog each time you start a batch with it on). When enabled, the extension clicks the CRM's real Send button itself for every contact in the batch, unattended — no per-person review or manual click. It still uses the same (reverse-engineered, never verified against a real send — see below) success-banner detection to know when to advance. Only use this against a destination you've confirmed doesn't deliver to a real person's phone.

## Install (no Chrome Web Store needed)

1. Go to `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `chrome-extension` folder.
4. Pin the extension so it's easy to reach.

## Use

1. Open the CRM's customer list in the same tab (already logged in - the extension reuses your existing session, no separate login).
2. Click the extension icon.
3. **Load from CRM (live)**: Status / Priority / Location / Staff are multi-select dropdowns populated by scanning the live CRM (up to 10 pages / ~1,000 recent customers) when the popup opens - ctrl/cmd-click to pick more than one value in a box (e.g. Priority: Warm + Cold). Each box's first entry is **"Any (click to clear all)"** - a plain click (no ctrl/cmd) on it clears every other selection in that box back to "no filter," since that's standard behavior for a plain click in a multi-select. **This scan can take a while** - the CRM's data endpoint has been observed taking 1-7 seconds per page, so 10 pages can take 20-40+ seconds. Watch the badge on the CRM page itself for per-page progress ("Scanning filter options... page X of 10") rather than assuming it's frozen. Click **Refresh dropdown options from CRM** if you don't see an option you expect (rare values outside that scan won't appear). Idle days min/max, Signed up within, and Search up to N pages are still plain number fields. Fill in what you want, then click **Load matching contacts**. This calls the CRM's own data endpoint directly and filters client-side - same logic as the desktop app's live connection. Leave everything blank/unselected to just pull the plain list.
   - Or, if you'd rather not filter live, expand **"Or paste a list manually instead"** and paste `Name<TAB>Phone` lines, then click **Use this pasted list**.
4. **Text how many**: shows "of N loaded, to text" next to the loaded count. Leave it blank to text everyone loaded, or type a number to only text the first that many of the loaded list (e.g. loaded 200, type 20 to only message the first 20).
5. Pick a template, optionally fill in fallback Staff/Location (only used if a contact doesn't already carry that info from the CRM).
6. Click **Start batch**. It finds the first loaded contact on the page, opens their message box, and fills in the rendered message.
7. **You review it and click Send yourself in the CRM** - or press **Ctrl+Enter** while your cursor is in the message box, which does the exact same thing as clicking Send, just without reaching for the mouse. Either way, it's still your deliberate action on that specific message. (Unless you checked **Auto-send** before clicking Start - then this step is skipped and the extension clicks Send itself for every contact.)
8. Once the CRM confirms the send, the extension automatically opens the next contact and fills in their message. The badge shows the name and phone number in large text first, since "is this the right person" is the one check worth never skipping.
9. Repeat until the badge says "All done."

**Closing the popup is safe.** Loaded contacts, filter picks, the template, fallback Staff/Location, Text how many, and Auto-send are all saved to the extension's storage as you go and restored automatically the next time you open the popup - you don't need to keep it open continuously between Load and Start.

Click **Stop** anytime to halt auto-advancing.

## Important limitations - please read

- **The live-fetch/filter logic uses the same JSON endpoint and field names already verified in the desktop app** (status, priority, location, staff, idle, sign-up date, and the Dead/bounced/unsubscribed auto-exclusion) - this part is well-tested.
- **The send-detection logic was built by reverse-engineering the CRM's own JavaScript, not by testing an actual send.** "Did this message actually get sent" has not been verified end-to-end against a live send. **Test it carefully on one low-stakes contact first** before trusting it for a real batch.
- **Auto-send mode removes the one human-in-the-loop check this tool was originally built around.** If the success-banner detection ever misfires (page layout change, slow network, etc.) it could skip a contact, double-fire a click, or advance before a send actually completed. Keep it off for any batch aimed at real customer phones; it exists for testing against a non-production destination.
- Contacts loaded from the CRM (Load matching contacts) are opened by their customer id, so they don't need to be on the page you're looking at. Contacts from a **pasted list** have no id and can only be found if they're visible on the *current* customer list page/filter - otherwise it'll tell you and stop; navigate to find them and resume manually. Contacts loaded before v1.1.0 have no id either - click Load again to refresh them.
- Before filling each message it waits for that contact's own message box to load, and skips the contact (with a red badge) rather than risk filling the previous person's box.
- If the CRM's page layout, tab structure, or success-banner markup ever changes, this will likely need updating.
- It only substitutes `{{first_name}}`, `{{last_name}}`, `{{staff}}`, `{{location}}` - not appointment dates.
