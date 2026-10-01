// Starter templates. Each has several versions of the same pitch; a batch
// rotates through them contact by contact so people don't all get identical
// wording. In the popup the versions are shown in one box, separated by a
// line containing only ---.
// Placeholders supported here: {{first_name}}, {{last_name}}, {{staff}}, {{location}}.
// `hint` is shown under the template picker: who this one is meant for.
const FAMFIT_TEMPLATES = [
  { name: "Personal training", hint: "Members or trials who might want a trainer.", variants: [
    "Hey {{first_name}}, it's {{staff}} from {{location}}. Ever thought about working with one of our trainers? We can set up a session and get you a real plan. Want me to find you a time this week?",
    "{{first_name}}, {{staff}} at {{location}}. A lot of people hit their goals way faster with a trainer. Want to try a session? Text me back a day that works.",
    "Hey {{first_name}}! {{staff}} here at {{location}}. Want me to set you up with a trainer? Shoot me a day and time and I'll lock it in.",
  ] },
  { name: "Holiday notice", hint: "Everyone. Add the actual hours by hand if you want to include them.", variants: [
    "Hey {{first_name}}, {{staff}} at {{location}}. Heads up, our hours are different for the holiday. Text me back if you want the exact times. Enjoy the holiday!",
    "{{first_name}}, quick note from {{location}}: we've got holiday hours, so check with me before you head in. Just text back and I'll send them over. Happy holidays!",
    "Hey {{first_name}}! {{staff}} from {{location}}. We've got special hours for the holiday. Shoot me a text if you want the times. Have a good one!",
  ] },
  { name: "Relocation", hint: "Members who are moving or not local (try Priority = Not Local).", variants: [
    "Hey {{first_name}}, it's {{staff}} from {{location}}. Heard you might be moving. Congrats! Text me back so we can sort out your membership before you go.",
    "{{first_name}}, {{staff}} at {{location}}. Are you moving out of the area? Let me know and I'll walk you through what to do with your membership. It's an easy fix.",
    "Hey {{first_name}}! {{staff}} here at {{location}}. If you're relocating, give me a call or text back and we'll get your membership taken care of before you leave.",
  ] },
  { name: "Membership expired win-back", hint: "Members whose membership just lapsed.", variants: [
    "Hey {{first_name}}, it's {{staff}} from {{location}}. Saw your membership ran out and we miss you around here! Want me to get you set back up? Text me back.",
    "{{first_name}}, {{staff}} at {{location}}. Your membership ended, but we'd love to have you back. Stop in this week and I'll go over what we've got right now.",
    "Hey {{first_name}}! {{staff}} from {{location}}. It's been a minute since we've seen you. Want to jump back in? Let me know what day works and I'll have it ready.",
  ] },
  { name: "Former members", hint: "Former Member status: people who left a while ago.", variants: [
    "Hey {{first_name}}, {{staff}} from {{location}}. It's been a while! A lot has changed at the gym. Stop in and I'll show you around. What day works for you?",
    "{{first_name}}, it's {{staff}} at {{location}}. Thinking about getting back into it? Come check out what's new and I'll give you a quick tour. Text me a day that works.",
    "Hey {{first_name}}! {{staff}} here at {{location}}. We'd love to see you again. Want to come in this week and see what's new?",
  ] },
  { name: "Free pass / trial follow-up", hint: "Trial status: people who got a free pass or trial.", variants: [
    "Hey {{first_name}}, it's {{staff}} from {{location}}. Saw you grabbed a free pass. When are you thinking of stopping in? I'll give you a quick tour.",
    "{{first_name}}, {{staff}} at {{location}}. Did you get to use your free pass yet? Stop by anytime and ask for me. What day works?",
    "Hey {{first_name}}! {{staff}} here at {{location}}. Your free pass is waiting on you. Text me back a day and time and I'll meet you at the front.",
  ] },
  { name: "Missed guests", hint: "Guest status: people who visited as a guest but didn't sign up.", variants: [
    "Hey {{first_name}}, {{staff}} from {{location}}. Thanks for coming in! How'd you like the gym? Got any questions, or want to come back in this week?",
    "{{first_name}}, it's {{staff}} at {{location}}. Thanks for stopping by. What did you think? Text me back if you want to talk about getting started.",
    "Hey {{first_name}}! {{staff}} here at {{location}}. Thanks for coming by. Still thinking it over? Shoot me a text and I'll answer anything you want to know.",
  ] },
  { name: "Re-engagement (cold lead)", hint: "Leads who went quiet (try Priority = Cold).", variants: [
    "Hey {{first_name}}, it's {{staff}} from {{location}}. Are you still looking to get started at the gym? Text me back and I'll get you in this week.",
    "{{first_name}}, {{staff}} at {{location}}. Still thinking about joining? What day works for you to come check it out?",
    "Hey {{first_name}}! {{staff}} here at {{location}}. Did you ever get started with a gym? I can show you around, just text me back a day.",
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
