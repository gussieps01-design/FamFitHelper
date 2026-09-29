# FamFitHelper

A desktop tool that builds personalized text messages from reusable templates for use with a CRM, then copies the finished message to your clipboard to paste into the CRM's own Send box.

**It never sends anything itself.** It only prepares text for you to review and paste — clicking Send in the CRM always stays a deliberate human action.

## Download

Grab `FamFitHelper.exe` from the [latest release](../../releases/latest) and double-click it. No install, no Python required.

## Features

- Reusable message templates with `{{first_name}}`, `{{staff}}`, `{{location}}`, `{{appointment_date}}` placeholders
- Clipboard auto-detect: copy a name/phone in the CRM and the app picks it up automatically
- Auto-copy the finished message once every placeholder is filled
- Optional auto-paste hotkey (Ctrl+V into whatever window is focused — never clicks Send)
- Cycle through a pasted contact list, or connect directly to a compatible CRM to pull and filter its live customer list (by status, priority, location, staff, idle days, and sign-up date)
- Remembers who's already been texted with an adjustable re-text cooldown
- Always excludes contacts marked Dead, unsubscribed, or with a bounced phone number
- Templates and message history can live in a shared folder (e.g. OneDrive) so multiple computers stay in sync

## Chrome extension (optional, advanced)

`chrome-extension/` has a companion browser extension that pre-fills messages for a whole batch of contacts and auto-advances to the next one **after you click Send yourself** in the CRM - it never clicks Send. See [chrome-extension/README.md](chrome-extension/README.md) for install steps and important limitations (it was built from the CRM's own JS, not tested against a live send - try it on one contact first).

## Running from source

Requires Python 3.10+.

```bash
pip install requests
python app.py
```

## Building the exe yourself

```bash
pip install pyinstaller
pyinstaller --onefile --windowed --name FamFitHelper app.py
```

The built exe will be in `dist/`.
