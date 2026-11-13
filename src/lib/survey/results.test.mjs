// Survey responses made readable (src/lib/survey/results.ts).
//   npm run test:unit
import { formatReceived, priceRange, readResponse, resultsTable, roleOf, tally } from "./results.ts";
import { QUESTIONS } from "./storage-2026.ts";

let pass = 0, fail = 0;
function is(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label} — expected ${e}, got ${a}`); }
}

// The first real response (Santa Cruz Actors' Theatre, Nov 2026).
const scat = {
  id: "r1",
  survey: "storage-2026",
  email: null,
  created_at: "2026-11-11T00:03:00Z",
  answers: {
    find: "ask", role: "other", items: "under-200", company: "community",
    problems: ["cant-find", "not-returned", "new-crew"], rebought: "once-twice",
    tracking: ["memory"], pay_model: "either", pull_time: "not-involved",
    importance: { "in-use": "somewhat", photos: "somewhat", search: "very", offline: "not", location: "very", "pull-lists": "somewhat", "photo-search": "somewhat" },
    role_other: "Board president/executive director",
    price_points: { bargain: "5-15", expensive: "15-30", "too-cheap": "under-5", "too-expensive": "30-60" },
    theater_name: "Santa Cruz Actors' Theatre",
    anything_else: "We rent a storage space monthly.",
  },
};
const sm = {
  id: "r2",
  survey: "storage-2026",
  email: "sm@example.com",
  created_at: "2026-11-13T18:30:00Z",
  answers: {
    role: "stage-manager", theater_name: "  Pacific Rep ", company: "professional",
    tracking: ["spreadsheet", "other"], tracking_detail: "A whiteboard",
    problems: ["cant-find", "double-booked"],
    importance: { search: "very", location: "somewhat" },
    price_points: { "too-cheap": "5-15", bargain: "15-30", expensive: "30-60", "too-expensive": "60-100" },
    software_name: "Sortly",
    phone: "(831) 555-0142",
    pay: "maybe", // a question the survey no longer asks
  },
};
const bare = { id: "r3", survey: "storage-2026", email: null, created_at: "2026-11-13T19:00:00Z", answers: { role: "director" } };

// ── One response, in words
const s = readResponse(scat);
is("the theater", s.theater, "Santa Cruz Actors' Theatre");
is("'Other' as a role uses their own words", s.role, "Board president/executive director");
is("received, in California time", s.received, "Nov 10, 2026, 4:03 PM");
is("role and theater aren't repeated among the answers", s.answers.some((a) => a.id === "role" || a.id === "theater_name"), false);
is("a single choice reads as its label", s.answers.find((a) => a.id === "find"), { id: "find", prompt: QUESTIONS.find((q) => q.id === "find").prompt, kind: "choices", values: ["We ask someone who knows"] });
is("several choices read as labels, in the order chosen", s.answers.find((a) => a.id === "problems").values, [
  "Couldn’t find something we knew we had", "Something wasn’t put back after a show", "New crew or volunteers didn’t know where things go",
]);
is("a grid reads row by row, in the survey's row order", s.answers.find((a) => a.id === "importance").rows.slice(0, 3), [
  { label: "Searching by name, material or color", level: "Very" },
  { label: "A photo of every item", level: "Somewhat" },
  { label: "Knowing the exact room, shelf and box", level: "Very" },
]);
is("prices read as their bands", s.answers.find((a) => a.id === "price_points").rows.map((r) => r.level), ["Under $5", "$5–15", "$15–30", "$30–60"]);
is("written answers come through as written", s.answers.find((a) => a.id === "anything_else").text, "We rent a storage space monthly.");
is("answers follow the survey's order", s.answers.map((a) => a.id), [
  "company", "items", "tracking", "find", "pull_time", "rebought", "problems", "importance", "price_points", "pay_model", "anything_else",
]);
is("no phone, email or leftovers", [s.phone, s.email, s.extras], [null, null, []]);

const m = readResponse(sm);
is("theater names are trimmed", m.theater, "Pacific Rep");
is("'What else?' joins its choice", m.answers.find((a) => a.id === "tracking").values, ["A spreadsheet (Excel or Google Sheets)", "Other: A whiteboard"]);
is("a half-filled grid shows only the rows answered", m.answers.find((a) => a.id === "importance").rows.length, 2);
is("phone and email", [m.phone, m.email], ["(831) 555-0142", "sm@example.com"]);
is("an answer to a question no longer asked is still shown", m.extras, [{ key: "pay", value: "maybe" }]);
is("an unknown choice value shows as it was stored", readResponse({ ...bare, answers: { role: "director", items: "lots" } }).answers[0].values, ["lots"]);
is("a bare response is just its role", [readResponse(bare).role, readResponse(bare).theater, readResponse(bare).answers], ["Director", null, []]);
is("'Other' left blank reads Other", roleOf({ role: "other", role_other: "  " }), "Other");
is("no role at all", roleOf({}), null);
is("broken answers don't throw", readResponse({ ...bare, answers: null }).answers, []);
is("a bad date is left as it was", formatReceived("yesterday"), "yesterday");

// ── Totals
const t = tally([scat, sm, bare]);
const byId = Object.fromEntries(t.map((x) => [x.id, x]));
is("every question but the theater and the comment", t.map((x) => x.id), QUESTIONS.map((q) => q.id).filter((id) => id !== "theater_name" && id !== "anything_else"));
is("roles counted, every choice listed", byId.role.counts.filter((c) => c.count).map((c) => [c.label, c.count]), [["Stage manager", 1], ["Director", 1], ["Other", 1]]);
is("all the role choices are there, even at 0", byId.role.counts.length, QUESTIONS.find((q) => q.id === "role").choices.length);
is("'Other' roles in their own words", byId.role.written, ["Board president/executive director"]);
is("several choices: each counted, answered counts people", [byId.problems.answered, byId.problems.counts.find((c) => c.label.startsWith("Couldn’t find")).count], [2, 2]);
is("'What else?' details listed", byId.tracking.written, ["A whiteboard"]);
is("a question nobody answered", [byId.rebought.answered, byId.pay_model.answered], [1, 1]);
is("grid counts per level", byId.importance.rows[0], { label: "Searching by name, material or color", counts: [0, 0, 2] });
is("grid: answered counts people, not rows", byId.importance.answered, 2);
is("written answers listed", byId.software_name, { id: "software_name", prompt: QUESTIONS.find((q) => q.id === "software_name").prompt, kind: "text", answered: 1, texts: ["Sortly"] });
is("no responses: all zeros", tally([]).every((x) => x.answered === 0), true);

// ── Price range
const one = priceRange([scat]);
is("one answer: $5–15 to $15–30", [one.answered, one.low, one.high], [1, "$5–15", "$15–30"]);
is("and its bargain", one.bargain, "$5–15");
is("too cheap at and below their band", one.bands.map((b) => b.tooCheap), [1, 0, 0, 0, 0, 0]);
is("too expensive at and above theirs", one.bands.map((b) => b.tooExpensive), [0, 0, 0, 1, 1, 1]);
const two = priceRange([scat, sm, bare]);
is("two answers (the bare one is left out)", two.answered, 2);
is("half is not 'fewer than half'", two.bands.map((b) => b.acceptable), [false, false, true, false, false, false]);
is("so the range is the one band", [two.low, two.high], ["$15–30", "$15–30"]);
is("bargain: the most named, earliest on a tie", two.bargain, "$5–15");
is("nobody answered: no range", priceRange([bare]), { answered: 0, bands: priceRange([bare]).bands, low: null, high: null, bargain: null });
is("half an answer doesn't count", priceRange([{ ...bare, answers: { price_points: { "too-cheap": "5-15" } } }]).answered, 0);

// ── Spreadsheet
const table = resultsTable([sm, scat]);
const head = table[0];
is("one row per response, after the headings", table.length, 3);
is("the first columns", head.slice(0, 3), ["Received", "Theater", "Role"]);
is("a column per grid row", head.filter((h) => h.startsWith("Monthly price that feels: ")).length, 4);
is("the last columns", head.slice(-4), ["Phone", "Email", "Other answers", "Survey"]);
is("every row is as wide as the headings", table.every((r) => r.length === head.length), true);
const col = (name) => head.indexOf(name);
is("choices joined with semicolons", table[1][col("Happened in the last year")], "Couldn’t find something we knew we had; Two shows needed the same item at once");
is("a grid cell", table[2][col("How important: Searching by name, material or color")], "Very");
is("an unanswered grid cell is empty", table[1][col("How important: A photo of every item")], "");
is("contact and leftovers", [table[1][col("Phone")], table[1][col("Email")], table[1][col("Other answers")]], ["(831) 555-0142", "sm@example.com", "pay: maybe"]);
is("no responses: just the headings", resultsTable([]).length, 1);

console.log(`\n════ ${pass} passed, ${fail} failed ════`);
if (fail) process.exit(1);
