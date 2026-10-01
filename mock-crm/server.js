// Mock of the Healthy Image Fitness CRM, for testing FamFitHelper without
// touching the real CRM or texting real people.
//
// Built from a recording of the real CRM (see HANDOFF.md "CRM facts"): same
// libraries (jQuery 1.12, Bootstrap 3, Rails jquery_ujs), same page and
// message-window structure and ids (including the two #modal-window elements
// and the shared textarea id), the same Send-button code, and the same JSON
// endpoints with the same quirks. All customers are fake.
//
// Run:   node mock-crm/server.js        (then open http://localhost:4567)
// No npm install needed. jQuery/Bootstrap load from cdnjs.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 4567;
const EXT_DIR = path.join(__dirname, "..", "chrome-extension");
const HERE = __dirname;

// ---------------------------------------------------------------- data ----
// Deterministic fake data (same customers every run).
let seed = 20261001;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const STATUS_CODES = { 0: "Member", 1: "Guest", 2: "Trial", 3: "Corporate", 4: "Contest Box", 5: "Phone Inquiry", 6: "Former Member", 7: "Member Referral", 9: "Event" };
const PRIORITIES = ["Hot", "Warm", "Cold", "Dead", "Collections", "Insurance", "Not Local", "On Trial", "Fu4 Pt"];
const STAFF = [
  { id: 101, name: "Alex Demo" }, { id: 102, name: "Sam Example" }, { id: 103, name: "Jordan Test" },
  { id: 104, name: "Casey Mock" }, { id: 0, name: "Unassigned" },
];
const LOCATIONS = [{ id: 17, name: "Family Fitness Demo Twp" }, { id: 18, name: "Family Fitness Sample City" }];
const FIRST = ["Avery", "Blake", "Cameron", "Dana", "Elliot", "Frankie", "Gray", "Harper", "Indy", "Jamie", "Kai", "Logan", "Morgan", "Noel", "Oakley", "Parker", "Quinn", "Riley", "Sage", "Taylor", "Uma", "Val", "Wren", "Xen", "Yael", "Zion"];
const LAST = ["Anders", "Brooks", "Carver", "Dalton", "Ellis", "Foster", "Garner", "Hayes", "Irwin", "Jensen", "Keller", "Lowry", "Mercer", "Nolan", "Ortega", "Pryor", "Quill", "Ramos", "Sutton", "Tate"];

