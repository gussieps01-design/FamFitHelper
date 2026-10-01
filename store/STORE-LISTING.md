# Chrome Web Store listing - copy/paste text

Use these when filling in the Chrome Web Store Developer Dashboard (see PUBLISHING.md).

## Item name
FamFitHelper CRM Assist

## Summary (max 132 characters)
Texts a filtered list of Healthy Image Fitness CRM customers from message templates - review each one, or let it auto-send.

## Description
FamFitHelper CRM Assist is an internal tool for Healthy Image Fitness staff. It works only on the Healthy Image Fitness CRM (crm.healthyimagefitness.com) and uses your existing CRM login.

- Find who to text: filter customers by status, priority, location, staff, idle days and sign-up date.
- Leaves out people who shouldn't be texted: Dead, unsubscribed, bounced or missing phone numbers, duplicates, and anyone texted within your chosen number of days (it checks the CRM's own message history).
- Fills in each message from a template ({{first_name}}, {{staff}}, {{location}}), rotating between several versions of the pitch.
- Send each message yourself, or turn on Auto-send to work through the list with a pause between texts, only during the sending hours you choose.
- Built for long runs: skips and logs problem contacts, stops if something is wrong, resumes after a page reload, and never texts anyone twice.

## Category
Workflow & Planning (or "Tools")

## Language
English

## Visibility
**Unlisted** - only people with the link can find and install it.

## Single purpose (Privacy practices tab)
Helps Healthy Image Fitness staff send template-based text messages to customers through the Healthy Image Fitness CRM.

## Permission justifications (Privacy practices tab)
- **storage:** saves the user's settings, the current batch and its progress, and when each phone number was last texted (for the re-text cooldown), in the user's own browser.
- **Host permission `https://crm.healthyimagefitness.com/*`:** the extension only works on this CRM; it reads the customer list and message history and fills in / sends messages in the CRM's own message window.
- **Remote code:** No, the extension does not use remote code.

## Data usage (Privacy practices tab)
- Data collected: **Personally identifiable information** (customer names, phone numbers) and **Personal communications** (text messages) - handled only inside the user's browser and the CRM, never sent to the developer or third parties.
- Certify: not sold to third parties; not used for purposes unrelated to the item's single purpose; not used for creditworthiness or lending.

## Privacy policy URL
https://github.com/gussieps01-design/FamFitHelper/blob/master/store/PRIVACY.md

## Images
- Icon: `chrome-extension/icons/icon128.png` (already in the package).
- Screenshot (required, 1280x800 or 640x400): take one of the popup open over the CRM page, with no real customer names visible (e.g. use the Test Test customer).
