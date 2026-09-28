"""
FamFitHelper
------------------------
A standalone desktop tool for building personalized text messages from
reusable templates, then copying the finished message to the clipboard
to paste into the CRM's own Send box.

This program never sends anything itself and never talks to the CRM -
it only prepares text on the clipboard for you to review and paste.

To share across multiple work computers, point TEMPLATES_PATH (below,
or via the "Templates file" field in the app) at a shared/synced folder
(e.g. a OneDrive folder) so every computer edits the same templates.json.
"""

import ctypes
import json
import os
import random
import re
import sys
import threading
import tkinter as tk
from datetime import datetime, timedelta
from tkinter import ttk, messagebox, filedialog

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    requests = None
    REQUESTS_AVAILABLE = False

try:
    user32 = ctypes.windll.user32
    HOTKEY_SUPPORTED = True
except AttributeError:
    user32 = None
    HOTKEY_SUPPORTED = False  # not on Windows

VK_CONTROL = 0x11
VK_V = 0x56
KEYEVENTF_KEYUP = 0x2

# Function keys and a few rarely-typed keys, chosen so the hotkey is unlikely
# to collide with normal typing while you're filling in a CRM text field.
HOTKEY_CHOICES = {f"F{i}": 0x70 + (i - 1) for i in range(1, 13)}
HOTKEY_CHOICES.update({"Insert": 0x2D, "Pause": 0x13, "Scroll Lock": 0x91})

HOTKEY_POLL_MS = 80

# Login is against a Devise-based Rails app (/u/sign_in, /u/edit, /u/sign_out).
# Field names below follow Devise's default convention (user[email]/user[password]) -
# this was NOT verified against the real, unauthenticated login form (the browser
# session used to inspect it was already signed in), so it may need adjusting if
# login fails against the real form.
#
# The customer list itself is confirmed: this CRM is a Kendo UI grid whose table
# is filled client-side from a JSON endpoint (customers_grid.json), not from the
# server-rendered /customers HTML - so that JSON endpoint is what's fetched below.
AUTH_TOKEN_RE = re.compile(r'name="authenticity_token"\s+value="([^"]+)"')


class CrmLiveError(Exception):
    pass


def crm_login(base_url, email, password):
    """Log into the CRM with a fresh session using the user's own typed-in
    credentials. The password never leaves this function/process and is
    never written to disk."""
    session = requests.Session()
    login_page = session.get(f"{base_url}/u/sign_in", timeout=15)
    m = AUTH_TOKEN_RE.search(login_page.text)
    token = m.group(1) if m else ""
    session.post(
        f"{base_url}/u/sign_in",
        data={
            "utf8": "✓",
            "authenticity_token": token,
            "user[email]": email,
            "user[password]": password,
            "commit": "Log in",
        },
        timeout=15,
    )
    check = session.get(f"{base_url}/customers_grid.json", params={"take": 1, "skip": 0, "page": 1, "pageSize": 1}, timeout=15)
    if check.status_code != 200 or "data" not in check.text:
        raise CrmLiveError(
            "Login failed. Either the email/password is wrong, or this CRM's login "
            "form uses different field names than expected (user[email]/user[password])."
        )
    return session


PAGE_SIZE = 100


def crm_fetch_customers_page(session, base_url, page):
    """Pull one page of the CRM's own customer grid, straight from its
    Kendo UI JSON data source (customers_grid.json) - the same endpoint the
    CRM's own page uses to fill the table, just called directly."""
    resp = session.get(
        f"{base_url}/customers_grid.json",
        params={"take": PAGE_SIZE, "skip": (page - 1) * PAGE_SIZE, "page": page, "pageSize": PAGE_SIZE},
        timeout=15,
    )
    resp.raise_for_status()
    payload = resp.json()
    return parse_customers_json(payload), payload.get("total", 0)


def days_since(iso_timestamp):
    """Days between now and an ISO-8601 timestamp like the CRM's
    created_at (e.g. '2026-04-26T22:02:55.000-04:00'). None if missing
    or unparseable, so callers can treat that as "can't verify"."""
    if not iso_timestamp:
        return None
    try:
        dt = datetime.fromisoformat(iso_timestamp)
    except ValueError:
        return None
    now = datetime.now(dt.tzinfo) if dt.tzinfo else datetime.now()
    return (now - dt).days


def contact_matches_filters(contact, filters):
    """Client-side filtering, done here rather than via the CRM's own
    server-side filter query params: those use an undocumented Kendo grid
    filter syntax that couldn't be reliably reproduced through the UI, so
    this pulls plain pages and filters them in Python instead - slower for
    a big search, but doesn't depend on guessing that syntax.

    `filters` keys (all optional): status, priority, location, staff (text,
    partial match), idle_min, idle_max (ints, days idle), signed_within_days
    (int - only contacts registered within this many days match)."""
    def text_match(want, have):
        return not want or want.strip().lower() in (have or "").lower()

    if not text_match(filters.get("status"), contact.get("status")):
        return False
    if not text_match(filters.get("priority"), contact.get("priority")):
        return False
    if not text_match(filters.get("location"), contact.get("location")):
        return False
    if not text_match(filters.get("staff"), contact.get("staff")):
        return False

    idle_min = filters.get("idle_min")
    idle_max = filters.get("idle_max")
    if idle_min is not None or idle_max is not None:
        idle = contact.get("idle")
        if not isinstance(idle, (int, float)):
            return False
        if idle_min is not None and idle < idle_min:
            return False
        if idle_max is not None and idle > idle_max:
            return False

    signed_within_days = filters.get("signed_within_days")
    if signed_within_days is not None:
        age_days = days_since(contact.get("created_at"))
        if age_days is None or age_days > signed_within_days:
            return False

    return True


def parse_customers_json(payload):
    contacts = []
    for row in payload.get("data", []):
        name = (row.get("fullname") or "").strip()
        phone = (row.get("phone") or "").strip()
        if not name:
            continue
        contacts.append({
            "full_name": name,
            "phone": phone,
            "staff": (row.get("user") or "").strip(),
            "location": (row.get("location") or "").strip(),
            "status": (row.get("status") or "").strip(),
            "priority": (row.get("priority") or "").strip(),
            "phone_subscription_status": row.get("phone_subscription_status"),
            "idle": row.get("idle"),
            "created_at": row.get("created_at"),
            "copied": False,
        })
    return contacts


# Always excluded, regardless of any filter typed in: contacts marked "Dead"
# priority, or whose phone is bounced/unsubscribed - shown in the CRM's own
# UI as red phone text / a red crossed-out phone icon. Confirmed against the
# CRM's real data: priority "Dead", phone_subscription_status "phone_bounced"
# or "phone_unsubscribed" (valid/good is "phone_active").
BAD_PHONE_SUBSCRIPTION_STATUSES = {"phone_bounced", "phone_unsubscribed"}


def contact_is_auto_excluded(contact):
    if (contact.get("priority") or "").strip().lower() == "dead":
        return True
    if contact.get("phone_subscription_status") in BAD_PHONE_SUBSCRIPTION_STATUSES:
        return True
    return False


# The unread-notifications bell is rendered straight into the page's own HTML
# (a #notifications_dropdown list), not a separate JSON endpoint. Each item
# links to /customers/<id>/customer_messages/new. Some notifications are
# "customer has unsubscribed" alerts, not messages - those are never eligible
# to be texted (they opted out) and are always filtered out here, never
# surfaced as something to reply to.
NOTIF_ITEM_RE = re.compile(
    r'href="(/customers/(\d+)/customer_messages/new[^"]*)"[^>]*>\s*([^<]*?)\s*</a>',
    re.IGNORECASE,
)
NOTIF_REPLY_TEXT_RE = re.compile(r"New text message from customer\.?\s*(.+?)\s*Click to open\.?$", re.IGNORECASE)


def parse_notification_queue_html(html):
    seen_ids = set()
    entries = []
    skipped_unsubscribed = 0
    for _href, cust_id, text in NOTIF_ITEM_RE.findall(html):
        text = text.strip()
        if not text or cust_id in seen_ids:
            continue
        if "unsubscribed" in text.lower():
            skipped_unsubscribed += 1
            seen_ids.add(cust_id)
            continue
        m = NOTIF_REPLY_TEXT_RE.match(text)
        if not m:
            continue  # an unrecognized notification type - skip rather than guess what it means
        seen_ids.add(cust_id)
        entries.append({"customer_id": cust_id, "notification_name": m.group(1).strip()})
    return entries, skipped_unsubscribed


def crm_fetch_customer_detail(session, base_url, customer_id):
    resp = session.get(f"{base_url}/customers/{customer_id}.json", timeout=15)
    resp.raise_for_status()
    row = resp.json()
    return {
        "full_name": (row.get("fullname") or "").strip(),
        "phone": (row.get("phone") or "").strip(),
        "staff": (row.get("user") or "").strip(),
        "location": (row.get("location") or "").strip(),
        "status": (row.get("status") or "").strip(),
        "priority": (row.get("priority") or "").strip(),
        "idle": row.get("idle"),
        "created_at": row.get("created_at"),
        "copied": False,
    }


