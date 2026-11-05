// The storage survey's questions and answer tidying (src/lib/survey/storage-2026.ts).
//   node --experimental-strip-types src/lib/survey/storage-2026.test.mjs
import { SECTIONS, QUESTIONS, SURVEY_ID, cleanAnswers, cleanEmail, cleanPhone, MAX_TEXT } from "./storage-2026.ts";

let pass = 0, fail = 0;
function is(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label} — expected ${e}, got ${a}`); }
}

is("the survey id fits submit_survey's rule", /^[a-z0-9-]{1,40}$/.test(SURVEY_ID), true);
is("18 questions in three sections, plus the phone number", [SECTIONS.length, QUESTIONS.length], [3, 17]);
is("question ids are unique", new Set(QUESTIONS.map((q) => q.id)).size, QUESTIONS.length);
for (const q of QUESTIONS) {
  const values = q.kind === "scale" ? q.rows.map((r) => r.value) : q.kind === "text" ? [] : q.choices.map((c) => c.value);
  if (new Set(values).size !== values.length) is(`${q.id}: choice values are unique`, false, true);
}
is("American spelling throughout", QUESTIONS.some((q) => /colour|theatre|organis|catalogue/i.test(JSON.stringify(q))), false);

is("only role is required", cleanAnswers({}).missing, ["role"]);
is("an unknown choice doesn't count", cleanAnswers({ role: "wizard" }).missing, ["role"]);
is("a real choice is kept", cleanAnswers({ role: "director" }).answers, { role: "director" });
is("Other keeps what they typed", cleanAnswers({ role: "other", role_other: "  Dramaturg " }).answers, { role: "other", role_other: "Dramaturg" });
is("…but not when Other wasn't picked", cleanAnswers({ role: "director", role_other: "Dramaturg" }).answers, { role: "director" });
is("unknown questions are dropped", Object.keys(cleanAnswers({ role: "asm", sneaky: "x" }).answers), ["role"]);

is("several choices, in the survey's order, without repeats",
  cleanAnswers({ role: "asm", tracking: ["photos", "paper", "photos", "nonsense"] }).answers.tracking, ["paper", "photos"]);
is("the \"What else?\" detail is kept with Other",
  cleanAnswers({ role: "asm", tracking: ["other"], tracking_detail: "A whiteboard" }).answers.tracking_detail, "A whiteboard");
is("…and dropped without it",
  cleanAnswers({ role: "asm", tracking: ["paper"], tracking_detail: "A whiteboard" }).answers.tracking_detail, undefined);
is("None of these stands alone", cleanAnswers({ role: "asm", problems: ["cant-find", "none"] }).answers.problems, ["none"]);

is("ratings keep real rows and levels",
  cleanAnswers({ role: "asm", importance: { search: "very", photos: "loads", nope: "very", offline: "not" } }).answers.importance,
  { search: "very", offline: "not" });
is("no ratings, no answer", cleanAnswers({ role: "asm", importance: {} }).answers.importance, undefined);

is("written answers are trimmed", cleanAnswers({ role: "asm", last_time: "  Swords.  " }).answers.last_time, "Swords.");
is("…and capped", cleanAnswers({ role: "asm", last_time: "a".repeat(MAX_TEXT + 50) }).answers.last_time.length, MAX_TEXT);
is("blank written answers are left out", cleanAnswers({ role: "asm", last_time: "   " }).answers.last_time, undefined);
is("answered counts questions with an answer", cleanAnswers({ role: "asm", pay_model: "either", last_time: "x" }).answered, 3);

is("an empty email is fine", cleanEmail("  "), "");
is("an email is tidied", cleanEmail(" Pat@Example.COM "), "pat@example.com");
is("not an email", cleanEmail("pat at example"), null);
is("an empty phone number is fine", cleanPhone("  "), "");
is("a phone number is tidied", cleanPhone(" (831)  555-0142 "), "(831) 555-0142");
is("an international number with an extension", cleanPhone("+1 831.555.0142 ext. 12"), "+1 831.555.0142 ext. 12");
is("too few digits", cleanPhone("555-0142"), null);
is("the theater's name is kept, trimmed", cleanAnswers({ role: "director", theater_name: "  Bayside Players " }).answers.theater_name, "Bayside Players");
is("a long theater name is cut short", cleanAnswers({ role: "director", theater_name: "x".repeat(500) }).answers.theater_name.length <= 200, true);
is("not a phone number", cleanPhone("call me maybe"), null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
