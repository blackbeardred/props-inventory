// The locations tree, and finding something in it.
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/locations.test.mjs

import {
  locationPaths,
  buildLocationChoices,
  buildLocationTree,
  flattenLocationTree,
  matchLocations,
  normalizeForSearch,
} from "./locations.ts";

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}\n        expected ${b}\n        actual   ${a}`); }
}
function ok(label, condition, detail = "") {
  if (condition) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`); }
}

const node = (id, name, parent = null) => ({ id, name, parent_location_id: parent });

const ROWS = [
  node("loft", "Costume Loft"),
  node("rack", "Rack 3", "loft"),
  node("hats", "Hat bin 11", "rack"),
  node("room", "Props Room A"),
  node("shelf", "Shelf 3", "room"),
  node("shake", "Shakespeare box", "shelf"),
  node("crowns", "Crowns tin", "shake"),
  node("tools", "Tools box", "room"),
  node("cafe", "Café crate", "room"),
];

console.log("── The shape of the tree");

const tree = buildLocationTree(ROWS);
eq("two rooms at the top, alphabetical", tree.map((t) => t.name), ["Costume Loft", "Props Room A"]);
eq("a room's own children, alphabetical, and nothing deeper",
   tree[1].children.map((c) => c.name), ["Café crate", "Shelf 3", "Tools box"]);
eq("and theirs, in turn",
   tree[1].children[1].children.map((c) => c.name), ["Shakespeare box"]);

const flat = flattenLocationTree(tree);
eq("flattened parents-before-children", flat.map((n) => n.name), [
  "Costume Loft", "Rack 3", "Hat bin 11",
  "Props Room A", "Café crate", "Shelf 3", "Shakespeare box", "Crowns tin", "Tools box",
]);

const byId = Object.fromEntries(flat.map((n) => [n.id, n]));
eq("a full path, for showing what was chosen", byId.crowns.path,
   "Props Room A / Shelf 3 / Shakespeare box / Crowns tin");
eq("a trail of ids, for opening the picker where the chosen thing lives",
   byId.crowns.trail, ["room", "shelf", "shake"]);
eq("a room's trail is empty", byId.room.trail, []);

console.log("");
console.log("── Rows the schema allows but nobody wants");

const ORPHAN = [node("a", "Room"), node("b", "Box", "missing")];
const orphanTree = buildLocationTree(ORPHAN);
eq("a box whose room is gone still appears, at the top",
   orphanTree.map((t) => t.name), ["Box", "Room"]);
eq("and its path is just itself", orphanTree[0].path, "Box");

// parent_location_id is a nullable self-reference, so the database permits this.
const CYCLE = [node("x", "X", "y"), node("y", "Y", "x"), node("z", "Z", "x")];
const cycleTree = buildLocationTree(CYCLE);
ok("a cycle returns rather than hanging", Array.isArray(cycleTree));
eq("every row still appears exactly once",
   flattenLocationTree(cycleTree).map((n) => n.id).sort(), ["x", "y", "z"]);
ok("and the result is a tree: nothing is its own ancestor", (() => {
  const seen = new Set();
  const walk = (list) => list.every((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return walk(n.children);
  });
  return walk(cycleTree);
})());

const SELF = [node("s", "Self", "s")];
eq("a row that is its own parent is a root", buildLocationTree(SELF).map((t) => t.path), ["Self"]);

eq("no rows, no tree", buildLocationTree([]), []);

console.log("");
console.log("── Typing to find one");

eq("a word anywhere in the path",
   matchLocations(flat, "shakespeare").map((n) => n.name), ["Shakespeare box", "Crowns tin"]);
eq("the thing named beats the things inside it",
   matchLocations(flat, "props room")[0].name, "Props Room A");
eq("several words, in any order, matching different parts",
   matchLocations(flat, "crowns shake").map((n) => n.path),
   ["Props Room A / Shelf 3 / Shakespeare box / Crowns tin"]);
eq("accents don't have to be typed", matchLocations(flat, "cafe").map((n) => n.name), ["Café crate"]);
eq("nor spelled out", matchLocations(flat, "café").map((n) => n.name), ["Café crate"]);
eq("case doesn't matter", matchLocations(flat, "HAT BIN").map((n) => n.name), ["Hat bin 11"]);
eq("nothing typed, nothing offered", matchLocations(flat, "   "), []);
eq("no match is empty, not everything", matchLocations(flat, "trombone"), []);

eq("normalizing is just case and accents", normalizeForSearch("Café CRÈME"), "cafe creme");

console.log("");
console.log("── The flat list still works, for the places that use it");

const choices = buildLocationChoices(ROWS);
eq("same number of rows", choices.length, ROWS.length);
eq("paths agree with the tree's",
   choices.find((c) => c.id === "crowns").path, byId.crowns.path);

console.log("");
console.log("── locationPaths");
const paths = locationPaths(ROWS);
eq("one path per location", paths.size, ROWS.length);
eq("a nested box gets its full path", paths.get("crowns"), byId.crowns.path);
eq("two locations with the same name are told apart",
   locationPaths([
     { id: "a", name: "Props Room A", parent_location_id: null },
     { id: "b", name: "Props Room B", parent_location_id: null },
     { id: "a1", name: "B", parent_location_id: "a" },
     { id: "b1", name: "B", parent_location_id: "b" },
   ]).get("b1"), "Props Room B / B");

console.log("");
console.log(`════ ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
