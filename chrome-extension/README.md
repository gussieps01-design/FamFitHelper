# FamFitHelper CRM Assist (Chrome extension, v1.5)

Texts a filtered list of CRM customers one at a time from a message template. By default you click Send for each person and it moves on to the next. The opt-in **Auto-send** mode sends through the whole list by itself.

Simple step-by-step instructions: [../HOW-TO-USE.txt](../HOW-TO-USE.txt).

## Install (no Chrome Web Store needed)

1. Go to `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `chrome-extension` folder.
4. Pin the extension so it's easy to reach.

**Updates:** unpacked extensions can't update themselves. The popup checks GitHub releases (at most every 6 hours) and shows an **Update available** notice with a download link when a newer extension release exists. The version in use is shown in the popup title and on the CRM-page status box. To update:
- Remove the extension and **Load unpacked** the new folder, or copy the new files over the folder Chrome already uses and click the reload arrow.
- Then **refresh the CRM tab**. An already-open tab keeps the old version.

For automatic updates, publish it (unlisted) on the Chrome Web Store - everything needed is in [../store/](../store/PUBLISHING.md).

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
   - Each template holds several **versions** of the same pitch, separated by a line with just `---`. With **Rotate between versions** on (the default), each batch starts at a random version and each contact gets the next one. Turn it off to send everyone the first version.
   - There are 8 starter templates (Personal training, Holiday notice, Relocation, Membership expired win-back, Former members, Free pass / trial follow-up, Missed guests, Re-engagement), each with 3 versions. Edit, add or remove versions right in the box.
   - **Your own messages:** pick "Write my own message...", type it, name it and click Save. Saved templates appear under "My saved templates" and can be edited (Save changes), copied (Save as new), reverted (Undo changes) or deleted. Starters are never changed; edit one and use "Save as my own template". The Insert buttons add `{{first_name}}`, `{{last_name}}`, `{{staff}}`, `{{location}}` or a new `---` version. A message with an unknown or malformed `{{field}}` can't be saved or started. Saved templates are kept in `chrome.storage.local` under `famfitSavedTemplates` (this Chrome profile only).
6. **Start batch**:
   - **Manual** (Auto-send off): each person's SMS box opens pre-filled, with their name and phone shown large in the corner. Review it, then click Send or press **Ctrl+Enter**. It moves on when the CRM confirms the send.
   - **Auto-send**: set "seconds between auto-sends" (default 5) and the **sending hours** (default 9:00 AM - 8:00 PM), start, and confirm. It keeps its pace even when the CRM tab is in the background.
7. At the end the badge shows "Done: X sent, Y skipped", and the popup lists who was skipped and why.

Closing the popup is safe; everything is saved and restored when it reopens.

## How it behaves

- **Searching**: Status, Priority, Staff, Idle and Signed-within are sent to the CRM as filters, so the whole customer list is searched. Location is checked by the extension. Every result is re-checked against your filters.
- **Always left out**: contacts marked Dead, unsubscribed, with a bounced phone, or with no phone. A phone number shared by several customers is texted once.
- **Re-text cooldown** (the "days" box, default 7, 0 = off): anyone texted within that many days is left out at Load and skipped again right before texting. Right before each text it also checks **the CRM's own message history** for that customer, so texts sent from other computers or typed straight into the CRM count too. The CRM's automated texts ("SYSTEM") and failed/bounced texts don't count.
- **Sending hours** (auto-send only): outside them the run pauses and carries on by itself when they start again (a window can cross midnight, e.g. 10 PM - 6 AM). Manual mode isn't limited - a person is deciding.
- **Opening contacts**: CRM-loaded contacts are opened by their customer id, from any page. Pasted contacts have no id and must be visible on the current customer list page. Any message window still open is closed first (the CRM's open link is a toggle).
- **"Sent"** means Send was clicked for that contact AND the CRM confirmed it: its green "Message is sended" banner, or - if that doesn't show - the message appearing in the customer's CRM history. A send the CRM rejected is reported as **NOT sent** (safe to text later). If neither can be checked, it's reported as "not confirmed" and counted for the cooldown so nobody gets it twice.
- **Safety checks**:
  - It only fills a freshly loaded message box for that exact contact.
  - A message with a blank `{{field}}` is never auto-sent.
  - Auto-send only clicks Send when the visible box holds exactly that contact's message.
- **Long runs**:
  - A contact that can't be opened, has a blank `{{field}}`, or isn't confirmed is **skipped and logged**, never re-sent, and the run continues.
  - **3 failures in a row stop the run** (usually an expired login). Fix it and click Start to continue.
  - If the CRM page reloads mid-run, auto-send **resumes by itself** within about 15 seconds. A contact whose Send was already clicked when the page reloaded is skipped, never texted twice.
  - Timers run in the extension's background worker, so a hidden tab doesn't slow the run down.
  - Only one CRM tab drives a run.
- **Start vs. Stop**:
  - **Start** resumes a stored batch where it left off.
  - **Stop** ends it and saves the summary. After a Stop, Start begins a *new* batch from the loaded list, from the top. People already texted are skipped by the re-text cooldown, unless it's set to 0.

## Permissions

Only `storage` (settings and batch progress, in your browser) and access to `crm.healthyimagefitness.com`. See [../store/PRIVACY.md](../store/PRIVACY.md).

## Limits

- Placeholders: `{{first_name}}`, `{{last_name}}`, `{{staff}}`, `{{location}}` (no appointment dates).
- If the CRM's page layout or message box changes, this will likely need updating.
