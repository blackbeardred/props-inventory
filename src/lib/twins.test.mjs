// Which items an item being deleted might be a duplicate of.
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/twins.test.mjs

import { MAX_TWIN_SUGGESTIONS, sameTwinName, suggestTwins, twinName, twinReason } from "./twins.ts";

let pass = 0, fail = 0;
function is(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label} — expected ${e}, got ${a}`); }
}

console.log("── twinName / sameTwinName");
is("case and spacing", sameTwinName("Brass  Candlestick", "brass candlestick"), true);
is("punctuation", sameTwinName("Chalice, pewter", "Chalice pewter"), true);
is("accents", sameTwinName("Café chair", "Cafe chair"), true);
is("& and 'and'", sameTwinName("Cup & saucer", "Cup and saucer"), true);
is("a copy number in brackets", sameTwinName("Crown (Prop) (2)", "Crown (Prop)"), true);
is("“copy” on the end", sameTwinName("Velvet cloak copy", "Velvet cloak"), true);
is("“(copy)” on the end", sameTwinName("Velvet cloak (copy)", "Velvet cloak"), true);
is("“Copy of …”", sameTwinName("Copy of Velvet cloak", "Velvet cloak"), true);
is("several markers at once", sameTwinName("Crown (copy) (2)", "Crown"), true);
is("a plain number is part of the name", sameTwinName("Chair 2", "Chair 3"), false);
is("…and so is a bracketed word", sameTwinName("Crown (Prop)", "Crown"), false);
is("different things", sameTwinName("Pewter tankard", "Pewter chalice"), false);
is("an empty name matches nothing", sameTwinName("", ""), false);
is("…nor one that's all punctuation", sameTwinName("—", "!"), false);
is("twinName itself", twinName("  Rug (Persian Style) "), "rug persian style");

console.log("");
console.log("── suggestTwins");
const item = { id: "a", name: "Brass candlestick" };
const others = [
  { id: "a", name: "Brass candlestick", locationName: "Shelf A" },
  { id: "b", name: "Brass Candlestick", locationName: "Shelf B" },
  { id: "c", name: "Candle holder", locationName: null },
  { id: "d", name: "Pewter tankard", locationName: "Loft" },
  { id: "e", name: "Brass candlestick (2)", locationName: "Loft" },
];
{
  const got = suggestTwins(item, others, [
    { id: "c", similarity: 0.94 },
    { id: "e", similarity: 0.97 },
    { id: "d", similarity: 0.6 },
    { id: "a", similarity: 1 },
  ]);
  is("never itself", got.some((s) => s.id === "a"), false);
  is("same name and same picture first, then same name, then picture alone", got.map((s) => s.id), ["e", "b", "c"]);
  is("a weak picture match isn't a twin", got.some((s) => s.id === "d"), false);
  is("reasons", got.map(twinReason), ["same name, and its photo looks just like this one", "same name", "its photo looks just like this one"]);
  is("the score is carried for picture matches", got.map((s) => s.similarity), [0.97, null, 0.94]);
}
is("nothing alike, nothing suggested", suggestTwins({ id: "z", name: "Fishing net" }, others), []);
is("no picture matches needed", suggestTwins(item, others).map((s) => s.id), ["b", "e"]);
{
  const many = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, name: "Bar stool", locationName: null }));
  is("capped", suggestTwins({ id: "x", name: "Bar Stool" }, many).length, MAX_TWIN_SUGGESTIONS);
}
is("an item listed twice is suggested once", suggestTwins(item, [others[1], others[1]]).length, 1);
is("exactly STRONG counts", suggestTwins({ id: "q", name: "Q" }, [{ id: "r", name: "R", locationName: null }], [{ id: "r", similarity: 0.9 }]).length, 1);
is("just under doesn't", suggestTwins({ id: "q", name: "Q" }, [{ id: "r", name: "R", locationName: null }], [{ id: "r", similarity: 0.899 }]).length, 0);

console.log("");
console.log(`════ ${pass} passed, ${fail} failed ════`);
if (fail > 0) process.exit(1);
