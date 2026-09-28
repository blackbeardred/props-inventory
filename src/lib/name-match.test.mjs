// When a name from a photo counts as the same thing as an inventory item.
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/name-match.test.mjs

import { looksLikeSameThing } from "./name-match.ts";

let pass = 0, fail = 0;
function is(label, actual, expected) {
  if (actual === expected) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label} — expected ${expected}, got ${actual}`); }
}

console.log("── Should pre-select");
is("same words, different case", looksLikeSameThing("pewter tankard", "Pewter tankard"), true);
is("plural against singular", looksLikeSameThing("pewter tankards", "Pewter tankard"), true);
is("punctuation ignored", looksLikeSameThing("yorick's skull", "Yoricks skull"), true);
is("word order doesn't matter", looksLikeSameThing("brass candlestick", "Candlestick, brass"), true);
is("noise words ignored", looksLikeSameThing("a pair of brass candlesticks", "Brass candlestick"), true);

console.log("");
console.log("── Should not pre-select");
is("vaguer than the item", looksLikeSameThing("chair", "Ladderback chair, carved oak"), false);
is("item is a different thing", looksLikeSameThing("tankard", "Tankard stand"), false);
is("only half the words", looksLikeSameThing("brass candlestick", "Brass door handle"), false);
is("nothing in common", looksLikeSameThing("fiddle", "Pewter tankard"), false);
is("empty seen name", looksLikeSameThing("", "Pewter tankard"), false);
is("empty item name", looksLikeSameThing("tankard", ""), false);
is("only noise words", looksLikeSameThing("the set", "Pewter tankard"), false);

console.log("");
console.log(`════ ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