def crm_fetch_notification_queue(session, base_url, progress_cb=None, cancel_check=None):
    """Pull the CRM's own unread-notifications queue (the bell icon) and
    resolve each into a full contact - this is the CRM's actual highest-
    priority reply queue, not just the general customer list."""
    resp = session.get(f"{base_url}/customers", timeout=15)
    resp.raise_for_status()
    entries, skipped_unsubscribed = parse_notification_queue_html(resp.text)
    contacts = []
    excluded = 0
    for i, entry in enumerate(entries):
        if cancel_check and cancel_check():
            break
        try:
            contact = crm_fetch_customer_detail(session, base_url, entry["customer_id"])
        except Exception:  # noqa: BLE001 - one bad row shouldn't sink the whole queue
            continue
        if not contact["full_name"]:
            contact["full_name"] = entry["notification_name"]
        # Note: the per-customer detail endpoint doesn't expose phone_subscription_status
        # (only the grid endpoint does), so only the "Dead" priority check applies here.
        if contact_is_auto_excluded(contact):
            excluded += 1
        else:
            contacts.append(contact)
        if progress_cb:
            progress_cb(i + 1, len(entries))
    return contacts, skipped_unsubscribed, excluded


def send_ctrl_v():
    """Simulate pressing Ctrl+V on whatever window currently has OS focus.
    Only ever sends paste - never Enter, never a click - so the actual
    Send action in the CRM always stays a deliberate human click."""
    if not HOTKEY_SUPPORTED:
        return
    user32.keybd_event(VK_CONTROL, 0, 0, 0)
    user32.keybd_event(VK_V, 0, 0, 0)
    user32.keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0)
    user32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)

