// Tests for the school-theater helpers. Run with:
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/school.test.mjs

import {
  HANDOVER_DAYS,
  ONE_ACCOUNT,
  handoverExpires,
  handoverPath,
  isHandoverToken,
  listNames,
  othersToRemove,
  safeNext,
  schoolNotSetUp,
} from "./school.ts";

let passed = 0;
let failed = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}\n        expected ${b}\n        actual   ${a}`); }
}

console.log("── The message the database sends");
eq("matches migration 018 word for word", ONE_ACCOUNT, "School theatres have one account, the teacher's.");

console.log("── Handover links");
eq("a real token", isHandoverToken("0123456789abcdef0123456789abcdef"), true);
eq("too short", isHandoverToken("0123456789abcdef"), false);
eq("capitals aren't what the database makes", isHandoverToken("0123456789ABCDEF0123456789ABCDEF"), false);
eq("no path tricks", isHandoverToken("../../theatre0123456789abcdef0123"), false);
eq("the page it opens", handoverPath("abc"), "/handover/abc");
eq("lasts 7 days", HANDOVER_DAYS, 7);
eq("expires 7 days later, to the minute",
  handoverExpires(new Date("2026-11-09T20:00:00Z")).toISOString(), "2026-11-16T20:00:00.000Z");

console.log("── Who has to be removed first");
const members = [
  { user_id: "me", profiles: { full_name: "Tess" } },
  { user_id: "a", profiles: { full_name: " Pat " } },
  { user_id: "b", profiles: null },
  { user_id: "c", profiles: { full_name: "Jo" } },
];
eq("everyone but me, named", othersToRemove(members, "me"), ["Pat", "Unnamed member", "Jo"]);
eq("alone: nobody", othersToRemove([members[0]], "me"), []);
eq("one name", listNames(["Pat"]), "Pat");
eq("two names", listNames(["Pat", "Jo"]), "Pat and Jo");
eq("three names", listNames(["Pat", "Jo", "Sam"]), "Pat, Jo and Sam");
eq("none", listNames([]), "");
eq("blanks are skipped", listNames(["Pat", " ", "Jo"]), "Pat and Jo");

console.log("── Where to go after logging in");
eq("a page here", safeNext("/handover/abc", "/inventory"), "/handover/abc");
eq("nothing given", safeNext(undefined, "/inventory"), "/inventory");
eq("a full address elsewhere", safeNext("https://evil.example", "/inventory"), "/inventory");
eq("another site, written //", safeNext("//evil.example/x", "/inventory"), "/inventory");
eq("another site, written /\\", safeNext("/\\evil.example", "/inventory"), "/inventory");
eq("a relative path without the slash", safeNext("theatre", "/inventory"), "/inventory");

console.log("── Before migration 018 is run");
eq("PostgREST can't find the function", schoolNotSetUp({ code: "PGRST202", message: "x" }), true);
eq("said in words", schoolNotSetUp({ message: "Could not find the function public.set_school_mode(p_school)" }), true);
eq("a real refusal isn't that", schoolNotSetUp({ code: "P0001", message: ONE_ACCOUNT }), false);
eq("no error", schoolNotSetUp(null), false);

console.log("");
console.log(`════ ${passed} passed, ${failed} failed ════`);
process.exit(failed ? 1 : 0);
