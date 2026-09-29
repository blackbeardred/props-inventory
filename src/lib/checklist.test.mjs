// The walk-round-the-store rules. Run with:
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/checklist.test.mjs

import { groupByRoomAndContainer, findPullIssues } from "./checklist.ts";

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}\n        expected ${b}\n        actual   ${a}`); }
}

// Props Room A holds the Shakespeare box and the Crowns tin; the Shed holds
// the Weapons rack. One item sits directly in the room itself.
const LOCATIONS = [
  { id: "roomA", name: "Props Room A", parent_location_id: null },
  { id: "shake", name: "Shakespeare box", parent_location_id: "roomA" },
  { id: "crowns", name: "Crowns tin", parent_location_id: "roomA" },
  { id: "shed", name: "Shed", parent_location_id: null },
  { id: "weapons", name: "Weapons rack", parent_location_id: "shed" },
];

function row(id, name, locationId, checkState = "open", checkedAt = null) {
  return {
    id, itemId: `i-${id}`, name, quantityNeeded: 1,
    checkState, checkedAt, checkedByName: null, locationId,
  };
}

console.log("── Grouped by room, then box");

const grouped = groupByRoomAndContainer([
  row("1", "Rapier", "weapons"),
  row("2", "Yorick's skull", "shake"),
  row("3", "Crown, gold", "crowns"),
  row("4", "Candlestick", "shake"),
  row("5", "Floor cloth", "roomA"),
  row("6", "Unfiled lantern", null),
], LOCATIONS);

eq("rooms in alphabetical order, unfiled last",
  grouped.map((room) => room.name),
  ["Props Room A", "Shed", "Not filed anywhere"]);

eq("what's loose in the room comes before its boxes",
  grouped[0].containers.map((container) => container.name),
  ["Loose in the room", "Crowns tin", "Shakespeare box"]);

eq("items within a box are alphabetical",
  grouped[0].containers[2].rows.map((r) => r.name),
  ["Candlestick", "Yorick's skull"]);

eq("a box in another room stays with its room",
  grouped[1].containers.map((c) => c.name), ["Weapons rack"]);

eq("nothing is dropped",
  grouped.flatMap((room) => room.containers.flatMap((c) => c.rows)).length, 6);

eq("an unfiled item still gets a heading",
  grouped[2].containers[0].rows.map((r) => r.name), ["Unfiled lantern"]);

console.log("");
console.log("── What got walked past");

// Nothing checked yet: the whole list is simply not started.
eq("an untouched list has no issues",
  findPullIssues([row("1", "Rapier", "weapons"), row("2", "Skull", "shake")], LOCATIONS),
  []);

// Halfway through one box, with nothing else touched.
eq("the box you're standing in is not an issue",
  findPullIssues([
    row("1", "Skull", "shake", "checked", "2026-09-29T10:00:00Z"),
    row("2", "Candlestick", "shake"),
    row("3", "Rapier", "weapons"),
  ], LOCATIONS).map((issue) => issue.row.name),
  []);

// Started the Shakespeare box, left one behind, moved to the weapons rack.
const movedOn = findPullIssues([
  row("1", "Skull", "shake", "checked", "2026-09-29T10:00:00Z"),
  row("2", "Candlestick", "shake"),
  row("3", "Rapier", "weapons", "checked", "2026-09-29T10:20:00Z"),
  row("4", "Dagger", "weapons"),
  row("5", "Crown", "crowns"),
], LOCATIONS);

eq("what was left in the box you walked away from",
  movedOn.map((issue) => issue.row.name), ["Candlestick"]);
eq("and where to find it",
  movedOn[0].where, "Props Room A / Shakespeare box");
eq("the box you're in now is still quiet", movedOn.some((i) => i.row.name === "Dagger"), false);
eq("an untouched box is still quiet", movedOn.some((i) => i.row.name === "Crown"), false);

// Two boxes abandoned: the one left most recently comes first, because it's
// the one you can still walk back to.
const twoAbandoned = findPullIssues([
  row("1", "Skull", "shake", "checked", "2026-09-29T09:00:00Z"),
  row("2", "Candlestick", "shake"),
  row("3", "Crown", "crowns", "checked", "2026-09-29T09:30:00Z"),
  row("4", "Tiara", "crowns"),
  row("5", "Rapier", "weapons", "checked", "2026-09-29T10:00:00Z"),
], LOCATIONS);
eq("most recently abandoned first",
  twoAbandoned.map((issue) => issue.row.name), ["Tiara", "Candlestick"]);

// Clearing is how you say "not needed after all".
eq("a cleared row is never an issue",
  findPullIssues([
    row("1", "Skull", "shake", "checked", "2026-09-29T10:00:00Z"),
    row("2", "Candlestick", "shake", "cleared", "2026-09-29T10:01:00Z"),
    row("3", "Rapier", "weapons", "checked", "2026-09-29T10:20:00Z"),
  ], LOCATIONS),
  []);

// Coming back and finishing the box clears the warning by itself.
eq("finishing the box you left resolves it",
  findPullIssues([
    row("1", "Skull", "shake", "checked", "2026-09-29T10:00:00Z"),
    row("2", "Candlestick", "shake", "checked", "2026-09-29T10:30:00Z"),
    row("3", "Rapier", "weapons", "checked", "2026-09-29T10:20:00Z"),
  ], LOCATIONS),
  []);

// Unfiled items are their own "container" — walking away from them counts too.
eq("unfiled items can be walked past as well",
  findPullIssues([
    row("1", "Unfiled lantern", null, "checked", "2026-09-29T10:00:00Z"),
    row("2", "Unfiled rope", null),
    row("3", "Rapier", "weapons", "checked", "2026-09-29T10:20:00Z"),
  ], LOCATIONS).map((issue) => [issue.row.name, issue.where]),
  [["Unfiled rope", "Not filed anywhere"]]);

// A container whose location row has vanished shouldn't crash the walk.
eq("a missing location doesn't break grouping",
  groupByRoomAndContainer([row("1", "Orphan", "gone")], LOCATIONS)[0].name,
  "Not filed anywhere");

console.log("");
console.log(`════ ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
