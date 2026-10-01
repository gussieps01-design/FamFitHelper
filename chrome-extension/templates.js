// Starter templates. Each has several versions of the same pitch; a batch
// rotates through them contact by contact so people don't all get identical
// wording. In the popup the versions are shown in one box, separated by a
// line containing only ---.
// Placeholders supported here: {{first_name}}, {{last_name}}, {{staff}}, {{location}}.
// `hint` is shown under the template picker: who this one is meant for.
const FAMFIT_TEMPLATES = [
  { name: "Personal training", hint: "Members or trials who might want a trainer.", variants: [
    "Hi {{first_name}}, this is {{staff}} from {{location}}. Would a personal training session help you reach your goals faster? I'd be happy to set one up for you - just let me know!",
    "Hey {{first_name}}, {{staff}} at {{location}} here. Our trainers can build a plan around your goals and keep you on track. Want me to book you a session?",
    "Hi {{first_name}}! It's {{staff}} from {{location}}. If you want to see results faster, a session with one of our trainers can really help. Want me to find you a time?",
  ] },
  { name: "Holiday notice", hint: "Everyone. Add the actual hours by hand if you want to include them.", variants: [
    "Hi {{first_name}}, this is {{staff}} from {{location}}! Just a heads up that our hours are a little different for the holiday. Reply here if you have any questions about the schedule!",
    "Hey {{first_name}}, {{staff}} at {{location}} here. Quick note - we have special hours for the holiday. Text me if you'd like the details. Happy holidays!",
    "Hi {{first_name}}! It's {{staff}} from {{location}}. We're running a holiday schedule, so our hours will look a bit different. Let me know if you want the details. Enjoy the holiday!",
  ] },
  { name: "Relocation", hint: "Members who are moving or not local (try Priority = Not Local).", variants: [
    "Hi {{first_name}}, this is {{staff}} from {{location}}. I heard you might be moving out of the area - I'd love to help sort out your membership. Let me know what works for you!",
    "Hey {{first_name}}, {{staff}} at {{location}} here. If you're relocating, I can go over your membership options with you so there are no surprises. Just reply whenever you're ready.",
    "Hi {{first_name}}! It's {{staff}} from {{location}}. Are you moving away? I'm happy to help with your membership and make the move easy. Text me anytime.",
  ] },
  { name: "Membership expired win-back", hint: "Members whose membership just lapsed.", variants: [
    "Hey {{first_name}}, it's {{staff}} from {{location}}. I noticed your membership lapsed and we'd love to have you back! Want to go over options? No pressure at all.",
    "Hi {{first_name}}, {{staff}} here at {{location}}. We miss seeing you! Your membership expired - if you'd like to come back, I can walk you through your options.",
    "Hey {{first_name}}! It's {{staff}} from {{location}}. I saw your membership ended and wanted to reach out. We'd really love to have you back - want to chat about options?",
  ] },
  { name: "Former members", hint: "Former Member status: people who left a while ago.", variants: [
    "Hi {{first_name}}, this is {{staff}} from {{location}}. It's been a while since we've seen you and we'd love to welcome you back. Let me know if you'd like to hear what's new!",
    "Hey {{first_name}}, {{staff}} at {{location}} here. A lot has been going on at the gym since you left and we'd love to have you back. Want me to fill you in?",
    "Hi {{first_name}}! It's {{staff}} from {{location}}. We haven't forgotten about you! If you're thinking about getting back into a routine, I'd be glad to help you restart.",
  ] },
  { name: "Free pass / trial follow-up", hint: "Trial status: people who got a free pass or trial.", variants: [
    "Hi {{first_name}}, this is {{staff}} from {{location}}! Just checking in on your free trial. Come in anytime and I'll show you around. What day works for you?",
    "Hey {{first_name}}, {{staff}} here at {{location}}. How's your free pass going? If you haven't used it yet, stop in whenever and I'll give you a tour!",
    "Hi {{first_name}}! It's {{staff}} from {{location}}. Wanted to make sure you got your free pass and see if you have any questions. Come by any day and I'll get you started.",
  ] },
  { name: "Missed guests", hint: "Guest status: people who visited as a guest but didn't sign up.", variants: [
    "Hi {{first_name}}, this is {{staff}} from {{location}}. Thanks for coming in as a guest! I'd love to hear what you thought and answer any questions about getting started.",
    "Hey {{first_name}}, {{staff}} at {{location}} here. It was great having you in as a guest. Do you have any questions, or want to set up another visit?",
    "Hi {{first_name}}! It's {{staff}} from {{location}}. Thanks for stopping by! If you're still thinking about joining, I'd be happy to go over options and help you get started.",
  ] },
  { name: "Re-engagement (cold lead)", hint: "Leads who went quiet (try Priority = Cold).", variants: [
    "Hey {{first_name}}, it's {{staff}} from {{location}}. It's been a bit since we last connected. Are you still interested in getting started? I'd be happy to get you set up.",
    "Hi {{first_name}}, {{staff}} here from {{location}}. Haven't heard from you in a while - still thinking about getting started? Let me know and I'll help whenever you're ready.",
    "Hey {{first_name}}! It's {{staff}} at {{location}}. Just circling back. If you're still interested in coming in, reply here and I'll get everything ready for you.",
  ] },
];

