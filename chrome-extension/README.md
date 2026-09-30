# FamFitHelper CRM Assist (Chrome extension, v1.3)

Texts a filtered list of CRM customers one at a time from a message template. By default you click Send for each person and it moves on to the next. The opt-in **Auto-send** mode sends through the whole list by itself.

Simple step-by-step instructions: [../HOW-TO-USE.txt](../HOW-TO-USE.txt).

## Install (no Chrome Web Store needed)

1. Go to `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `chrome-extension` folder.
4. Pin the extension so it's easy to reach.

After updating the files, click the reload arrow on the extension in `chrome://extensions`, then **refresh the CRM tab**. An already-open tab keeps the old version, and the popup will tell you to refresh.

## Use

1. Open the CRM's customer list and log in. The extension reuses that login.
2. Click the extension icon. The Status / Priority / Location / Staff lists fill in from the CRM, with progress shown in a small box on the CRM page.
3. **Pick filters and click Load matching contacts.**
   - Ctrl-click to pick several values in a list; "Any" clears the list.
   - Idle days min/max and "Signed up within" are number fields.
   - "Search up to N pages" caps how many pages of *matches* (100 each) are pulled. The summary tells you if it stopped early.
   - Or paste `Name<TAB>Phone` lines under "Or paste a list manually instead".
4. **Text how many**: leave it blank for everyone loaded, or type a number to text only the first N.
5. Pick a template. The optional Staff/Location fallbacks are used when a contact has none in the CRM.
6. **Start batch**:
   - **Manual** (Auto-send off): each person's SMS box opens pre-filled, with their name and phone shown large in the corner. Review it, then click Send or press **Ctrl+Enter**. It moves on when the CRM confirms the send.
   - **Auto-send**: set "seconds between auto-sends" (default 5), start, and confirm. Keep the CRM tab visible, in its own window if you like, because Chrome slows down hidden tabs.
7. At the end the badge shows "Done: X sent, Y skipped", and the popup lists who was skipped and why.

Closing the popup is safe; everything is saved and restored when it reopens.

## How it behaves

- **Searching**: Status, Priority, Staff, Idle and Signed-within are sent to the CRM as filters, so the whole customer list is searched. Location is checked by the extension. Every result is re-checked against your filters.
- **Always left out**: contacts marked Dead, unsubscribed, with a bounced phone, or with no phone. A phone number shared by several customers is texted once.
- **Re-text cooldown** (the "days" box, default 7, 0 = off): anyone texted within that many days is left out at Load and skipped again right before texting. That also covers running the same list twice. The record of who was texted when is kept in this Chrome profile only, so it doesn't know about texts sent from other computers or directly in the CRM.
- **Opening contacts**: CRM-loaded contacts are opened by their customer id, from any page. Pasted contacts have no id and must be visible on the current customer list page.
- **"Sent"** means Send was clicked for that contact and then the CRM closed the message box or showed its green banner. Closing the box *without* clicking Send leaves that contact in place; click Start to bring them back.
- **Safety checks**:
  - It only fills a freshly loaded message box for that exact contact.
  - A message with a blank `{{field}}` is never auto-sent.
  - Auto-send only clicks Send when the visible box holds exactly that contact's message.
- **Long runs**:
  - A contact that can't be opened, has a blank `{{field}}`, or isn't confirmed sent within 20 seconds is **skipped and logged**, never re-sent, and the run continues.
  - **3 failures in a row stop the run** (usually an expired login). Fix it and click Start to continue.
  - If the CRM page reloads mid-run, auto-send **resumes by itself** within about 15 seconds. A contact whose Send was already clicked when the page reloaded is skipped, never texted twice.
  - Only one CRM tab drives a run.
- **Start vs. Stop**:
  - **Start** resumes a stored batch where it left off.
  - **Stop** ends it and saves the summary. After a Stop, Start begins a *new* batch from the loaded list, from the top. People already texted are skipped by the re-text cooldown, unless it's set to 0.

## Limits

- Placeholders: `{{first_name}}`, `{{last_name}}`, `{{staff}}`, `{{location}}` (no appointment dates).
- If the CRM's page layout or message box changes, this will likely need updating.
- If you click Send, the CRM rejects it, and you then close the box, that contact is counted as sent.
- There's no time-of-day limit; only start runs during reasonable hours.