def _app_dir():
    """The folder templates.json/sent_log.json live next to. A PyInstaller
    onefile exe extracts itself into a temp folder at runtime, so __file__
    would silently point there instead of next to the real .exe - using
    sys.executable's folder when frozen keeps saved data next to the exe,
    where the user actually put it, surviving between runs."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


DEFAULT_TEMPLATES_PATH = os.path.join(_app_dir(), "templates.json")

PLACEHOLDER_RE = re.compile(r"\{\{(\w+)\}\}")

KNOWN_FIELDS = ["first_name", "last_name", "staff", "location", "appointment_date"]

# Heuristics used by clipboard auto-detect. A "name" is 2-4 capitalized words
# with no digits; a "phone" is mostly digits/punctuation with 7+ digits.
NAME_RE = re.compile(r"^[A-Z][a-zA-Z'\-]*(\s+[A-Z][a-zA-Z'\-]*){1,3}$")
PHONE_CHARS_RE = re.compile(r"^[\d\-\(\)\s\.\+]{7,20}$")

CLIPBOARD_POLL_MS = 600

# Shipped as the starting library so a bare exe download is immediately
# useful. Written in the casual, first-name, staff-signed voice observed in
# this CRM's own message history (only short fragments of real texts were
# ever visible, never full messages - these are original text written to
# match that same voice, not reproductions of any real message), covering
# the actual status/priority categories the CRM itself uses.
DEFAULT_TEMPLATES = [
    {
        "name": "Trial check-in",
        "text": "Hey {{first_name}}, this is {{staff}} from {{location}}! Just checking in to see how your trial is going so far. Let me know if you have any questions or want to book a time to come back in!",
    },
    {
        "name": "Missed call follow-up",
        "text": "Hi {{first_name}}, this is {{staff}} from {{location}} - sorry I missed your call! What can I help you with? Feel free to call/text back anytime.",
    },
    {
        "name": "Appointment reminder",
        "text": "Hi {{first_name}}, this is {{staff}} from {{location}} confirming your appointment on {{appointment_date}}. Reply YES to confirm or let me know if you need to reschedule!",
    },
    {
        "name": "Re-engagement (cold lead)",
        "text": "Hey {{first_name}}, it's {{staff}} from {{location}}. It's been a bit since we last connected - we'd love to have you back in! Let me know if you're still interested and I can get you set up.",
    },
    {
        "name": "Welcome / new member",
        "text": "Welcome to {{location}}, {{first_name}}! This is {{staff}} - excited to have you as a member. Let me know if you ever have questions, and see you at the gym!",
    },
    {
        "name": "No-show follow-up",
        "text": "Hey {{first_name}}, this is {{staff}} from {{location}} - we missed you at your appointment on {{appointment_date}}! No worries at all, just let me know a better time and I'll get you rebooked.",
    },
    {
        "name": "Free trial pass follow-up",
        "text": "Hi {{first_name}}, this is {{staff}} from {{location}}! Wanted to make sure your free trial pass came through okay - come in anytime and I'll show you around. Any day works!",
    },
    {
        "name": "Post-first-workout check-in",
        "text": "Hey {{first_name}}, {{staff}} here from {{location}} - how'd your first workout go? Let me know if you're feeling sore or have any questions, happy to help!",
    },
    {
        "name": "Membership renewal reminder",
        "text": "Hi {{first_name}}, this is {{staff}} from {{location}}. Just a heads up that your membership is coming up for renewal - let me know if you'd like to go over your options anytime!",
    },
    {
        "name": "Membership expired win-back",
        "text": "Hey {{first_name}}, it's {{staff}} from {{location}}. Noticed your membership lapsed - we'd love to have you back! Let me know if you want to talk through options, no pressure at all.",
    },
    {
        "name": "Referral thank-you",
        "text": "Hi {{first_name}}, this is {{staff}} from {{location}} - thank you so much for referring a friend! We really appreciate it. Let me know if there's ever anything you need.",
    },
    {
        "name": "Birthday message",
        "text": "Happy birthday, {{first_name}}! This is {{staff}} from {{location}} wishing you a great one. Come celebrate with a workout on us if you're free this week!",
    },
    {
        "name": "Billing / payment reminder",
        "text": "Hi {{first_name}}, this is {{staff}} from {{location}}. Looks like there was an issue processing your last payment - could you give us a call or stop by when you get a chance? Thanks!",
    },
    {
        "name": "Collections outreach (friendly)",
        "text": "Hi {{first_name}}, this is {{staff}} from {{location}}. Reaching out about your account balance - totally understand things come up. Let me know what works for you and we'll get it sorted out.",
    },
    {
        "name": "Insurance paperwork follow-up",
        "text": "Hey {{first_name}}, this is {{staff}} from {{location}}. Just following up on the insurance paperwork for your membership - let me know if you have any questions or need help getting it submitted!",
    },
    {
        "name": "Relocating / not local follow-up",
        "text": "Hi {{first_name}}, this is {{staff}} from {{location}}. Heard you might be moving out of the area - wanted to check in on your membership. Happy to help figure out next steps whenever you're ready.",
    },
    {
        "name": "Holiday hours notice",
        "text": "Hi {{first_name}}, this is {{staff}} from {{location}}! Just a heads up that our hours are a little different for the holiday - let us know if you have any questions about the schedule.",
    },
    {
        "name": "New class or program announcement",
        "text": "Hey {{first_name}}, {{staff}} here from {{location}} - we just added a new class we think you'd love! Let me know if you want the schedule or want to try it out.",
    },
    {
        "name": "Long time no see check-in",
        "text": "Hey {{first_name}}, this is {{staff}} from {{location}} - haven't seen you in a bit! Just checking in to see how you're doing and if there's anything we can help with.",
    },
    {
        "name": "Personal training offer",
        "text": "Hi {{first_name}}, this is {{staff}} from {{location}}. Thought you might be interested in a personal training session to help hit your goals faster - want me to set one up for you?",
    },
]


def load_templates(path):
    if not os.path.exists(path):
        try:
            save_templates(path, DEFAULT_TEMPLATES)
        except OSError:
            pass  # read-only location - still usable this session, just won't persist
        return [dict(t) for t in DEFAULT_TEMPLATES]
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("templates", [])


def save_templates(path, templates):
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"templates": templates}, f, indent=2, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Theme: "The Warm Console" - warm off-white/charcoal base with a single
# terracotta accent reserved exclusively for primary actions, so the eye
# always finds the next step instead of everything competing for attention.
# ---------------------------------------------------------------------------
BG = "#FAF7F2"          # warm off-white app background
CARD = "#FFFFFF"        # panel/card surfaces
BORDER = "#E8E1D6"      # warm-toned card/field borders
FG = "#2B2724"          # charcoal text, not pure black
MUTED_FG = "#8A8378"    # warm grey secondary/help text
PRIMARY = "#C6552B"     # terracotta accent - primary actions ONLY
PRIMARY_FG = "#FFFFFF"
PRIMARY_HOVER = "#A8451F"
SECONDARY_BG = "#FFFFFF"
SECONDARY_BORDER = "#C9C0B2"    # warm mid-grey, stays calm next to the accent
SECONDARY_FG = "#2B2724"
SECONDARY_HOVER = "#F3ECE2"
DISABLED_BG = "#EFE9DF"
DISABLED_FG = "#B8AFA0"
FONT_FAMILY = "Segoe UI"


SENT_LOG_FILENAME = "sent_log.json"
PHONE_DIGITS_RE = re.compile(r"\D")


def normalize_phone(phone):
    """Key contacts by their last 10 digits so '(616) 893-3003', '+16168933003',
    and '6168933003' - however a pasted list or the live CRM happens to format
    a number - all land on the same sent-log entry."""
    digits = PHONE_DIGITS_RE.sub("", phone or "")
    return digits[-10:] if len(digits) >= 10 else digits


def sent_log_path_for(templates_path):
    return os.path.join(os.path.dirname(os.path.abspath(templates_path)), SENT_LOG_FILENAME)


def load_sent_log(path):
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f).get("sent", {})


def save_sent_log(path, sent_log):
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"sent": sent_log}, f, indent=2, ensure_ascii=False)


class FamFitHelper(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("FamFitHelper")
        self.minsize(1100, 640)

        self.templates_path = DEFAULT_TEMPLATES_PATH
        self.templates = load_templates(self.templates_path)
        self.sent_log_path = sent_log_path_for(self.templates_path)
        self.sent_log = load_sent_log(self.sent_log_path)
        self.field_vars = {}
        self._last_clipboard = None
        self._hotkey_was_down = False
        self._crm_session = None
        self._crm_base_url = None
        self._crm_page = 1
        self._crm_total = 0
        self._crm_hit_end = False
        self._crm_cancel_requested = False
        self._known_statuses = set()
        self._known_priorities = set()
        self._known_locations = set()
        self._known_staff = set()

        self._apply_theme()
        self._build_ui()
        self._refresh_template_list()
        self._poll_clipboard()
        self._poll_hotkey()

        # Size the window to its natural content width/height rather than a
        # guessed fixed geometry - calling geometry() before the widgets
        # exist locks Tk to that size and content silently clips instead of
        # the window growing to fit. This measures the real requirement once
        # everything is built, then applies it (still freely resizable after).
        # The main content now lives inside a scrolling Canvas (so shrinking
        # the window later doesn't clip anything, just reveals a scrollbar),
        # and a bare Canvas doesn't report its child's size on its own - it
        # has to be told explicitly, or the window would open far too small.
        self.update_idletasks()
        self._body_canvas.configure(
            width=self._body_frame.winfo_reqwidth(), height=self._body_frame.winfo_reqheight()
        )
        self.update_idletasks()
        self.geometry(f"{self.winfo_reqwidth()}x{self.winfo_reqheight()}")

    # ---------- theme: flat monochrome, glass-inspired ----------

    def _apply_theme(self):
        self.configure(bg=BG)
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass  # fall back to whatever theme is available

        base_font = (FONT_FAMILY, 10)
        heading_font = (FONT_FAMILY, 12, "bold")
        section_font = (FONT_FAMILY, 10, "bold")
        muted_font = (FONT_FAMILY, 9)
        self.option_add("*Font", base_font)

        style.configure(".", background=BG, foreground=FG, font=base_font, borderwidth=0)
        style.configure("TFrame", background=BG)
        style.configure("TLabel", background=BG, foreground=FG, font=base_font)
        style.configure("Heading.TLabel", background=BG, foreground=FG, font=heading_font)
        style.configure("Muted.TLabel", background=BG, foreground=MUTED_FG, font=muted_font)
        style.configure("Card.TLabel", background=CARD, foreground=FG, font=base_font)

        style.configure(
            "TLabelframe", background=BG, bordercolor=BORDER, darkcolor=BORDER,
            lightcolor=BORDER, relief="solid", borderwidth=1,
        )
        style.configure(
            "TLabelframe.Label", background=BG, foreground=FG, font=section_font,
        )

        style.configure(
            "TButton", background=SECONDARY_BG, foreground=SECONDARY_FG, font=base_font,
            bordercolor=SECONDARY_BORDER, borderwidth=1, relief="solid", focusthickness=1,
            focuscolor=FG, padding=(10, 6),
        )
        style.map(
            "TButton",
            background=[("disabled", DISABLED_BG), ("pressed", SECONDARY_HOVER), ("active", SECONDARY_HOVER)],
            foreground=[("disabled", DISABLED_FG)],
            bordercolor=[("disabled", BORDER)],
        )

        style.configure(
            "Primary.TButton", background=PRIMARY, foreground=PRIMARY_FG, font=(FONT_FAMILY, 10, "bold"),
            bordercolor=PRIMARY, borderwidth=1, relief="solid", focusthickness=1, focuscolor=PRIMARY_FG,
            padding=(12, 8),
        )
        style.map(
            "Primary.TButton",
            background=[("disabled", DISABLED_BG), ("pressed", PRIMARY_HOVER), ("active", PRIMARY_HOVER)],
            foreground=[("disabled", DISABLED_FG)],
        )

        style.configure(
            "TEntry", fieldbackground=CARD, foreground=FG, bordercolor=BORDER,
            lightcolor=BORDER, darkcolor=BORDER, borderwidth=1, relief="solid", padding=6,
        )
        style.map("TEntry", bordercolor=[("focus", FG)])

        style.configure(
            "TCombobox", fieldbackground=CARD, background=CARD, foreground=FG,
            bordercolor=BORDER, arrowcolor=FG, padding=6,
        )
        style.map("TCombobox", fieldbackground=[("readonly", CARD)], bordercolor=[("focus", FG)])

        style.configure("TCheckbutton", background=BG, foreground=FG, font=base_font)
        style.map("TCheckbutton", background=[("active", BG)])

        style.configure("TNotebook", background=BG, bordercolor=BORDER)
        style.configure("TNotebook.Tab", background=CARD, foreground=FG, padding=(10, 6))
        style.map("TNotebook.Tab", background=[("selected", PRIMARY)], foreground=[("selected", PRIMARY_FG)])

        # A section header that looks/acts like a collapsible toggle, not a button
        style.configure(
            "Toggle.TButton", background=BG, foreground=MUTED_FG, font=(FONT_FAMILY, 10, "bold"),
            borderwidth=0, relief="flat", padding=(0, 4), anchor="w",
        )
        style.map("Toggle.TButton", background=[("active", BG), ("pressed", BG)], foreground=[("active", FG)])

    @staticmethod
    def _make_toggle_button(parent, title):
        """A clickable section-header label used by the pack/grid-specific
        collapse helpers below - starts with no command bound yet."""
        return ttk.Button(parent, style="Toggle.TButton", cursor="hand2")

    def _wire_pack_toggle(self, button, content, title, default_open):
        state = {"open": default_open}

        def render():
            button.config(text=("▾ " if state["open"] else "▸ ") + title)

        def toggle():
            state["open"] = not state["open"]
            (content.pack(fill="x") if state["open"] else content.pack_forget())
            render()

        button.config(command=toggle)
        render()
        if default_open:
            content.pack(fill="x")

    def _wire_grid_toggle(self, button, content, title, default_open):
        state = {"open": default_open}

        def render():
            button.config(text=("▾ " if state["open"] else "▸ ") + title)

        def toggle():
            state["open"] = not state["open"]
            (content.grid() if state["open"] else content.grid_remove())
            render()

        button.config(command=toggle)
        render()
        if not default_open:
            content.grid_remove()

    @staticmethod
    def _short_path(path):
        """.../<parent folder>/<file> - the full path is still shown as a
        tooltip-free hover isn't worth the complexity here; this keeps the
        long Windows path from forcing the whole window wider."""
        parent = os.path.basename(os.path.dirname(path))
        return f".../{parent}/{os.path.basename(path)}" if parent else os.path.basename(path)

    def _style_text_widget(self, widget):
        """Apply the monochrome theme to a plain tk.Text/Listbox, which
        ttk.Style can't reach - a thin border doubles as the focus ring."""
        widget.configure(
            bg=CARD, fg=FG, selectbackground=FG, selectforeground=PRIMARY_FG,
            relief="solid", bd=0, highlightthickness=1, highlightbackground=BORDER, highlightcolor=FG,
            font=(FONT_FAMILY, 10),
        )
        if isinstance(widget, tk.Text):
            widget.configure(insertbackground=FG)

    # ---------- UI construction ----------

    def _build_ui(self):
        header = ttk.Frame(self, padding=(16, 14, 16, 6))
        header.pack(fill="x")
        ttk.Label(header, text="FamFitHelper", style="Heading.TLabel").pack(anchor="w")
        ttk.Label(
            header,
            text="Build a message from a template, then copy it into your CRM's Send box. Nothing is ever sent from here.",
            style="Muted.TLabel",
        ).pack(anchor="w", pady=(2, 0))

        # Settings: collapsed by default so first-time use starts simple -
        # everyday work is picking a template and copying a message, not
        # configuring toggles.
        settings_header = ttk.Frame(self, padding=(16, 4, 16, 0))
        settings_header.pack(fill="x")
        settings_toggle = self._make_toggle_button(settings_header, "Settings")
        settings_toggle.pack(anchor="w")

        settings_content = ttk.Frame(self)

        top = ttk.Frame(settings_content, padding=(16, 8, 16, 4))
        top.pack(fill="x")
        ttk.Label(top, text="Templates file:", style="Muted.TLabel").pack(side="left")
        self.path_label = ttk.Label(top, text=self._short_path(self.templates_path), style="Muted.TLabel")
        self.path_label.pack(side="left", padx=6)
        ttk.Button(top, text="Change / Use shared folder...", command=self._change_templates_path).pack(side="right")

        toggles = ttk.Frame(settings_content, padding=(16, 4, 16, 4))
        toggles.pack(fill="x")
        self.auto_detect_var = tk.BooleanVar(value=True)
        self.auto_copy_var = tk.BooleanVar(value=True)
        self.always_on_top_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(
            toggles, text="Auto-detect name/phone copied from CRM", variable=self.auto_detect_var
        ).pack(side="left")
        ttk.Checkbutton(
            toggles, text="Auto-copy finished message", variable=self.auto_copy_var
        ).pack(side="left", padx=(16, 0))
        ttk.Checkbutton(
            toggles, text="Always on top", variable=self.always_on_top_var, command=self._toggle_always_on_top
        ).pack(side="left", padx=(16, 0))

        hotkey_row = ttk.Frame(settings_content, padding=(16, 0, 16, 8))
        hotkey_row.pack(fill="x")
        self.hotkey_enabled_var = tk.BooleanVar(value=False)
        hotkey_check = ttk.Checkbutton(
            hotkey_row, text="Enable auto-paste hotkey", variable=self.hotkey_enabled_var
        )
        hotkey_check.pack(side="left")
        if not HOTKEY_SUPPORTED:
            hotkey_check.config(state="disabled")
        ttk.Label(hotkey_row, text="Key:", style="Muted.TLabel").pack(side="left", padx=(16, 2))
        self.hotkey_key_var = tk.StringVar(value="F8")
        hotkey_combo = ttk.Combobox(
            hotkey_row, textvariable=self.hotkey_key_var, values=list(HOTKEY_CHOICES.keys()),
            width=10, state="readonly",
        )
        hotkey_combo.pack(side="left")
        note = "Sends Ctrl+V to whatever window is focused (e.g. the CRM message box) - never clicks Send."
        if not HOTKEY_SUPPORTED:
            note = "Auto-paste hotkey needs Windows - not available on this OS."
        ttk.Label(hotkey_row, text=note, style="Muted.TLabel").pack(side="left", padx=(16, 0))

        self._wire_pack_toggle(settings_toggle, settings_content, "Settings", default_open=False)

        ttk.Separator(self, orient="horizontal").pack(fill="x", padx=16, pady=(8, 8))

        # Scrollable wrapper around the main content: when the window is
        # resized smaller than what everything naturally needs (i.e. not
        # maximized), a scrollbar appears instead of content just clipping.
        scroll_area = ttk.Frame(self)
        scroll_area.pack(fill="both", expand=True)
        self._body_canvas = body_canvas = tk.Canvas(scroll_area, bg=BG, highlightthickness=0)
        body_scrollbar = ttk.Scrollbar(scroll_area, orient="vertical", command=body_canvas.yview)
        body_canvas.configure(yscrollcommand=body_scrollbar.set)
        body_canvas.pack(side="left", fill="both", expand=True)
        body_scrollbar.pack(side="right", fill="y")

        self._body_frame = body = ttk.Frame(body_canvas, padding=(16, 0, 16, 16))
        body_window = body_canvas.create_window((0, 0), window=body, anchor="nw")

        def _on_body_resize(event):
            body_canvas.configure(scrollregion=body_canvas.bbox("all"))
        body.bind("<Configure>", _on_body_resize)

        def _on_canvas_resize(event):
            body_canvas.itemconfig(body_window, width=event.width)
        body_canvas.bind("<Configure>", _on_canvas_resize)

        def _on_mousewheel(event):
            body_canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
        body_canvas.bind("<Enter>", lambda e: body_canvas.bind_all("<MouseWheel>", _on_mousewheel))
        body_canvas.bind("<Leave>", lambda e: body_canvas.unbind_all("<MouseWheel>"))

        body.columnconfigure(0, weight=1)
        body.columnconfigure(1, weight=2)
        body.rowconfigure(0, weight=1)

        # Left: template list + editor
        left = ttk.Frame(body)
        left.grid(row=0, column=0, sticky="nsew", padx=(0, 16))
        left.rowconfigure(1, weight=1)
        left.columnconfigure(0, weight=1)

        ttk.Label(left, text="Templates", style="Heading.TLabel").grid(row=0, column=0, sticky="w")
        self.template_list = tk.Listbox(left, exportselection=False)
        self._style_text_widget(self.template_list)
        self.template_list.grid(row=1, column=0, sticky="nsew", pady=(8, 4))
        self.template_list.bind("<<ListboxSelect>>", self._on_template_select)

        list_btns = ttk.Frame(left)
        list_btns.grid(row=2, column=0, sticky="ew", pady=(4, 12))
        ttk.Button(list_btns, text="New", command=self._new_template).pack(side="left")
        ttk.Button(list_btns, text="Delete", command=self._delete_template).pack(side="left", padx=(6, 0))

        ttk.Label(left, text="Template name:", style="Muted.TLabel").grid(row=3, column=0, sticky="w")
        self.name_entry = ttk.Entry(left)
        self.name_entry.grid(row=4, column=0, sticky="ew", pady=(2, 10))

        ttk.Label(
            left, text="Template text (use {{first_name}}, {{staff}}, {{location}}, {{appointment_date}}):",
            style="Muted.TLabel",
        ).grid(row=5, column=0, sticky="w")
        self.template_text = tk.Text(left, height=8, wrap="word")
        self._style_text_widget(self.template_text)
        self.template_text.grid(row=6, column=0, sticky="nsew", pady=(2, 10))
        self.template_text.bind("<KeyRelease>", lambda e: self._update_preview())
        left.rowconfigure(6, weight=1)

        ttk.Button(left, text="Save template", command=self._save_current_template).grid(row=7, column=0, sticky="w")

        # Right: variable fill-in + preview
        right = ttk.Frame(body)
        right.grid(row=0, column=1, sticky="nsew")
        right.columnconfigure(0, weight=1)

        # Live CRM connection: log in with the CRM's own username/password and
        # pull its real customer list directly, instead of pasting one in.
        # Collapsed by default - pasting a list is the simpler everyday path.
        crm_toggle = self._make_toggle_button(right, "Connect to CRM (live, optional)")
        crm_toggle.grid(row=0, column=0, sticky="w", pady=(0, 4))

        live_frame = ttk.LabelFrame(right, padding=12)
        live_frame.grid(row=1, column=0, sticky="ew", pady=(0, 8))
        live_frame.columnconfigure(1, weight=1)
        self._wire_grid_toggle(crm_toggle, live_frame, "Connect to CRM (live, optional)", default_open=False)

        ttk.Label(live_frame, text="CRM URL:").grid(row=0, column=0, sticky="w")
        self.crm_url_var = tk.StringVar(value="https://crm.healthyimagefitness.com")
        ttk.Entry(live_frame, textvariable=self.crm_url_var).grid(row=0, column=1, columnspan=2, sticky="ew", padx=(6, 0))

        ttk.Label(live_frame, text="Email:").grid(row=1, column=0, sticky="w", pady=(4, 0))
        self.crm_email_var = tk.StringVar()
        ttk.Entry(live_frame, textvariable=self.crm_email_var).grid(row=1, column=1, columnspan=2, sticky="ew", padx=(6, 0), pady=(4, 0))

        ttk.Label(live_frame, text="Password:").grid(row=2, column=0, sticky="w", pady=(4, 0))
        self.crm_password_var = tk.StringVar()
        ttk.Entry(live_frame, textvariable=self.crm_password_var, show="*").grid(
            row=2, column=1, columnspan=2, sticky="ew", padx=(6, 0), pady=(4, 0)
        )

        ttk.Label(live_frame, text="Filter by (optional, exact match not required):").grid(
            row=3, column=0, columnspan=3, sticky="w", pady=(8, 2)
        )
        filt = ttk.Frame(live_frame)
        filt.grid(row=4, column=0, columnspan=3, sticky="ew")
        for c in (1, 3):
            filt.columnconfigure(c, weight=1)
        self.filter_status_var = tk.StringVar()
        self.filter_priority_var = tk.StringVar()
        self.filter_location_var = tk.StringVar()
        self.filter_staff_var = tk.StringVar()
        # Comboboxes, not readonly - start empty (nothing to choose from until
        # connected) and fill in with the real values seen in the CRM's own
        # data as pages load. Still editable/clearable by hand at any time.
        ttk.Label(filt, text="Status:").grid(row=0, column=0, sticky="w")
        self.filter_status_combo = ttk.Combobox(filt, textvariable=self.filter_status_var, values=())
        self.filter_status_combo.grid(row=0, column=1, sticky="ew", padx=(4, 10))
        ttk.Label(filt, text="Priority:").grid(row=0, column=2, sticky="w")
        self.filter_priority_combo = ttk.Combobox(filt, textvariable=self.filter_priority_var, values=())
        self.filter_priority_combo.grid(row=0, column=3, sticky="ew", padx=(4, 0))
        ttk.Label(filt, text="Location:").grid(row=1, column=0, sticky="w", pady=(4, 0))
        self.filter_location_combo = ttk.Combobox(filt, textvariable=self.filter_location_var, values=())
        self.filter_location_combo.grid(row=1, column=1, sticky="ew", padx=(4, 10), pady=(4, 0))
        ttk.Label(filt, text="Staff:").grid(row=1, column=2, sticky="w", pady=(4, 0))
        self.filter_staff_combo = ttk.Combobox(filt, textvariable=self.filter_staff_var, values=())
        self.filter_staff_combo.grid(row=1, column=3, sticky="ew", padx=(4, 0), pady=(4, 0))

        age_row = ttk.Frame(live_frame)
        age_row.grid(row=5, column=0, columnspan=3, sticky="ew", pady=(6, 0))
        ttk.Label(age_row, text="Idle days:", style="Muted.TLabel").pack(side="left")
        self.filter_idle_min_var = tk.StringVar()
        ttk.Entry(age_row, textvariable=self.filter_idle_min_var, width=5).pack(side="left", padx=(4, 2))
        ttk.Label(age_row, text="to", style="Muted.TLabel").pack(side="left")
        self.filter_idle_max_var = tk.StringVar()
        ttk.Entry(age_row, textvariable=self.filter_idle_max_var, width=5).pack(side="left", padx=(2, 16))
        ttk.Label(age_row, text="Signed up within last", style="Muted.TLabel").pack(side="left")
        self.filter_signed_within_var = tk.StringVar()
        ttk.Entry(age_row, textvariable=self.filter_signed_within_var, width=5).pack(side="left", padx=(4, 4))
        self.filter_signed_unit_var = tk.StringVar(value="days")
        ttk.Combobox(
            age_row, textvariable=self.filter_signed_unit_var, values=["days", "months"],
            width=7, state="readonly",
        ).pack(side="left")

        ttk.Label(live_frame, text="Search up to this many pages (100/page):").grid(
            row=6, column=0, columnspan=2, sticky="w", pady=(6, 0)
        )
        self.filter_max_pages_var = tk.StringVar(value="10")
        ttk.Entry(live_frame, textvariable=self.filter_max_pages_var, width=6).grid(
            row=6, column=2, sticky="w", pady=(6, 0)
        )

        live_btns = ttk.Frame(live_frame)
        live_btns.grid(row=7, column=0, columnspan=3, sticky="w", pady=(6, 0))
        self.crm_login_btn = ttk.Button(
            live_btns, text="Log in & load matching customers", command=self._start_crm_login, style="Primary.TButton"
        )
        self.crm_login_btn.pack(side="left")
        self.crm_next_page_btn = ttk.Button(live_btns, text="Search more pages", command=self._start_load_next_page, state="disabled")
        self.crm_next_page_btn.pack(side="left", padx=(6, 0))
        self.crm_cancel_btn = ttk.Button(live_btns, text="Cancel search", command=self._cancel_crm_search, state="disabled")
        self.crm_cancel_btn.pack(side="left", padx=(6, 0))

        notif_btns = ttk.Frame(live_frame)
        notif_btns.grid(row=8, column=0, columnspan=3, sticky="w", pady=(4, 0))
        self.crm_notif_btn = ttk.Button(
            notif_btns, text="Load unread notifications (needs reply)", command=self._start_load_notifications,
            style="Primary.TButton",
        )
        self.crm_notif_btn.pack(side="left")
        if not REQUESTS_AVAILABLE:
            self.crm_notif_btn.config(state="disabled")

        self.crm_status_label = ttk.Label(live_frame, text="", foreground="#a33")
        self.crm_status_label.grid(row=9, column=0, columnspan=3, sticky="w", pady=(4, 0))
        if not REQUESTS_AVAILABLE:
            self.crm_login_btn.config(state="disabled")
            self.crm_status_label.config(text="Needs: pip install requests")

        ttk.Label(
            live_frame,
            text="Password stays in memory only for this session - never written to disk. Login field\n"
                 "names are a best-effort guess (Devise convention). Filtering happens here in the app,\n"
                 "not on the CRM server, by paging through and keeping only matching rows - leave all\n"
                 "filter fields blank to just load the plain list, unfiltered. Always auto-excluded, no\n"
                 "matter what: contacts marked Dead, unsubscribed, or with a bounced phone (the CRM's own\n"
                 "red text / red crossed-out phone icon) - these are never loaded as something to text.",
            style="Muted.TLabel",
            justify="left",
        ).grid(row=10, column=0, columnspan=3, sticky="w", pady=(4, 0))

        # Contact queue: cycle through the loaded list (pasted or pulled live), one message at a time
        queue_frame = ttk.LabelFrame(right, text="Contact list", padding=12)
        queue_frame.grid(row=2, column=0, sticky="ew", pady=(0, 8))
        queue_frame.columnconfigure(1, weight=1)

        ttk.Button(queue_frame, text="Load list...", command=self._open_load_list_dialog).grid(row=0, column=0, sticky="w")
        self.queue_position_label = ttk.Label(queue_frame, text="No list loaded")
        self.queue_position_label.grid(row=0, column=1, sticky="w", padx=(8, 0))

        self.random_order_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(
            queue_frame, text="Random order", variable=self.random_order_var
        ).grid(row=0, column=2, sticky="e", padx=(8, 0))

        nav = ttk.Frame(queue_frame)
        nav.grid(row=1, column=0, columnspan=3, sticky="w", pady=(6, 0))
        self.first_btn = ttk.Button(nav, text="|< First", command=self._go_to_first, state="disabled")
        self.first_btn.pack(side="left")
        self.prev_btn = ttk.Button(nav, text="< Prev", command=self._prev_contact, state="disabled")
        self.prev_btn.pack(side="left", padx=(6, 0))
        self.next_btn = ttk.Button(nav, text="Next >", command=self._next_contact, state="disabled")
        self.next_btn.pack(side="left", padx=(6, 0))
        self.copy_next_btn = ttk.Button(
            nav, text="Copy & Next", command=self._copy_and_next, state="disabled", style="Primary.TButton"
        )
        self.copy_next_btn.pack(side="left", padx=(12, 0))

        nav_advanced = ttk.Frame(queue_frame)
        nav_advanced.grid(row=2, column=0, columnspan=3, sticky="w", pady=(6, 0))
        self.shuffle_btn = ttk.Button(nav_advanced, text="Reshuffle remaining", command=self._reshuffle_remaining, state="disabled")
        self.shuffle_btn.pack(side="left")
        self.sequential_btn = ttk.Button(
            nav_advanced, text="Go straight down the list (top to bottom)", command=self._reset_to_sequential, state="disabled"
        )
        self.sequential_btn.pack(side="left", padx=(8, 0))

        retext_row = ttk.Frame(queue_frame)
        retext_row.grid(row=3, column=0, columnspan=3, sticky="w", pady=(10, 0))
        self.skip_recently_texted_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(
            retext_row, text="Skip contacts already texted within", variable=self.skip_recently_texted_var
        ).pack(side="left")
        self.retext_days_var = tk.StringVar(value="7")
        ttk.Entry(retext_row, textvariable=self.retext_days_var, width=4).pack(side="left", padx=(4, 4))
        ttk.Label(retext_row, text="day(s), when loading a list", style="Muted.TLabel").pack(side="left")

        self.last_texted_label = ttk.Label(queue_frame, text="", style="Muted.TLabel")
        self.last_texted_label.grid(row=4, column=0, columnspan=3, sticky="w", pady=(6, 0))

        # Quick paste: full name from CRM auto-splits into first/last name
        paste_row = ttk.Frame(right)
        paste_row.grid(row=3, column=0, sticky="ew", pady=(0, 6))
        paste_row.columnconfigure(1, weight=1)
        ttk.Label(paste_row, text="Paste full name from CRM:", style="Muted.TLabel").grid(row=0, column=0, sticky="w")
        self.full_name_var = tk.StringVar()
        self.full_name_var.trace_add("write", lambda *_: self._on_full_name_change())
        ttk.Entry(paste_row, textvariable=self.full_name_var).grid(row=0, column=1, sticky="ew", padx=(6, 0))

        # Phone number: kept separate from message placeholders, own copy button
        phone_row = ttk.Frame(right)
        phone_row.grid(row=4, column=0, sticky="ew", pady=(0, 10))
        phone_row.columnconfigure(1, weight=1)
        ttk.Label(phone_row, text="Phone number:").grid(row=0, column=0, sticky="w")
        self.phone_var = tk.StringVar()
        ttk.Entry(phone_row, textvariable=self.phone_var).grid(row=0, column=1, sticky="ew", padx=(6, 6))
        ttk.Button(phone_row, text="Copy phone number", command=self._copy_phone).grid(row=0, column=2, sticky="e")

        ttk.Label(right, text="Fill in this message", font=("Segoe UI", 10, "bold")).grid(row=5, column=0, sticky="w", pady=(0, 6))

        self.fields_frame = ttk.Frame(right)
        self.fields_frame.grid(row=6, column=0, sticky="ew")
        self.fields_frame.columnconfigure(1, weight=1)
        self._build_field_inputs()

        ttk.Label(right, text="Preview:", style="Heading.TLabel").grid(row=7, column=0, sticky="w", pady=(14, 4))
        self.preview_text = tk.Text(right, height=8, wrap="word")
        self._style_text_widget(self.preview_text)
        self.preview_text.grid(row=8, column=0, sticky="nsew")
        right.rowconfigure(8, weight=1)

        actions = ttk.Frame(right)
        actions.grid(row=9, column=0, sticky="ew", pady=10)
        ttk.Button(
            actions, text="Copy message to clipboard", command=self._copy_to_clipboard, style="Primary.TButton"
        ).pack(side="left")
        self.status_label = ttk.Label(actions, text="", foreground="#2a7a2a")
        self.status_label.pack(side="left", padx=12)

        ttk.Label(
            right,
            text="This never sends anything. Copy the message, then paste and review it\n"
                 "in the CRM's own Send box before clicking Send there.",
            style="Muted.TLabel",
            justify="left",
        ).grid(row=10, column=0, sticky="w", pady=(4, 0))

        self.contact_queue = []
        self._original_order = []
        self.queue_index = -1

    def _build_field_inputs(self):
        for child in self.fields_frame.winfo_children():
            child.destroy()
        self.field_vars = {}
        for i, field in enumerate(KNOWN_FIELDS):
            ttk.Label(self.fields_frame, text=field.replace("_", " ").title() + ":").grid(row=i, column=0, sticky="w", pady=2)
            var = tk.StringVar()
            var.trace_add("write", lambda *_: self._update_preview())
            entry = ttk.Entry(self.fields_frame, textvariable=var)
            entry.grid(row=i, column=1, sticky="ew", padx=(6, 0), pady=2)
            self.field_vars[field] = var

    # ---------- template list handling ----------

    def _refresh_template_list(self):
        self.template_list.delete(0, "end")
        for t in self.templates:
            self.template_list.insert("end", t["name"])
        if self.templates:
            self.template_list.selection_set(0)
            self._on_template_select()

    def _on_template_select(self, event=None):
        sel = self.template_list.curselection()
        if not sel:
            return
        t = self.templates[sel[0]]
        self.name_entry.delete(0, "end")
        self.name_entry.insert(0, t["name"])
        self.template_text.delete("1.0", "end")
        self.template_text.insert("1.0", t["text"])
        self._update_preview()

    def _new_template(self):
        self.templates.append({"name": "New template", "text": "Hey {{first_name}}, ..."})
        save_templates(self.templates_path, self.templates)
        self._refresh_template_list()
        self.template_list.selection_clear(0, "end")
        self.template_list.selection_set(len(self.templates) - 1)
        self._on_template_select()

    def _delete_template(self):
        sel = self.template_list.curselection()
        if not sel:
            return
        t = self.templates[sel[0]]
        if not messagebox.askyesno("Delete template", f"Delete template '{t['name']}'?"):
            return
        del self.templates[sel[0]]
        save_templates(self.templates_path, self.templates)
        self._refresh_template_list()

    def _save_current_template(self):
        sel = self.template_list.curselection()
        name = self.name_entry.get().strip()
        text = self.template_text.get("1.0", "end").rstrip("\n")
        if not name:
            messagebox.showwarning("Missing name", "Please enter a template name.")
            return
        if sel:
            self.templates[sel[0]] = {"name": name, "text": text}
        else:
            self.templates.append({"name": name, "text": text})
        save_templates(self.templates_path, self.templates)
        self._refresh_template_list()
        self.status_label.config(text="Template saved.")
        self.after(2000, lambda: self.status_label.config(text=""))

    # ---------- preview / clipboard ----------

    def _current_template_text(self):
        return self.template_text.get("1.0", "end").rstrip("\n")

    def _update_preview(self):
        text = self._current_template_text()
        values = {k: v.get() for k, v in self.field_vars.items()}

        def replace(m):
            key = m.group(1)
            return values.get(key, "") or f"{{{{{key}}}}}"

        rendered = PLACEHOLDER_RE.sub(replace, text)
        self.preview_text.delete("1.0", "end")
        self.preview_text.insert("1.0", rendered)

        is_complete = rendered.strip() and not PLACEHOLDER_RE.search(rendered)
        if is_complete and self.auto_copy_var.get():
            self.clipboard_clear()
            self.clipboard_append(rendered)
            self._last_clipboard = rendered
            self.status_label.config(text="Auto-copied - ready to paste into the CRM.")

    def _toggle_always_on_top(self):
        self.attributes("-topmost", self.always_on_top_var.get())

    def _poll_clipboard(self):
        if self.auto_detect_var.get():
            try:
                content = self.clipboard_get()
            except tk.TclError:
                content = None
            if content is not None and content != self._last_clipboard:
                self._last_clipboard = content
                candidate = content.strip()
                if PHONE_CHARS_RE.match(candidate) and sum(c.isdigit() for c in candidate) >= 7:
                    self.phone_var.set(candidate)
                    self.status_label.config(text="Detected phone number from clipboard.")
                    self.after(3000, lambda: self.status_label.config(text=""))
                elif NAME_RE.match(candidate):
                    self.full_name_var.set(candidate)
                    self.status_label.config(text="Detected name from clipboard.")
                    self.after(3000, lambda: self.status_label.config(text=""))
        self.after(CLIPBOARD_POLL_MS, self._poll_clipboard)

    def _poll_hotkey(self):
        if HOTKEY_SUPPORTED and self.hotkey_enabled_var.get():
            vk = HOTKEY_CHOICES.get(self.hotkey_key_var.get())
            is_down = bool(user32.GetAsyncKeyState(vk) & 0x8000) if vk else False
            if is_down and not self._hotkey_was_down:
                self._trigger_auto_paste()
            self._hotkey_was_down = is_down
        else:
            self._hotkey_was_down = False
        self.after(HOTKEY_POLL_MS, self._poll_hotkey)

    def _trigger_auto_paste(self):
        rendered = self.preview_text.get("1.0", "end").rstrip("\n")
        if not rendered.strip() or PLACEHOLDER_RE.search(rendered):
            self.status_label.config(text="Hotkey ignored - message isn't finished (placeholders still blank).")
            self.after(3000, lambda: self.status_label.config(text=""))
            return
        self.clipboard_clear()
        self.clipboard_append(rendered)
        self._last_clipboard = rendered
        send_ctrl_v()
        self._record_sent(self.phone_var.get())
        if self.contact_queue:
            self.contact_queue[self.queue_index]["copied"] = True
            if self.queue_index < len(self.contact_queue) - 1:
                self._next_contact()
            else:
                self._update_queue_position_label()
        self.status_label.config(text=f"Auto-pasted via {self.hotkey_key_var.get()} - review, then click Send in the CRM.")
        self.after(4000, lambda: self.status_label.config(text=""))

    def _on_full_name_change(self):
        full_name = self.full_name_var.get().strip()
        parts = full_name.split()
        first = parts[0] if parts else ""
        last = " ".join(parts[1:]) if len(parts) > 1 else ""
        if "first_name" in self.field_vars:
            self.field_vars["first_name"].set(first)
        if "last_name" in self.field_vars:
            self.field_vars["last_name"].set(last)

    def _copy_phone(self):
        phone = self.phone_var.get().strip()
        if not phone:
            return
        self.clipboard_clear()
        self.clipboard_append(phone)
        self._last_clipboard = phone
        self.status_label.config(text="Phone number copied.")
        self.after(3000, lambda: self.status_label.config(text=""))

    def _copy_to_clipboard(self):
        rendered = self.preview_text.get("1.0", "end").rstrip("\n")
        if not rendered.strip():
            return
        self.clipboard_clear()
        self.clipboard_append(rendered)
        self._last_clipboard = rendered
        self._record_sent(self.phone_var.get())
        self.status_label.config(text="Copied! Paste it into the CRM and review before sending.")
        self.after(4000, lambda: self.status_label.config(text=""))

    # ---------- shared templates file ----------

    def _change_templates_path(self):
        path = filedialog.askopenfilename(
            title="Choose templates.json (e.g. in a OneDrive-synced folder)",
            filetypes=[("JSON files", "*.json")],
            initialfile="templates.json",
        )
        if not path:
            return
        if not os.path.exists(path):
            # allow creating a new shared file
            save_templates(path, self.templates)
        self.templates_path = path
        self.path_label.config(text=self._short_path(path))
        self.templates = load_templates(self.templates_path)
        self._refresh_template_list()
        self.sent_log_path = sent_log_path_for(self.templates_path)
        self.sent_log = load_sent_log(self.sent_log_path)


    # ---------- live CRM connection ----------

    def _update_filter_choices(self, contacts):
        """Fill the Status/Priority/Location/Staff dropdowns with the real
        values seen in the CRM's own data, accumulating across every page
        loaded this session rather than resetting on each call."""
        for c in contacts:
            if c.get("status"):
                self._known_statuses.add(c["status"])
            if c.get("priority"):
                self._known_priorities.add(c["priority"])
            if c.get("location"):
                self._known_locations.add(c["location"])
            if c.get("staff"):
                self._known_staff.add(c["staff"])
        self.filter_status_combo.config(values=sorted(self._known_statuses))
        self.filter_priority_combo.config(values=sorted(self._known_priorities))
        self.filter_location_combo.config(values=sorted(self._known_locations))
        self.filter_staff_combo.config(values=sorted(self._known_staff))

    @staticmethod
    def _parse_optional_int(text):
        text = (text or "").strip()
        if not text:
            return None
        try:
            return int(text)
        except ValueError:
            return None

    def _current_filters(self):
        signed_within = self._parse_optional_int(self.filter_signed_within_var.get())
        if signed_within is not None and self.filter_signed_unit_var.get() == "months":
            signed_within *= 30  # approximate - a calendar month has no fixed day count
        return {
            "status": self.filter_status_var.get(),
            "priority": self.filter_priority_var.get(),
            "location": self.filter_location_var.get(),
            "staff": self.filter_staff_var.get(),
            "idle_min": self._parse_optional_int(self.filter_idle_min_var.get()),
            "idle_max": self._parse_optional_int(self.filter_idle_max_var.get()),
            "signed_within_days": signed_within,
        }

    def _current_max_pages(self):
        try:
            return max(1, int(self.filter_max_pages_var.get()))
        except ValueError:
            return 10

    # ---------- sent-log: remembering who's been texted, and when they're due again ----------

    def _retext_cooldown_days(self):
        try:
            return max(0, int(self.retext_days_var.get()))
        except ValueError:
            return 7

    def _last_sent_at(self, phone):
        key = normalize_phone(phone)
        if not key:
            return None
        iso = self.sent_log.get(key)
        if not iso:
            return None
        try:
            return datetime.fromisoformat(iso)
        except ValueError:
            return None

    def _is_recently_texted(self, phone):
        last_sent = self._last_sent_at(phone)
        if last_sent is None:
            return False
        return datetime.now() - last_sent < timedelta(days=self._retext_cooldown_days())

    def _record_sent(self, phone):
        key = normalize_phone(phone)
        if not key:
            return
        self.sent_log[key] = datetime.now().isoformat(timespec="seconds")
        try:
            save_sent_log(self.sent_log_path, self.sent_log)
        except OSError:
            pass  # in-memory record still applies for the rest of this session

    def _filter_out_recently_texted(self, contacts):
        """Used when loading a list, if the skip toggle is on. Returns
        (kept, skipped_count)."""
        if not self.skip_recently_texted_var.get():
            return contacts, 0
        kept = [c for c in contacts if not self._is_recently_texted(c.get("phone"))]
        return kept, len(contacts) - len(kept)

    def _update_last_texted_label(self, phone):
        last_sent = self._last_sent_at(phone)
        if last_sent is None:
            self.last_texted_label.config(text="Not texted before (per this app's local log).")
            return
        days_ago = (datetime.now() - last_sent).days
        when = "today" if days_ago <= 0 else ("1 day ago" if days_ago == 1 else f"{days_ago} days ago")
        cooldown = self._retext_cooldown_days()
        note = " - within your re-text cooldown" if self._is_recently_texted(phone) else " - past cooldown, OK to re-text"
        self.last_texted_label.config(text=f"Last texted {when} (cooldown: {cooldown}d){note}")

    def _start_crm_login(self):
        if not REQUESTS_AVAILABLE:
            return
        base_url = self.crm_url_var.get().strip().rstrip("/")
        email = self.crm_email_var.get().strip()
        password = self.crm_password_var.get()
        if not base_url or not email or not password:
            messagebox.showwarning("Missing info", "Please fill in CRM URL, email, and password.")
            return
        filters = self._current_filters()
        max_pages = self._current_max_pages()
        self._crm_cancel_requested = False
        self.crm_login_btn.config(state="disabled")
        self.crm_cancel_btn.config(state="normal")
        self.crm_status_label.config(text="Logging in...", foreground="#555")

        def worker():
            try:
                session = crm_login(base_url, email, password)
                matches, last_page, total, hit_end, cancelled, excluded = self._search_pages(session, base_url, 1, max_pages, filters)
            except Exception as e:  # noqa: BLE001 - surfaced to the user, not swallowed
                self.after(0, lambda: self._on_crm_error(e))
                return
            self.after(0, lambda: self._on_crm_login_success(session, base_url, matches, last_page, total, hit_end, cancelled, excluded))

        threading.Thread(target=worker, daemon=True).start()

    def _cancel_crm_search(self):
        self._crm_cancel_requested = True
        self.crm_cancel_btn.config(state="disabled")

    def _search_pages(self, session, base_url, start_page, max_pages, filters):
        """Fetch pages start_page..start_page+max_pages-1, keeping only rows
        that match the given filters. Stops early if a page comes back empty
        (end of the CRM's list) or if the search is cancelled. Posts a live
        progress update to the status label after every page, since a filtered
        search can take a while with no other feedback otherwise."""
        matches = []
        total = 0
        page = start_page
        hit_end = False
        cancelled = False
        excluded = 0
        for i in range(max_pages):
            if self._crm_cancel_requested:
                cancelled = True
                break
            contacts, total = crm_fetch_customers_page(session, base_url, page)
            if not contacts:
                hit_end = True
                break
            # Update the filter dropdowns from every raw row seen (before any
            # filtering/exclusion), not just what matched - schedule on the
            # main thread since this runs in a background worker.
            self.after(0, lambda c=list(contacts): self._update_filter_choices(c))
            for c in contacts:
                if contact_is_auto_excluded(c):
                    excluded += 1
                    continue
                if contact_matches_filters(c, filters):
                    matches.append(c)
            pages_done = i + 1
            self.after(0, lambda pd=pages_done, mp=max_pages, m=len(matches), t=total: self.crm_status_label.config(
                text=f"Searching... page {pd} of {mp} checked ({m} matches so far, {t} total in CRM).",
                foreground="#555",
            ))
            page += 1
        return matches, page - 1, total, hit_end, cancelled, excluded

    def _on_crm_error(self, error):
        self.crm_login_btn.config(state="normal")
        self.crm_cancel_btn.config(state="disabled")
        self.crm_notif_btn.config(state="normal" if REQUESTS_AVAILABLE else "disabled")
        self.crm_next_page_btn.config(state="normal" if self._crm_session else "disabled")
        self.crm_status_label.config(text=f"Failed: {error}", foreground="#a33")

    def _on_crm_login_success(self, session, base_url, matches, last_page, total, hit_end, cancelled, excluded):
        self.crm_login_btn.config(state="normal")
        self.crm_cancel_btn.config(state="disabled")
        self._crm_session = session
        self._crm_base_url = base_url
        self._crm_page = last_page
        self._crm_total = total
        self._crm_hit_end = hit_end
        stopped_note = " (search cancelled)" if cancelled else ""
        excluded_note = f" ({excluded} Dead/bounced/unsubscribed auto-excluded)" if excluded else ""
        if not matches:
            self.crm_status_label.config(
                text=f"Logged in and searched {last_page} page(s) of {total} total contacts{stopped_note}"
                     f"{excluded_note}, but found no matches for that filter. Try 'Search more pages', "
                     "loosen the filter, or leave it blank to load everything.",
                foreground="#a33",
            )
            self.crm_next_page_btn.config(state="disabled" if hit_end else "normal")
            return
        matches, skipped = self._filter_out_recently_texted(matches)
        skipped_note = f" ({skipped} already-texted skipped)" if skipped else ""
        if not matches:
            self.crm_status_label.config(
                text=f"Found matches but all {skipped} were texted within your re-text cooldown"
                     f"{stopped_note}{excluded_note}. Try 'Search more pages' or uncheck the skip option.",
                foreground="#a33",
            )
            self.crm_next_page_btn.config(state="disabled" if hit_end else "normal")
            return
        self.crm_status_label.config(
            text=f"Loaded {len(matches)} matching contacts (searched {last_page} page(s) of {total} total)"
                 f"{stopped_note}{skipped_note}{excluded_note}.",
            foreground="#2a7a2a",
        )
        self._original_order = matches
        self.contact_queue = list(matches)
        if self.random_order_var.get():
            random.shuffle(self.contact_queue)
        self.queue_index = 0
        self._goto_contact(0)
        self.crm_next_page_btn.config(state="disabled" if hit_end else "normal")

    def _start_load_next_page(self):
        if not self._crm_session:
            return
        filters = self._current_filters()
        max_pages = self._current_max_pages()
        start_page = self._crm_page + 1
        self._crm_cancel_requested = False
        self.crm_next_page_btn.config(state="disabled")
        self.crm_cancel_btn.config(state="normal")
        self.crm_status_label.config(text=f"Searching pages {start_page}-{start_page + max_pages - 1}...", foreground="#555")

        def worker():
            try:
                matches, last_page, total, hit_end, cancelled, excluded = self._search_pages(
                    self._crm_session, self._crm_base_url, start_page, max_pages, filters
                )
            except Exception as e:  # noqa: BLE001
                self.after(0, lambda: self._on_crm_error(e))
                return
            self.after(0, lambda: self._on_next_page_loaded(last_page, matches, total, hit_end, cancelled, excluded))

        threading.Thread(target=worker, daemon=True).start()

    def _on_next_page_loaded(self, last_page, matches, total, hit_end, cancelled, excluded):
        self._crm_page = last_page
        self._crm_total = total
        self._crm_hit_end = hit_end
        self.crm_cancel_btn.config(state="disabled")
        self.crm_next_page_btn.config(state="disabled" if hit_end else "normal")
        stopped_note = " (search cancelled)" if cancelled else ""
        excluded_note = f" ({excluded} Dead/bounced/unsubscribed auto-excluded)" if excluded else ""
        if not matches:
            reason = "reached the end of the CRM's list" if hit_end else "no more matches found in that range"
            self.crm_status_label.config(
                text=f"Searched up to page {last_page} of {total} total - {reason}{stopped_note}{excluded_note}.",
                foreground="#2a7a2a",
            )
            return
        matches, skipped = self._filter_out_recently_texted(matches)
        skipped_note = f" ({skipped} already-texted skipped)" if skipped else ""
        if not matches:
            self.crm_status_label.config(
                text=f"Found matches through page {last_page}, but all were texted within your "
                     f"re-text cooldown{skipped_note}{stopped_note}{excluded_note}.",
                foreground="#2a7a2a",
            )
            return
        self._original_order.extend(matches)
        self.contact_queue.extend(matches)
        self._update_queue_position_label()
        self.crm_status_label.config(
            text=f"Found {len(matches)} more matches through page {last_page}{stopped_note}{skipped_note}"
                 f"{excluded_note} ({len(self.contact_queue)} loaded so far, {total} total in the CRM).",
            foreground="#2a7a2a",
        )

    def _start_load_notifications(self):
        if not REQUESTS_AVAILABLE:
            return
        base_url = self.crm_url_var.get().strip().rstrip("/")
        session = self._crm_session
        email = self.crm_email_var.get().strip()
        password = self.crm_password_var.get()
        if session is None and (not base_url or not email or not password):
            messagebox.showwarning("Missing info", "Please fill in CRM URL, email, and password (or log in first above).")
            return
        self._crm_cancel_requested = False
        self.crm_notif_btn.config(state="disabled")
        self.crm_cancel_btn.config(state="normal")
        self.crm_status_label.config(text="Loading unread notifications...", foreground="#555")

        def worker():
            nonlocal session
            try:
                if session is None:
                    session = crm_login(base_url, email, password)

                def progress(done, total_n):
                    self.after(0, lambda: self.crm_status_label.config(
                        text=f"Resolving notification {done} of {total_n}...", foreground="#555"
                    ))

                contacts, skipped_unsub, excluded = crm_fetch_notification_queue(
                    session, base_url, progress_cb=progress, cancel_check=lambda: self._crm_cancel_requested
                )
            except Exception as e:  # noqa: BLE001
                self.after(0, lambda: self._on_crm_error(e))
                return
            self.after(0, lambda: self._on_notifications_loaded(session, base_url, contacts, skipped_unsub, excluded))

        threading.Thread(target=worker, daemon=True).start()

    def _on_notifications_loaded(self, session, base_url, contacts, skipped_unsub, excluded):
        self.crm_notif_btn.config(state="normal")
        self.crm_cancel_btn.config(state="disabled")
        self._crm_session = session
        self._crm_base_url = base_url
        self._update_filter_choices(contacts)
        unsub_note = f" ({skipped_unsub} unsubscribed customers excluded automatically)" if skipped_unsub else ""
        excluded_note = f" ({excluded} marked Dead excluded)" if excluded else ""
        if not contacts:
            self.crm_status_label.config(
                text=f"No unread 'reply needed' notifications found{unsub_note}{excluded_note}.", foreground="#2a7a2a"
            )
            return
        contacts, skipped_recent = self._filter_out_recently_texted(contacts)
        recent_note = f" ({skipped_recent} already-texted-recently skipped)" if skipped_recent else ""
        if not contacts:
            self.crm_status_label.config(
                text=f"Found notifications, but all were texted within your re-text cooldown"
                     f"{recent_note}{unsub_note}{excluded_note}.",
                foreground="#2a7a2a",
            )
            return
        self.crm_status_label.config(
            text=f"Loaded {len(contacts)} contacts needing a reply{unsub_note}{excluded_note}{recent_note}.",
            foreground="#2a7a2a",
        )
        self._original_order = contacts
        self.contact_queue = list(contacts)
        if self.random_order_var.get():
            random.shuffle(self.contact_queue)
        self.queue_index = 0
        self._goto_contact(0)

    # ---------- contact queue (cycle through a pasted or live-loaded list) ----------

    def _open_load_list_dialog(self):
        dialog = tk.Toplevel(self)
        dialog.title("Load contact list")
        dialog.geometry("480x360")
        dialog.configure(bg=BG)
        dialog.transient(self)

        ttk.Label(
            dialog,
            text="Paste one contact per line. Each line can be just a name,\n"
                 "or \"Name<TAB>Phone\" / \"Name, Phone\" (e.g. copied from the CRM table).\n"
                 "This list is kept in memory only - never saved to disk.",
            style="Muted.TLabel",
            justify="left",
        ).pack(fill="x", padx=12, pady=12)

        text = tk.Text(dialog, wrap="word")
        self._style_text_widget(text)
        text.pack(fill="both", expand=True, padx=12)

        btns = ttk.Frame(dialog, padding=12)
        btns.pack(fill="x")

        def do_load():
            raw = text.get("1.0", "end")
            contacts = self._parse_list_text(raw)
            if not contacts:
                messagebox.showwarning("Nothing to load", "No contacts were found in the pasted text.")
                return
            contacts, skipped = self._filter_out_recently_texted(contacts)
            if not contacts:
                messagebox.showwarning(
                    "All skipped",
                    f"All {skipped} pasted contact(s) were texted within your re-text cooldown "
                    "and were skipped. Uncheck 'Skip contacts already texted' to load them anyway.",
                )
                return
            self._original_order = contacts
            self.contact_queue = list(contacts)
            if self.random_order_var.get():
                random.shuffle(self.contact_queue)
            self.queue_index = 0
            self._goto_contact(0)
            if skipped:
                self.status_label.config(text=f"Loaded {len(contacts)} contacts - skipped {skipped} already texted recently.")
            dialog.destroy()

        ttk.Button(btns, text="Load", command=do_load, style="Primary.TButton").pack(side="right")
        ttk.Button(btns, text="Cancel", command=dialog.destroy).pack(side="right", padx=(0, 6))

    @staticmethod
    def _parse_list_text(raw):
        contacts = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            if "\t" in line:
                parts = [p.strip() for p in line.split("\t") if p.strip()]
            elif "," in line:
                parts = [p.strip() for p in line.split(",") if p.strip()]
            else:
                parts = [line]
            name = parts[0] if parts else ""
            phone = ""
            for p in parts[1:]:
                if PHONE_CHARS_RE.match(p) or sum(c.isdigit() for c in p) >= 7:
                    phone = p
                    break
            contacts.append({"full_name": name, "phone": phone, "copied": False})
        return contacts

    def _goto_contact(self, index):
        if not self.contact_queue:
            return
        index = max(0, min(index, len(self.contact_queue) - 1))
        self.queue_index = index
        contact = self.contact_queue[index]
        self.full_name_var.set(contact["full_name"])
        self.phone_var.set(contact["phone"])
        # Live CRM-loaded contacts carry staff/location straight from the CRM;
        # pasted lists won't have these, so leave whatever was typed in alone.
        if contact.get("staff") and "staff" in self.field_vars:
            self.field_vars["staff"].set(contact["staff"])
        if contact.get("location") and "location" in self.field_vars:
            self.field_vars["location"].set(contact["location"])
        self._update_last_texted_label(contact.get("phone"))
        self._update_queue_position_label()
        self.first_btn.config(state="normal" if index > 0 else "disabled")
        self.prev_btn.config(state="normal" if index > 0 else "disabled")
        self.next_btn.config(state="normal" if index < len(self.contact_queue) - 1 else "disabled")
        self.copy_next_btn.config(state="normal")
        self.shuffle_btn.config(state="normal")
        self.sequential_btn.config(state="normal")

    def _update_queue_position_label(self):
        total = len(self.contact_queue)
        copied = sum(1 for c in self.contact_queue if c.get("copied"))
        order = "random order" if self.random_order_var.get() else "top to bottom"
        self.queue_position_label.config(
            text=f"Contact {self.queue_index + 1} of {total} ({order}, {copied} copied so far)"
        )

    def _go_to_first(self):
        self._goto_contact(0)

    def _reset_to_sequential(self):
        """Go straight down the list: restore original top-to-bottom order,
        keep each contact's copied/not-copied status, and jump to the top."""
        if not self._original_order:
            return
        self.contact_queue = list(self._original_order)
        self.random_order_var.set(False)
        self._goto_contact(0)

    def _prev_contact(self):
        self._goto_contact(self.queue_index - 1)

    def _next_contact(self):
        self._goto_contact(self.queue_index + 1)

    def _reshuffle_remaining(self):
        if not self.contact_queue:
            return
        remaining = self.contact_queue[self.queue_index + 1:]
        random.shuffle(remaining)
        self.contact_queue = self.contact_queue[: self.queue_index + 1] + remaining
        self._update_queue_position_label()

    def _copy_and_next(self):
        rendered = self.preview_text.get("1.0", "end").rstrip("\n")
        if rendered.strip() and not PLACEHOLDER_RE.search(rendered):
            self.clipboard_clear()
            self.clipboard_append(rendered)
            self._last_clipboard = rendered
            self._record_sent(self.phone_var.get())
        self.contact_queue[self.queue_index]["copied"] = True
        if self.queue_index < len(self.contact_queue) - 1:
            self._next_contact()
        else:
            self._update_queue_position_label()
            self.status_label.config(text="That was the last contact in the list.")
            self.after(4000, lambda: self.status_label.config(text=""))


if __name__ == "__main__":
    if os.name == "nt":
        # Without this, Windows DPI scaling (125%/150%/etc.) makes Tk's own
        # logical-pixel layout math disagree with actual screen pixels,
        # causing text/buttons to render too small or get clipped relative
        # to what Tk thinks it laid out.
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except (AttributeError, OSError):
            try:
                ctypes.windll.user32.SetProcessDPIAware()
            except (AttributeError, OSError):
                pass
    app = FamFitHelper()
    app.mainloop()
