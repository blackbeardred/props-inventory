// Rows already in the inventory, found before an import goes in.
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/import-duplicates.test.mjs

import { findAlreadyHere } from "./import-duplicates.ts";

let pass = 0, fail = 0;
function is(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label} — expected ${e}, got ${a}`); }
}

// Places by name: "A" and "Props Room A / A" are the same box; "Shed" doesn't
// exist yet.
const places = new Map([["a", "boxA"], ["props room a / a", "boxA"], ["b", "boxB"]]);
const resolve = (name) => (name === null ? null : places.get(name.trim().toLowerCase()));
const row = (line, name, locationName = null) => ({ line, name, locationName });
const item = (id, name, location_id = null) => ({ id, name, location_id });

const existing = [
  item("t1", "Silver Tray", "boxA"),
  item("c1", "Crown", null),
  item("l1", "Oil Lantern", "boxB"),
];

is("the same file again: everything is already here",
  findAlreadyHere([row(2, "Silver Tray", "A"), row(3, "Crown"), row(4, "Oil Lantern", "B")], existing, resolve),
  [{ line: 2, itemId: "t1" }, { line: 3, itemId: "c1" }, { line: 4, itemId: "l1" }]);

is("case, spacing and a place given by its path still match",
  findAlreadyHere([row(2, "  silver   TRAY ", "Props Room A / A")], existing, resolve),
  [{ line: 2, itemId: "t1" }]);

is("the same name in a different place is new",
  findAlreadyHere([row(2, "Silver Tray", "B")], existing, resolve), []);

is("the same name, filed vs unfiled, is new",
  findAlreadyHere([row(2, "Silver Tray")], existing, resolve), []);

is("a place that doesn't exist yet can't hold a duplicate",
  findAlreadyHere([row(2, "Crown", "Shed")], existing, resolve), []);

is("a new name is new",
  findAlreadyHere([row(2, "Velvet cloak", "A")], existing, resolve), []);

is("one-to-one: two trays in the sheet, one in the inventory",
  findAlreadyHere([row(2, "Silver Tray", "A"), row(3, "Silver Tray", "A")], existing, resolve),
  [{ line: 2, itemId: "t1" }]);

is("two in the inventory, two in the sheet: both found, each once",
  findAlreadyHere([row(2, "Cup", "B"), row(3, "Cup", "B")],
    [item("u1", "Cup", "boxB"), item("u2", "cup", "boxB")], resolve),
  [{ line: 2, itemId: "u1" }, { line: 3, itemId: "u2" }]);

is("a sheet with rows added: only the old rows are already here",
  findAlreadyHere([row(2, "Silver Tray", "A"), row(3, "Fan (Folding)", "A"), row(4, "Crown")], existing, resolve),
  [{ line: 2, itemId: "t1" }, { line: 4, itemId: "c1" }]);

is("an empty inventory has nothing already here",
  findAlreadyHere([row(2, "Silver Tray", "A")], [], resolve), []);

is("no rows, nothing found", findAlreadyHere([], existing, resolve), []);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
