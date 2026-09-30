// Starter templates. Each has several versions of the same pitch; a batch
// rotates through them contact by contact so people don't all get identical
// wording. In the popup the versions are shown in one box, separated by a
// line containing only ---.
// Placeholders supported here: {{first_name}}, {{last_name}}, {{staff}}, {{location}}.
const FAMFIT_TEMPLATES = [
  { name: "Trial check-in", variants: [
    "Hey {{first_name}}, this is {{staff}} from {{location}}! Just checking in to see how your trial is going so far. Let me know if you have any questions or want to book a time to come back in!",
    "Hi {{first_name}}, {{staff}} here at {{location}}. How are you liking your trial so far? If you have any questions or want to set up another visit, just let me know!",
    "Hey {{first_name}}! It's {{staff}} with {{location}}. Wanted to see how the trial's treating you - anything I can help with, or want to lock in a time to come back?",
  ] },
  { name: "Missed call follow-up", variants: [
    "Hi {{first_name}}, this is {{staff}} from {{location}} - sorry I missed your call! What can I help you with? Feel free to call/text back anytime.",
    "Hey {{first_name}}, {{staff}} at {{location}} here. Sorry I missed you! What can I do for you? Text or call back whenever works.",
    "Hi {{first_name}}! It's {{staff}} from {{location}} - just saw I missed your call. How can I help? Reply here or give me a call anytime.",
  ] },
  { name: "Appointment reminder", variants: [
    "Hi {{first_name}}, this is {{staff}} from {{location}} confirming your upcoming appointment. Reply YES to confirm or let me know if you need to reschedule!",
    "Hey {{first_name}}, {{staff}} at {{location}} here - just a reminder about your upcoming appointment. Reply YES to confirm, or let me know if another time works better!",
    "Hi {{first_name}}! It's {{staff}} from {{location}}. Checking that we're still good for your appointment - reply YES to confirm or tell me if you need to move it.",
  ] },
  { name: "Re-engagement (cold lead)", variants: [
    "Hey {{first_name}}, it's {{staff}} from {{location}}. It's been a bit since we last connected - we'd love to have you back in! Let me know if you're still interested and I can get you set up.",
    "Hi {{first_name}}, {{staff}} here from {{location}}. Haven't heard from you in a while - still thinking about getting started? I'd be happy to help you get set up whenever you're ready.",
    "Hey {{first_name}}! It's {{staff}} at {{location}}. Just circling back - if you're still interested in coming in, let me know and I'll get everything ready for you.",
  ] },
  { name: "Welcome / new member", variants: [
    "Welcome to {{location}}, {{first_name}}! This is {{staff}} - excited to have you as a member. Let me know if you ever have questions, and see you at the gym!",
    "Hey {{first_name}}, welcome to the {{location}} family! I'm {{staff}} - reach out anytime you have questions. Glad to have you with us!",
    "Hi {{first_name}}! {{staff}} from {{location}} here - so glad you joined! If there's anything you need as you get started, just text me. See you soon!",
  ] },
  { name: "No-show follow-up", variants: [
    "Hey {{first_name}}, this is {{staff}} from {{location}} - we missed you at your appointment! No worries at all, just let me know a better time and I'll get you rebooked.",
    "Hi {{first_name}}, {{staff}} at {{location}} here. Looks like we missed each other today - totally fine! When's a better time? I'll get you rescheduled.",
    "Hey {{first_name}}! It's {{staff}} from {{location}}. Sorry we didn't get to see you - life happens! Let me know what day works and I'll set you back up.",
  ] },
  { name: "Free trial pass follow-up", variants: [
    "Hi {{first_name}}, this is {{staff}} from {{location}}! Wanted to make sure your free trial pass came through okay - come in anytime and I'll show you around. Any day works!",
    "Hey {{first_name}}, {{staff}} here at {{location}}. Did your free trial pass come through alright? Stop in whenever and I'll give you a tour!",
    "Hi {{first_name}}! It's {{staff}} from {{location}} - just making sure you got your free pass. Come by any day and I'll get you started.",
  ] },
  { name: "Post-first-workout check-in", variants: [
    "Hey {{first_name}}, {{staff}} here from {{location}} - how'd your first workout go? Let me know if you're feeling sore or have any questions, happy to help!",
    "Hi {{first_name}}, it's {{staff}} at {{location}}. How was that first workout? Any soreness or questions, just let me know!",
    "Hey {{first_name}}! {{staff}} from {{location}} checking in - how are you feeling after your first session? I'm here if you need anything.",
  ] },
  { name: "Membership renewal reminder", variants: [
    "Hi {{first_name}}, this is {{staff}} from {{location}}. Just a heads up that your membership is coming up for renewal - let me know if you'd like to go over your options anytime!",
    "Hey {{first_name}}, {{staff}} at {{location}} here. Your membership renewal is coming up soon - happy to walk through your options whenever works for you.",
    "Hi {{first_name}}! It's {{staff}} from {{location}}. Quick heads up that your renewal is coming up - want to go over your options? Just let me know.",
  ] },
  { name: "Membership expired win-back", variants: [
    "Hey {{first_name}}, it's {{staff}} from {{location}}. Noticed your membership lapsed - we'd love to have you back! Let me know if you want to talk through options, no pressure at all.",
    "Hi {{first_name}}, {{staff}} here at {{location}}. We miss seeing you! Your membership lapsed - if you'd like to come back, I can go over options with you. No pressure.",
    "Hey {{first_name}}! It's {{staff}} from {{location}}. Saw your membership ended - we'd really love to have you back. Want to chat about options? Totally up to you.",
  ] },
  { name: "Referral thank-you", variants: [
    "Hi {{first_name}}, this is {{staff}} from {{location}} - thank you so much for referring a friend! We really appreciate it. Let me know if there's ever anything you need.",
    "Hey {{first_name}}, {{staff}} at {{location}} here. Thanks a ton for sending a friend our way - it means a lot! Let me know if you ever need anything.",
    "Hi {{first_name}}! It's {{staff}} from {{location}}. Just wanted to say thank you for the referral - we really appreciate you! Reach out anytime.",
  ] },
  { name: "Birthday message", variants: [
    "Happy birthday, {{first_name}}! This is {{staff}} from {{location}} wishing you a great one. Come celebrate with a workout on us if you're free this week!",
    "Happy birthday {{first_name}}! {{staff}} and everyone at {{location}} hope you have an awesome day. Stop in this week for a birthday workout on us!",
    "Hey {{first_name}}, happy birthday from {{staff}} at {{location}}! Hope it's a great one - come celebrate with a workout on us this week!",
  ] },
  { name: "Billing / payment reminder", variants: [
    "Hi {{first_name}}, this is {{staff}} from {{location}}. Looks like there was an issue processing your last payment - could you give us a call or stop by when you get a chance? Thanks!",
    "Hey {{first_name}}, {{staff}} at {{location}} here. Your last payment didn't go through - when you get a minute, could you call or stop by so we can fix it? Thanks!",
    "Hi {{first_name}}! It's {{staff}} from {{location}}. We had trouble processing your last payment - could you reach out or swing by when it's convenient? Thank you!",
  ] },
  { name: "Collections outreach (friendly)", variants: [
    "Hi {{first_name}}, this is {{staff}} from {{location}}. Reaching out about your account balance - totally understand things come up. Let me know what works for you and we'll get it sorted out.",
    "Hey {{first_name}}, {{staff}} at {{location}} here. Wanted to touch base about the balance on your account - no stress, just let me know what works and we'll figure it out together.",
    "Hi {{first_name}}! It's {{staff}} from {{location}}. Following up on your account balance - we know things happen. Reply when you can and we'll find something that works for you.",
  ] },
  { name: "Insurance paperwork follow-up", variants: [
    "Hey {{first_name}}, this is {{staff}} from {{location}}. Just following up on the insurance paperwork for your membership - let me know if you have any questions or need help getting it submitted!",
    "Hi {{first_name}}, {{staff}} at {{location}} here. Checking in on your insurance paperwork - need any help getting it submitted? Just let me know.",
    "Hey {{first_name}}! It's {{staff}} from {{location}}. Wanted to see how the insurance paperwork is coming along - happy to help with any questions.",
  ] },
  { name: "Relocating / not local follow-up", variants: [
    "Hi {{first_name}}, this is {{staff}} from {{location}}. Heard you might be moving out of the area - wanted to check in on your membership. Happy to help figure out next steps whenever you're ready.",
    "Hey {{first_name}}, {{staff}} at {{location}} here. I heard you might be relocating - want to go over what that means for your membership? Just let me know when works.",
    "Hi {{first_name}}! It's {{staff}} from {{location}}. If you're moving away, I'd be glad to help sort out your membership - reach out whenever you're ready.",
  ] },
  { name: "Holiday hours notice", variants: [
    "Hi {{first_name}}, this is {{staff}} from {{location}}! Just a heads up that our hours are a little different for the holiday - let us know if you have any questions about the schedule.",
    "Hey {{first_name}}, {{staff}} at {{location}} here. Quick heads up - our hours are changing a bit for the holiday. Any questions about the schedule, just ask!",
    "Hi {{first_name}}! It's {{staff}} from {{location}}. Just letting you know we have special holiday hours - reach out if you want the details.",
  ] },
  { name: "New class or program announcement", variants: [
    "Hey {{first_name}}, {{staff}} here from {{location}} - we just added a new class we think you'd love! Let me know if you want the schedule or want to try it out.",
    "Hi {{first_name}}, it's {{staff}} at {{location}}. We've got a brand new class you might really enjoy - want the schedule or to give it a try?",
    "Hey {{first_name}}! {{staff}} from {{location}} here - something new just launched and I thought of you. Want the details or a spot in the next class?",
  ] },
  { name: "Long time no see check-in", variants: [
    "Hey {{first_name}}, this is {{staff}} from {{location}} - haven't seen you in a bit! Just checking in to see how you're doing and if there's anything we can help with.",
    "Hi {{first_name}}, {{staff}} at {{location}} here. It's been a little while - how are you doing? Let me know if there's anything we can do for you.",
    "Hey {{first_name}}! It's {{staff}} from {{location}}. We've missed seeing you around - hope all is well! Anything I can help with to get you back in?",
  ] },
  { name: "Personal training offer", variants: [
    "Hi {{first_name}}, this is {{staff}} from {{location}}. Thought you might be interested in a personal training session to help hit your goals faster - want me to set one up for you?",
    "Hey {{first_name}}, {{staff}} at {{location}} here. Would a personal training session help with your goals? I'd be happy to set one up for you!",
    "Hi {{first_name}}! It's {{staff}} from {{location}}. If you want to hit your goals faster, a session with one of our trainers could really help - want me to book one?",
  ] },
];

// Line that separates versions of a message in the template box.
const FAMFIT_VARIANT_SEPARATOR = "---";

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
