# Publishing to the Chrome Web Store (for automatic updates)

Once the extension is on the Chrome Web Store, Chrome installs updates **by itself** - nobody has to download zips or reload anything. Publish it as **Unlisted** so only people with the link can find it.

## One-time setup (about 15 minutes, plus Google's review)
1. Go to https://chrome.google.com/webstore/devconsole and sign in with the Google account that should own the extension.
2. Pay the one-time **$5** developer registration fee and accept the developer agreement.
3. Click **New item** and upload **`FamFitHelper-WebStore-vX.Y.Z.zip`** from the latest release on GitHub (the zip with `manifest.json` at the top level - not the one with the how-to note).
4. **Store listing** tab: copy the name, summary, description and category from `STORE-LISTING.md`. Upload a screenshot of the popup (hide real customer names).
5. **Privacy practices** tab: copy the single purpose, permission justifications and data-usage answers from `STORE-LISTING.md`. Privacy policy URL: https://github.com/gussieps01-design/FamFitHelper/blob/master/store/PRIVACY.md
6. **Distribution** tab: set Visibility to **Unlisted**.
7. Click **Submit for review**. Google usually reviews within a few days; you'll get an email.
8. When it's approved, copy the item's link from the dashboard and send it to staff.

## Switching staff over
Each person:
1. In `chrome://extensions`, click **Remove** on the old (unpacked) FamFitHelper.
2. Open the Web Store link and click **Add to Chrome**.
3. Refresh the CRM tab.

From then on, updates arrive automatically.

## Publishing an update later
1. Bump `"version"` in `chrome-extension/manifest.json` (it must go up every time).
2. Use `FamFitHelper-WebStore-vX.Y.Z.zip` from the GitHub release (or zip the *contents* of `chrome-extension/`).
3. In the developer dashboard, open the item -> **Package** -> **Upload new package**, then **Submit for review**.
4. After approval, everyone's Chrome updates within a few hours.
