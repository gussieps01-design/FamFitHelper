# FamFitHelper

A Chrome extension for texting gym customers from the Healthy Image Fitness CRM using reusable message templates. It texts a whole filtered list of customers straight from the CRM: you either click Send for each person, or turn on Auto-send and let it run through the list by itself.

**New here? Read [HOW-TO-USE.txt](HOW-TO-USE.txt)** for step-by-step install and use instructions.

## Chrome extension (v1.5)

**Download:** get `FamFitHelper-Chrome-Extension-*.zip` from the [latest release](../../releases/latest). It contains just the extension and the how-to note. Unzip it, go to `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick the `chrome-extension` folder. Full details are in [HOW-TO-USE.txt](HOW-TO-USE.txt) and [chrome-extension/README.md](chrome-extension/README.md).

What it does:
- **Finds who to text across the whole CRM.** Filter by Status, Priority, Location, Staff, idle days and sign-up date (pick several values per filter). The CRM itself does the filtering, so every customer is searched, not just the most recent ones. It uses your existing CRM login, so there's nothing extra to sign in to.
- **Leaves out people who shouldn't be texted.** Contacts marked Dead, unsubscribed, with a bounced phone or no phone are skipped automatically, and a phone number shared by several customers is only texted once.
- **Re-text cooldown.** Choose how many days must pass before the same person can be texted again (default 7, 0 = off). Right before each text it checks the CRM's own message history, so texts from other computers or typed into the CRM count too.
- **Fills in each message for you.** It opens each customer's SMS box and fills in the template with `{{first_name}}`, `{{last_name}}`, `{{staff}}` and `{{location}}`, with optional fallbacks for Staff and Location.
- **Rotating pitches.** Each template has several versions of the same pitch (the 8 starter templates have 3 each). With rotation on, each contact gets the next version, so people don't all get identical wording. You can also write, save, edit and delete your own templates.
- **Two ways to send:**
  - *Manual:* review each message, then click Send (or press Ctrl+Enter). It moves on to the next person as soon as the CRM confirms the send.
  - *Auto-send:* opt-in, and confirmed every time you start. It sends through the whole list unattended, with a configurable pause between texts, only during the sending hours you choose (default 9 AM - 8 PM).
- **Built for long unattended runs:**
  - A person who can't be reached is skipped and logged; 3 failures in a row stop the run (usually a logged-out session).
  - It resumes by itself if the CRM page reloads, and never texts anyone twice.
  - Only one tab ever runs a batch.
  - It never sends a message with a blank `{{field}}`, and only counts a text as sent when the CRM confirms it.
  - It keeps its pace even when the CRM tab is in the background.
- **Remembers your work.** Filters, template and loaded contacts survive closing the popup. "Text how many" limits a batch. After a run, the popup shows how many were sent and who was skipped and why.
- **Update notice.** The popup tells you when a newer version is on the releases page.

**Stable baseline:** v1.6.1 is the current stable version (git tag `extension-stable-1.6.1`, branch `stable`). The previous stable version, v1.6.0, is tag `extension-stable-1.6.0`.

**Automatic updates:** to have Chrome update the extension by itself, publish it (unlisted) on the Chrome Web Store - see [store/PUBLISHING.md](store/PUBLISHING.md).

## Desktop app (archived)

The older Windows desktop app (`app.py` / `FamFitHelper.exe`) is retired; the Chrome extension replaces it. It's kept for reference:
- The last code that includes it is tagged [`desktop-app-final`](../../tree/desktop-app-final).
- The built `FamFitHelper.exe` is still in the [v1.1.0 release](../../releases/tag/v1.1.0).
