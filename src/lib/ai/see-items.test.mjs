// What the photo reader has to survive from the model. Run with:
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/ai/see-items.test.mjs
//
// The API call itself isn't tested here — that needs a key and a bill. What is
// tested is everything between the reply and the review screen, which is where
// a bad response would otherwise become a bad inventory. The parsing lives in
// its own module so this doesn't drag in sharp, whose native binary only loads
// on the platform that installed it.

import { parseSeenObjects } from "./see-items-parse.ts";

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}\n        expected ${b}\n        actual   ${a}`); }
}

console.log("── A normal reply");

const normal = parseSeenObjects(JSON.stringify([
  { name: "pewter tankard", search: "tankard pewter", quantity: 4, box: { x: 12, y: 40, width: 26, height: 30 } },
  { name: "brass candlestick", search: "candlestick brass", quantity: 1, box: { x: 50, y: 20, width: 10, height: 40 }, note: "half hidden behind the chair" },
]));

eq("both objects read", normal.length, 2);
eq("names kept as written", normal[0].name, "pewter tankard");
eq("counts kept", normal[0].quantity, 4);
eq("boxes kept", normal[1].box, { x: 50, y: 20, width: 10, height: 40 });
eq("notes kept", normal[1].note, "half hidden behind the chair");
eq("no note means null, not undefined", normal[0].note, null);

console.log("");
console.log("── Replies that aren't quite right");

eq("fenced json still parses", parseSeenObjects('```json\n[{"name":"lantern","search":"lantern","quantity":1}]\n```').length, 1);
eq("prose instead of json gives nothing", parseSeenObjects("I can see a lantern and two chairs."), []);
eq("an object instead of an array gives nothing", parseSeenObjects('{"name":"lantern"}'), []);
eq("an empty array is fine", parseSeenObjects("[]"), []);

const messy = parseSeenObjects(JSON.stringify([
  { search: "chair", quantity: 2 },                      // no name at all
  { name: "   ", search: "x" },                           // name is whitespace
  { name: "stool", quantity: "three" },                   // count isn't a number
  { name: "crate", quantity: -4 },                        // count is nonsense
  { name: "lamp", quantity: 2.7 },                        // count isn't whole
  { name: "rug" },                                        // nothing but a name
  "a sword",                                              // not an object
  null,
]));

eq("only the usable rows survive", messy.map((object) => object.name), ["stool", "crate", "lamp", "rug"]);
eq("an unreadable count falls back to one", messy[0].quantity, 1);
eq("a negative count falls back to one", messy[1].quantity, 1);
eq("a fractional count is floored", messy[2].quantity, 2);
eq("search words fall back to the name", messy[3].search, "rug");

console.log("");
console.log("── Boxes");

const boxes = parseSeenObjects(JSON.stringify([
  { name: "a", search: "a", box: { x: 90, y: 90, width: 40, height: 40 } },   // runs off the edge
  { name: "b", search: "b", box: { x: 10, y: 10, width: 0, height: 20 } },    // no width
  { name: "c", search: "c", box: { x: -5, y: 10, width: 20, height: 20 } },   // negative origin
  { name: "d", search: "d", box: "over there" },                              // not a box
  { name: "e", search: "e" },                                                 // no box
]));

eq("an overflowing box is trimmed to the edge", boxes[0].box, { x: 90, y: 90, width: 10, height: 10 });
eq("a zero-width box is dropped", boxes[1].box, null);
eq("a negative origin is clamped", boxes[2].box, { x: 0, y: 10, width: 20, height: 20 });
eq("a box that isn't one is dropped", boxes[3].box, null);
eq("no box is null", boxes[4].box, null);

console.log("");
console.log("── Bounds");

const long = "x".repeat(500);
const bounded = parseSeenObjects(JSON.stringify([
  { name: long, search: long, quantity: 99999, note: long },
]));
eq("names are bounded", bounded[0].name.length, 80);
eq("search words are bounded", bounded[0].search.length, 60);
eq("notes are bounded", bounded[0].note.length, 160);
eq("counts are bounded", bounded[0].quantity, 999);

const many = parseSeenObjects(
  JSON.stringify(Array.from({ length: 60 }, (_, index) => ({ name: `thing ${index}`, search: "thing" })))
);
eq("a runaway list is capped at something reviewable", many.length, 40);

eq("search words are lowercased", parseSeenObjects('[{"name":"Brass Lamp","search":"Brass LAMP"}]')[0].search, "brass lamp");

console.log("");
console.log(`════ ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
