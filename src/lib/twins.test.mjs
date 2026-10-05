// Twins: which items to suggest, how links join sets, and which twin a photo marks.
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/twins.test.mjs

import {
  MAX_TWIN_SUGGESTIONS,
  linkPlan,
  pickFreeTwins,
  sameTwinName,
  suggestTwins,
  twinName,
  twinReason,
  twinsByItem,
} from "./twins.ts";

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
console.log("── linkPlan");
let n = 0;
const fresh = () => `set${++n}`;
is("two loners start a new set", linkPlan({ id: "a", set: null }, { id: "b", set: null }, fresh),
  { set: "set1", rows: [{ item_id: "a", twin_set: "set1" }, { item_id: "b", twin_set: "set1" }] });
is("a loner joins the other's set", linkPlan({ id: "a", set: null }, { id: "b", set: "S" }, fresh),
  { set: "S", rows: [{ item_id: "a", twin_set: "S" }, { item_id: "b", twin_set: "S" }] });
is("…from either side", linkPlan({ id: "a", set: "S" }, { id: "b", set: null }, fresh).set, "S");
is("two sets become one, b's members moving into a's",
  linkPlan({ id: "a", set: "S" }, { id: "b", set: "T", members: ["b", "c"] }, fresh),
  { set: "S", rows: [{ item_id: "a", twin_set: "S" }, { item_id: "b", twin_set: "S" }, { item_id: "c", twin_set: "S" }] });
is("already twins: nothing to write", linkPlan({ id: "a", set: "S" }, { id: "b", set: "S" }, fresh).rows, []);
is("an item can't be its own twin", linkPlan({ id: "a", set: null }, { id: "a", set: null }, fresh).rows, []);
is("no new set made when none was needed", n, 1);

console.log("");
console.log("── twinsByItem");
{
  const got = twinsByItem([
    { item_id: "c6", twin_set: "S" },
    { item_id: "c5", twin_set: "S" },
    { item_id: "x", twin_set: "T" },
  ]);
  is("each member maps to the whole set, sorted", got.get("c6"), ["c5", "c6"]);
  is("…the same list from either twin", got.get("c5"), ["c5", "c6"]);
  is("a set of one (its twin was deleted) is just itself", got.get("x"), ["x"]);
  is("an item with no set isn't listed", got.has("y"), false);
}

console.log("");
console.log("── pickFreeTwins");
{
  const twins = new Map([["c5", ["c5", "c6"]], ["c6", ["c5", "c6"]]]);
  const row = (key, itemId, locked = false) => ({ key, itemId, locked });
  const pick = (rows, busy = []) => Object.fromEntries(pickFreeTwins(rows, twins, new Set(busy)));
  is("a free item is left alone", pick([row("r1", "c5")]), { r1: "c5" });
  is("an item in use gives way to its free twin", pick([row("r1", "c5")], ["c5"]), { r1: "c6" });
  is("two rows naming the same item get one twin each (the photo shows both)",
    pick([row("r1", "c5"), row("r2", "c5")]), { r1: "c5", r2: "c6" });
  is("all twins taken: the row keeps what it had", pick([row("r1", "c5")], ["c5", "c6"]), { r1: "c5" });
  is("a third row with both taken keeps its choice", pick([row("r1", "c5"), row("r2", "c5"), row("r3", "c6")]),
    { r1: "c5", r2: "c6", r3: "c6" });
  is("the reviewer's own choice is never changed, even if in use",
    pick([row("r1", "c5", true)], ["c5"]), { r1: "c5" });
  is("…and it counts as taken, whatever its order",
    pick([row("r1", "c6"), row("r2", "c6", true)]), { r1: "c5", r2: "c6" });
  is("an item without twins is never swapped", pick([row("r1", "t")], ["t"]), { r1: "t" });
  is("skip and new rows stay as they are", pick([row("r1", null)]), { r1: null });
  is("the busy set passed in isn't changed", (() => { const b = new Set(["c5"]); pickFreeTwins([row("r1", "c5")], twins, b); return [...b]; })(), ["c5"]);
}

console.log("");
console.log(`════ ${pass} passed, ${fail} failed ════`);
if (fail > 0) process.exit(1);
