// Why a search result is there when its name doesn't say.
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/search-reason.test.mjs

import { describeMatch, matchReasons } from "./search-reason.ts";

let pass = 0, fail = 0;
function is(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label} — expected ${e}, got ${a}`); }
}

const item = (name, description = null, importData = null) => ({ name, description, importData });

console.log("── Names that explain themselves");
is("word in the name", describeMatch(item("Antique Brass Broom"), ["brass"]), null);
is("prefix of a word in the name", describeMatch(item("Oil Lantern"), ["lant"]), null);
is("plural in the name", describeMatch(item("Brass candlesticks"), ["candlestick"]), null);
is("case and accents ignored", describeMatch(item("Café chair"), ["CAFE"]), null);
is("no terms, nothing to explain", describeMatch(item("Tea Set"), []), null);
is("blank term ignored", describeMatch(item("Tea Set"), ["  "]), null);

console.log("");
console.log("── Where else it matched");
is("in the description", matchReasons(item("Tea Set", "Brass-handled pot, four cups"), ["brass"]),
  [{ term: "brass", reason: "notes" }]);
is("in the spreadsheet columns", matchReasons(item("Tea Set", null, { "Inventory No.": "P-014" }), ["p"]),
  [{ term: "p", reason: "spreadsheet" }]);
is("nowhere visible: the hidden tags", matchReasons(item("Silver Tray", "Polished."), ["brass"]),
  [{ term: "brass", reason: "what-it-is" }]);
is("notes win over spreadsheet when both have it",
  matchReasons(item("Tray", "brass edge", { Donor: "Brass family" }), ["brass"])[0].reason, "notes");
is("only the words the name doesn't cover",
  matchReasons(item("Brass tray", "wooden handles"), ["brass", "wood"]),
  [{ term: "wood", reason: "notes" }]);
is("a word partway into another isn't a match", matchReasons(item("Seabrass"), ["brass"])[0].reason, "what-it-is");

console.log("");
console.log("── The line shown");
is("one reason", describeMatch(item("Tea Set", "brass pot"), ["brass"]), "“brass” in its notes");
is("two reasons", describeMatch(item("Tray", "wooden"), ["wood", "metal"]),
  "“wood” in its notes · “metal” by what it is or is made of");

console.log("");
console.log(`════ ${pass} passed, ${fail} failed ════`);
if (fail > 0) process.exit(1);