// Line that separates versions of a message in the template box.
const FAMFIT_VARIANT_SEPARATOR = "---";

// The only {{placeholders}} the extension fills in.
const FAMFIT_FIELDS = ["first_name", "last_name", "staff", "location"];

// All versions of a template, as shown/edited in the popup's template box.
function famfitTemplateText(template) {
  return template.variants.join(`\n${FAMFIT_VARIANT_SEPARATOR}\n`);
}

// Split template-box text into its versions (a line with only --- separates them).
function famfitSplitVariants(text) {
  return (text || "")
    .split(/^[ \t]*-{3,}[ \t]*$/m)
    .map((v) => v.trim())
    .filter(Boolean);
}

function famfitRenderTemplate(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (m, key) => (vars[key] !== undefined && vars[key] !== "" ? vars[key] : m));
}

// Problems that would put wrong text in front of a customer. Returns a list of
// plain-language messages; empty means the text is fine to save and send.
//  - a {{placeholder}} the extension doesn't know (typo like {{firstname}})
//  - braces that aren't a clean {{name}} (e.g. {first_name} or {{ first_name }})
//  - no message text at all
function famfitTemplateProblems(text) {
  const problems = [];
  if (!famfitSplitVariants(text).length) {
    problems.push("The message is empty.");
    return problems;
  }
  const clean = /\{\{(\w+)\}\}/g;
  const unknown = [];
  let m;
  while ((m = clean.exec(text))) {
    if (!FAMFIT_FIELDS.includes(m[1]) && !unknown.includes(m[0])) unknown.push(m[0]);
  }
  if (unknown.length) {
    problems.push(`${unknown.join(", ")} isn't a field I can fill in. Use only ${FAMFIT_FIELDS.map((f) => `{{${f}}}`).join(", ")}.`);
  }
  // Whatever braces are left once the clean placeholders are removed.
  if (/[{}]/.test(text.replace(clean, ""))) {
    problems.push("There is a stray { or } in the message. Placeholders must look exactly like {{first_name}} (no spaces).");
  }
  return problems;
}

// ---- Saved (custom) templates -------------------------------------------
// Stored in chrome.storage.local under FAMFIT_SAVED_KEY as
// [{ id, name, text }]. Starter templates above are never changed.
const FAMFIT_SAVED_KEY = "famfitSavedTemplates";
const FAMFIT_NAME_MAX = 60;

// Returns an error string, or "" if `name` is OK to use. `exceptId` lets a
// template keep its own name when it is re-saved.
function famfitNameProblem(name, saved, exceptId) {
  const n = (name || "").trim();
  if (!n) return "Give the template a name first.";
  if (n.length > FAMFIT_NAME_MAX) return `Keep the name under ${FAMFIT_NAME_MAX} characters.`;
  const lower = n.toLowerCase();
  if (FAMFIT_TEMPLATES.some((t) => t.name.toLowerCase() === lower)) return "That name is used by a starter template. Pick a different name.";
  if ((saved || []).some((t) => t.id !== exceptId && t.name.toLowerCase() === lower)) return "You already have a saved template with that name.";
  return "";
}

function famfitNewId() {
  return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
