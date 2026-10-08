// Identical items in the same box show as one row: "Silver Tray (2)".
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/item-copies.test.mjs

import { copiesCount, groupCopies, sameNameKey } from "./item-copies.ts";

let pass = 0, fail = 0;
function is(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label} — expected ${e}, got ${a}`); }
}

// A room with a box in it, a room with nothing inside (like A on the live
// site), and a second box.
const places = [
  { id: "room", parent_location_id: null },
  { id: "box1", parent_location_id: "room" },
  { id: "box2", parent_location_id: "room" },
  { id: "A", parent_location_id: null },
];
const item = (id, name, location_id, category = "prop") => ({ id, name, category, location_id });
const ids = (groups) => groups.map((group) => group.map((i) => i.id));

is("two trays in the same box combine",
  ids(groupCopies([item("1", "Silver Tray", "box1"), item("2", "Silver Tray", "box1")], places)),
  [["1", "2"]]);

is("two trays in a room with no boxes in it combine (the trays in A)",
  ids(groupCopies([item("1", "Silver Tray", "A"), item("2", "Silver Tray", "A")], places)),
  [["1", "2"]]);

is("trays in different boxes stay separate",
  ids(groupCopies([item("1", "Silver Tray", "box1"), item("2", "Silver Tray", "box2")], places)),
  [["1"], ["2"]]);

is("trays loose in a room that has boxes stay separate",
  ids(groupCopies([item("1", "Silver Tray", "room"), item("2", "Silver Tray", "room")], places)),
  [["1"], ["2"]]);

is("a tray in the room and one in its box stay separate",
  ids(groupCopies([item("1", "Silver Tray", "room"), item("2", "Silver Tray", "box1")], places)),
  [["1"], ["2"]]);

is("unassigned trays stay separate",
  ids(groupCopies([item("1", "Silver Tray", null), item("2", "Silver Tray", null)], places)),
  [["1"], ["2"]]);

is("case and spacing don't matter",
  ids(groupCopies([item("1", "Silver Tray", "A"), item("2", "  silver   TRAY ", "A")], places)),
  [["1", "2"]]);

is("a different name stays separate",
  ids(groupCopies([item("1", "Silver Tray", "A"), item("2", "Silver Trays", "A")], places)),
  [["1"], ["2"]]);

is("a prop and a costume of the same name stay separate",
  ids(groupCopies([item("1", "Crown", "A"), item("2", "Crown", "A", "costume")], places)),
  [["1"], ["2"]]);

is("the group sits where its first item was, order otherwise kept",
  ids(groupCopies([
    item("1", "Silver Spotlight Prop", "A"),
    item("2", "Silver Tray", "A"),
    item("3", "Silver Throne Chair", "A"),
    item("4", "Silver Tray", "A"),
    item("5", "Silver Tray", "box1"),
  ], places)),
  [["1"], ["2", "4"], ["3"], ["5"]]);

is("four trays: F, B, A, A make three rows (the screenshot)",
  ids(groupCopies([
    item("f", "Silver Tray", "F"), item("b", "Silver Tray", "B"),
    item("a1", "Silver Tray", "A"), item("a2", "Silver Tray", "A"),
  ], [...places, { id: "B", parent_location_id: null }, { id: "F", parent_location_id: null }])),
  [["f"], ["b"], ["a1", "a2"]]);

is("a place filed under a box makes that box hold places, so it stops combining",
  ids(groupCopies([item("1", "Cup", "box1"), item("2", "Cup", "box1")],
    [...places, { id: "tin", parent_location_id: "box1" }])),
  [["1"], ["2"]]);

is("no items, no rows", groupCopies([], places), []);

is("same name key", sameNameKey("  Silver \t Tray "), "silver tray");

is("count is the number of trays", copiesCount([{ quantity: 1 }, { quantity: 1 }]), 2);
is("a copy that is itself ×2 counts twice", copiesCount([{ quantity: 2 }, { quantity: 1 }]), 3);
is("a zero or missing quantity still counts as one", copiesCount([{ quantity: 0 }, { quantity: 1 }]), 2);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