const DAY = 86400000;
function crmDate(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  const h = d.getHours();
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()} ${p(h % 12 || 12)}:${p(d.getMinutes())} ${h < 12 ? "AM" : "PM"}`;
}

let customers = [];
let history = {}; // customer id -> [{...message row}], newest first

function buildData() {
  seed = 20261001;
  customers = [];
  history = {};
  const now = Date.now();
  for (let i = 0; i < 400; i++) {
    const id = 900000 + i;
    const staff = pick(STAFF);
    const loc = rand() < 0.85 ? LOCATIONS[0] : LOCATIONS[1];
    const codes = Object.keys(STATUS_CODES).map(Number);
    const statusCode = pick(codes);
    const createdAt = now - Math.floor(rand() * 400) * DAY - Math.floor(rand() * DAY);
    let phone = `(555) ${String(100 + Math.floor(rand() * 900))}-${String(1000 + i).slice(-4)}`;
    if (i % 41 === 7) phone = "";                      // some have no phone
    if (i % 53 === 11) phone = customers[i - 5].phone; // some share a phone
    const r = rand();
    customers.push({
      id,
      fullname: `${pick(FIRST)} ${pick(LAST)}`,
      email: `customer${i}@example.test`,
      phone,
      phone_status: phone ? "phone_active" : null,
      created_at_ms: createdAt,
      location: loc.name,
      location_id: loc.id,
      user: staff.name,
      user_id: staff.id,
      priority: pick(PRIORITIES),
      status_code: statusCode,
      idle: Math.floor(rand() * 120),
      phone_subscription_status: r < 0.04 ? "phone_bounced" : r < 0.08 ? "phone_unsubscribed" : "phone_active",
    });
    // Seed some message history: staff texts, the CRM's automated texts,
    // failed sends and replies.
    const rows = [];
    const n = Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const when = now - Math.floor(rand() * 45) * DAY - Math.floor(rand() * DAY);
      const kind = rand();
      rows.push(kind < 0.2
        ? { user: "SYSTEM", category: "sms", message_type: "outgoing", status: "sent", message: "Thanks for signing up! (automated)", created_ms: when }
        : kind < 0.3
          ? { user: staff.name, category: "sms", message_type: "outgoing", status: "failed", message: "Earlier text that failed", created_ms: when }
          : kind < 0.55
            ? { user: staff.name, category: "sms_response", message_type: "incoming", status: "received", message: "Reply from customer", created_ms: when }
            : { user: staff.name === "Unassigned" ? "Alex Demo" : staff.name, category: "sms", message_type: "outgoing", status: "sent", message: "Earlier text from staff", created_ms: when });
    }
    rows.sort((a, b) => b.created_ms - a.created_ms);
    history[id] = rows;
  }
}
buildData();

// ------------------------------------------------------------ settings ----
// Behaviours that can be switched from the control panel (/mock) or tests.
const DEFAULT_SETTINGS = {
  afterSend: "refresh",   // what the CRM does after a successful send: "refresh" | "close"
  rejectSends: false,     // every send fails (HTTP 422, no banner, window stays open)
  rejectIds: [],          // only these customer ids fail
  latencyMs: 250,         // server response delay (opening a window, sending)
  loggedOut: false,       // session expired: everything returns 401
  historyDown: false,     // message history endpoint returns 500
};
let settings = { ...DEFAULT_SETTINGS };
let sentLog = []; // every text "sent" through the mock: {id, name, phone, text, at}

// ------------------------------------------------------------- helpers ----
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function send(res, status, body, type, extraHeaders) {
  res.writeHead(status, { "Content-Type": type || "text/html; charset=utf-8", "Cache-Control": "no-store", ...(extraHeaders || {}) });
  res.end(body);
}
const json = (res, obj, status) => send(res, status || 200, JSON.stringify(obj), "application/json; charset=utf-8");
const later = (ms) => new Promise((r) => setTimeout(r, ms));

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });
}

// Kendo-style query string -> nested object, e.g. filter[filters][0][field]
function parseNested(searchParams) {
  const root = {};
  for (const [key, value] of searchParams) {
    const parts = key.split(/[[\]]+/).filter(Boolean);
    let node = root;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) node[part] = value;
      else node = node[part] = node[part] || {};
    });
  }
  return root;
}

// The real CRM's filter quirks (verified live, read-only):
//  - status matches only its numeric code; a status NAME matches nothing
//  - priority by name; "neq" behaves like "eq"
//  - user_id works; user (name) is ignored
//  - location / location_id are ignored and the total comes back bogus
//  - idle gte/lte; created_at gte YYYY-MM-DD
//  - an OR group combined with any other filter returns nothing
function applyFilters(list, filter) {
  if (!filter || !filter.filters) return { rows: list, bogusTotal: false };
  const clauses = Object.values(filter.filters);
  if (clauses.some((c) => c.logic === "or") && clauses.length > 1) return { rows: [], bogusTotal: false };
  let bogusTotal = false;
  const test = (c, cl) => {
    const v = cl.value;
    switch (cl.field) {
      case "status": return /^\d+$/.test(v) && c.status_code === Number(v);
      case "priority": return c.priority === v; // eq and (quirk) neq alike
      case "user_id": return String(c.user_id) === String(v);
      case "idle": return cl.operator === "gte" ? c.idle >= Number(v) : cl.operator === "lte" ? c.idle <= Number(v) : c.idle === Number(v);
      case "created_at": {
        const t = Date.parse(v + "T00:00:00");
        return isNaN(t) ? true : c.created_at_ms >= t;
      }
      case "location": case "location_id": bogusTotal = true; return true;
      default: return true; // unknown fields (e.g. user by name) are ignored
    }
  };
  const rows = list.filter((c) => clauses.every((cl) =>
    cl.logic === "or" ? Object.values(cl.filters || {}).some((sub) => test(c, sub)) : test(c, cl)
  ));
  return { rows, bogusTotal };
}

function gridRow(c) {
  return {
    id: c.id, fullname: c.fullname, email: c.email, phone: c.phone, phone_status: c.phone_status,
    created_at: crmDate(c.created_at_ms), location: c.location, location_id: c.location_id,
    user: c.user, user_id: c.user_id, priority: c.priority, status: STATUS_CODES[c.status_code],
    idle: c.idle, watch_stream: null, del: false, des_subscription_status: "subscribed",
    phone_subscription_status: c.phone_subscription_status, actions: null, billing_status: null,
  };
}

// --------------------------------------------------- the message window ----
// Same structure, ids and Send-button code as the real CRM's journal window.
function messageWindowHtml(c) {
  const action = `/customers/${c.id}/customer_messages.js`;
  return `<div id="journal-history-modal" class="modal-dialog modal-lg">
  <div class="modal-content">
    <div class="modal-header">
      <button type="button" class="close" data-dismiss="modal"><span>&times;</span></button>
      <h4 class="modal-title">${esc(c.fullname)} &middot; ${esc(c.phone || "no phone")}</h4>
    </div>
    <div class="modal-body">
      <ul class="nav nav-tabs">
        <li class="active"><a href="#journal" data-toggle="tab">Journal</a></li>
        <li><a href="#messages" data-toggle="tab">Messaging</a></li>
      </ul>
      <div class="tab-content">
        <div class="tab-pane fade in active" id="journal"><p class="text-muted" style="padding:12px">Journal history for ${esc(c.fullname)} (mock).</p></div>
        <div class="tab-pane fade" id="messages">
          <div>
            <ul class="nav nav-tabs">
              <li class="active"><a href="#smss" data-toggle="tab">SMS</a></li>
              <li><a href="#emails" data-toggle="tab">Email</a></li>
            </ul>
            <div class="row"><div class="tab-content">
              <div class="tab-pane fade in active" id="smss">
                <div id="customer_message_form" class="new_sms_form col-md-12">
                  <form id="new_sms_customer_message" class="simple_form new_customer_message" action="${action}" method="post" data-remote="true">
                    <input type="hidden" name="customer_message[category]" value="sms">
                    <textarea class="form-control text required" name="customer_message[message]" id="customer_message_message" rows="4"></textarea>
                    <div class="row"><div class="col-md-12" style="margin-top:8px">
                      <a href="#" class="btn btn-default pull-right submit_message" id="submit_sms_message">Send message</a>
                    </div></div>
                  </form>
                </div>
              </div>
              <div class="tab-pane fade" id="emails">
                <div class="new_email_form col-md-12">
                  <form id="new_email_customer_message" class="simple_form new_customer_message" action="${action}" method="post" data-remote="true">
                    <input type="text" class="form-control" name="customer_message[subject]" placeholder="Subject">
                    <textarea class="form-control text required" name="customer_message[message]" id="customer_message_message" rows="4"></textarea>
                    <a href="#" class="btn btn-default pull-right submit_message" id="submit_email_message">Send message</a>
                  </form>
                </div>
              </div>
            </div></div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <script>
    var sent = false;
    var m_type = "sms";
  </script>
  <script>
    $('#submit_sms_message').click(function(e) {
      m_type = "sms";
      if (sent) return;
      sent = true;
      e.preventDefault();
      $.post({
        url: $(\`#new_sms_customer_message\`).attr('action'),
        data: $(\`#new_sms_customer_message\`).serialize(),
        dataType: 'script',
        success: function(response) {
          eval(response);
          $('#main_content').before("<div class=\\"alert alert-success in\\"><button type=\\"button\\" class=\\"close\\" data-dismiss=\\"alert\\">&times;</button><div id=\\"flash_notice\\">Message is sended</div></div>")
          $(".alert").fadeOut(5000);
        },
        error: function(xhr, textStatus, errorThrown) {
          console.log('error', xhr, textStatus, errorThrown)
        }
      });
    });
  </script>
</div>`;
}

// ------------------------------------------------------------ the page ----
function customersPage(query) {
  const harness = query.get("harness");
  // ?slow=<ms>: make the window's open/close animations that slow - what a
  // background tab does to the CRM's own timers.
  const slow = Math.max(0, Number(query.get("slow")) || 0);
  // ?content=/mock/<file>: test a different copy of content.js (e.g. an old
  // version, to show a bug and its fix side by side).
  const contentSrc = /^\/mock\/[\w./-]+\.js$/.test(query.get("content") || "") ? query.get("content") : "/ext/content.js";
  const rows = customers.slice().sort((a, b) => b.created_at_ms - a.created_at_ms).slice(0, 50).map((c) => `
      <tr>
        <td><a href="#">${esc(c.fullname)}</a></td>
        <td>${esc(c.phone)}</td>
        <td>${esc(STATUS_CODES[c.status_code])}</td>
        <td>${esc(c.priority)}</td>
        <td>${esc(c.user)}</td>
        <td><a data-toggle="modal" data-target="#modal-window" data-remote="true" href="/customers/${c.id}/customer_journal_items/new" title="Open messages"><i class="glyphicon glyphicon-book"></i></a></td>
      </tr>`).join("");
  // ?harness=1: run the REAL extension files in this page with a stubbed
  // chrome.* API (for automated tests), instead of loading the extension.
  const harnessScripts = harness ? `
  <script src="/mock/harness-chrome.js"></script>
  <script src="/ext/templates.js"></script>
  <script src="${contentSrc}"></script>
  <script src="/mock/harness-tests.js"></script>` : "";
  const slowScript = slow ? `
<style>.fade { transition-duration: ${slow}ms !important; }</style>
<script>$.fn.modal.Constructor.TRANSITION_DURATION = ${slow}; $.fn.modal.Constructor.BACKDROP_TRANSITION_DURATION = ${slow};</script>` : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Healthy Image Fitness CRM (MOCK)</title>
<meta name="csrf-token" content="mock-csrf-token">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/twitter-bootstrap/3.4.1/css/bootstrap.min.css">
<style>
  body { padding-top: 0; }
  .mock-banner { background: #fff3cd; border-bottom: 1px solid #e0c97a; padding: 6px 16px; font-size: 13px; }
  .modal-dialog { margin-top: 40px; }
</style>
</head><body>
<div class="mock-banner"><b>MOCK CRM</b> - fake customers, nothing is really texted. <a href="/mock">Control panel</a></div>
<div class="container-fluid"><div class="row">
  <div class="col-sm-9 col-sm-offset-3 col-md-10 col-md-offset-2 main">
    <div id="main_content">
      <h3>Customers</h3>
      <table class="table table-condensed"><thead><tr><th>Name</th><th>Phone</th><th>Status</th><th>Priority</th><th>Staff</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div id="modal-window" class="modal fade" tabindex="-1" role="dialog"></div>
      <div id="modal-window" class="modal fade" tabindex="-1" role="dialog"></div>
    </div>
  </div>
</div></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/1.12.4/jquery.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/twitter-bootstrap/3.4.1/js/bootstrap.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-ujs/1.2.3/rails.min.js"></script>${slowScript}${harnessScripts}
</body></html>`;
}

function controlPanel() {
  const opt = (v, cur) => `<option value="${v}"${v === cur ? " selected" : ""}>${v}</option>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Mock CRM control panel</title>
<style>body{font:14px Segoe UI,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#2B2724}
label{display:block;margin:10px 0}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid #ddd;padding:4px;text-align:left}
button{padding:6px 12px;margin-right:8px}</style></head><body>
<h2>Mock CRM - control panel</h2>
<p><a href="/customers">Open the mock CRM</a> &middot; Settings apply immediately.</p>
<form id="f">
  <label>After a successful send the window:
    <select name="afterSend">${opt("refresh", settings.afterSend)}${opt("close", settings.afterSend)}</select></label>
  <label><input type="checkbox" name="rejectSends"${settings.rejectSends ? " checked" : ""}> Reject every send (CRM error, no banner, window stays open)</label>
  <label>Reject sends to these customer ids (comma separated): <input name="rejectIds" value="${settings.rejectIds.join(",")}"></label>
  <label>Server delay (ms): <input name="latencyMs" type="number" value="${settings.latencyMs}"></label>
  <label><input type="checkbox" name="loggedOut"${settings.loggedOut ? " checked" : ""}> Logged out (session expired)</label>
  <label><input type="checkbox" name="historyDown"${settings.historyDown ? " checked" : ""}> Message history unavailable</label>
</form>
<p><button id="reset">Reset everything</button></p>
<h3>Texts "sent" through the mock (${sentLog.length})</h3>
<table><tr><th>When</th><th>Customer</th><th>Phone</th><th>Message</th></tr>
${sentLog.slice().reverse().map((s) => `<tr><td>${esc(new Date(s.at).toLocaleTimeString())}</td><td>${esc(s.name)} (${s.id})</td><td>${esc(s.phone)}</td><td>${esc(s.text)}</td></tr>`).join("")}
</table>
<script>
const f = document.getElementById("f");
f.addEventListener("change", async () => {
  const body = {
    afterSend: f.afterSend.value, rejectSends: f.rejectSends.checked,
    rejectIds: f.rejectIds.value.split(",").map((s) => s.trim()).filter(Boolean).map(Number),
    latencyMs: Number(f.latencyMs.value) || 0, loggedOut: f.loggedOut.checked, historyDown: f.historyDown.checked,
  };
  await fetch("/mock/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
});
document.getElementById("reset").onclick = async () => { await fetch("/mock/reset", { method: "POST" }); location.reload(); };
</script></body></html>`;
}

// ------------------------------------------------------------- routing ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  try {
    // --- test/control endpoints ---
    if (p === "/" ) return send(res, 302, "", "text/plain", { Location: "/customers" });
    if (p === "/mock") return send(res, 200, controlPanel());
    // Automated tests for the popup's templates (drives /popup in an iframe).
    if (p === "/popup-tests") {
      return send(res, 200, '<!doctype html><meta charset="utf-8"><title>popup tests</title><body style="font:13px sans-serif"><h3>Popup template tests</h3><div id="out"></div><script src="/mock/popup-tests.js"></script>');
    }
    // The REAL popup page (popup.html + popup.js) with stubbed chrome.* APIs.
    if (p === "/popup") {
      const html = fs.readFileSync(path.join(EXT_DIR, "popup.html"), "utf8")
        .replace('<script src="templates.js">', '<script src="/mock/harness-chrome.js"></script>\n  <script src="/mock/popup-chrome.js"></script>\n  <script src="/ext/templates.js">')
        .replace('<script src="popup.js">', '<script src="/ext/popup.js">');
      return send(res, 200, html);
    }
    if (p === "/mock/settings" && req.method === "POST") {
      settings = { ...settings, ...JSON.parse((await readBody(req)) || "{}") };
      return json(res, settings);
    }
    if (p === "/mock/settings") return json(res, settings);
    if (p === "/mock/reset" && req.method === "POST") {
      settings = { ...DEFAULT_SETTINGS }; sentLog = []; buildData();
      return json(res, { ok: true });
    }
    if (p === "/mock/sent") return json(res, sentLog);
    if (p === "/mock/history" && req.method === "POST") {
      // Seed a customer's message history: {id, rows:[{user,status,message_type,message,daysAgo}]}
      const { id, rows } = JSON.parse((await readBody(req)) || "{}");
      history[id] = (rows || []).map((r) => ({ category: "sms", message_type: "outgoing", status: "sent", message: "text", ...r, created_ms: Date.now() - (r.daysAgo || 0) * DAY })).sort((a, b) => b.created_ms - a.created_ms);
      return json(res, { ok: true });
    }
    if (p === "/mock/customers") return json(res, customers.map(gridRow));
    if (p.startsWith("/mock/") && req.method === "GET") {
      const file = path.join(HERE, p.slice(6));
      if (!file.startsWith(HERE)) return send(res, 403, "no");
      return fs.readFile(file, (err, buf) => err ? send(res, 404, "not found") : send(res, 200, buf, "text/javascript; charset=utf-8"));
    }
    // The real extension files (for ?harness=1 test pages)
    if (p.startsWith("/ext/")) {
      const file = path.join(EXT_DIR, p.slice(5));
      if (!file.startsWith(EXT_DIR)) return send(res, 403, "no");
      return fs.readFile(file, (err, buf) => err ? send(res, 404, "not found") : send(res, 200, buf, "text/javascript; charset=utf-8"));
    }

    // --- the CRM ---
    if (settings.loggedOut && p !== "/customers") return send(res, 401, "You need to sign in or sign up before continuing.", "text/plain");

    if (p === "/customers") return send(res, 200, customersPage(url.searchParams));

    if (p === "/customers_grid.json") {
      const q = parseNested(url.searchParams);
      const sorted = customers.slice().sort((a, b) => b.created_at_ms - a.created_at_ms);
      const { rows, bogusTotal } = applyFilters(sorted, q.filter);
      const take = Number(q.take) || 100, skip = Number(q.skip) || 0;
      return json(res, { data: rows.slice(skip, skip + take).map(gridRow), total: bogusTotal ? 938524 : rows.length });
    }

    let m = /^\/customers\/(\d+)\/customer_journal_items\/new$/.exec(p);
    if (m) {
      const c = customers.find((x) => x.id === Number(m[1]));
      if (!c) return send(res, 404, "not found", "text/plain");
      await later(settings.latencyMs);
      // Rails JS response: replace the (first) #modal-window's content.
      return send(res, 200, `$('#modal-window').html(${JSON.stringify(messageWindowHtml(c))});`, "text/javascript; charset=utf-8");
    }

    m = /^\/customers\/(\d+)\/customer_messages\.js$/.exec(p);
    if (m && req.method === "POST") {
      const c = customers.find((x) => x.id === Number(m[1]));
      const form = new URLSearchParams(await readBody(req));
      const text = (form.get("customer_message[message]") || "").trim();
      await later(settings.latencyMs);
      if (!c || !text || !c.phone || settings.rejectSends || settings.rejectIds.includes(c.id)) {
        return send(res, 422, "Message could not be sent", "text/plain");
      }
      sentLog.push({ id: c.id, name: c.fullname, phone: c.phone, text, at: Date.now() });
      (history[c.id] = history[c.id] || []).unshift({ user: "Alex Demo", category: "sms", message_type: "outgoing", status: "sent", message: text, created_ms: Date.now() });
      // What the CRM's JS reply does after a send.
      const reply = settings.afterSend === "close"
        ? "$('#modal-window').modal('hide');"
        : `$('#modal-window').html(${JSON.stringify(messageWindowHtml(c))});`;
      return send(res, 200, reply, "text/javascript; charset=utf-8");
    }

    m = /^\/customers\/(\d+)\/customer_messages\.json$/.exec(p);
    if (m) {
      if (settings.historyDown) return send(res, 500, "error", "text/plain");
      const type = url.searchParams.get("message_type") || "sms";
      const rows = (history[Number(m[1])] || [])
        .filter((r) => (type === "email" ? r.category === "email" : r.category !== "email"))
        .map((r) => ({ user: r.user, category: r.category, message_type: r.message_type, status: r.status, contact: "", message: r.message, subject: null, created_at: crmDate(r.created_ms), error_message: r.status === "failed" ? "Carrier error" : null }));
      return json(res, { data: rows.slice(0, Number(url.searchParams.get("take")) || 25), total: rows.length });
    }

    return send(res, 404, "not found", "text/plain");
  } catch (e) {
    console.error(e);
    return send(res, 500, String(e), "text/plain");
  }
});

server.listen(PORT, () => {
  console.log(`Mock CRM running: http://localhost:${PORT}/customers   (control panel: http://localhost:${PORT}/mock)`);
});
