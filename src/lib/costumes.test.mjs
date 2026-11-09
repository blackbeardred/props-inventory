// Tests for costumes on pull lists. Run with:
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/costumes.test.mjs

import {
  MAX_COSTUME_NAME,
  arrangeList,
  costumeName,
  costumeShortName,
  costumeSummary,
  suggestPieces,
  suggestionNote,
} from "./costumes.ts";

let passed = 0;
let failed = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}\n        expected ${b}\n        actual   ${a}`); }
}

console.log("── Names");
eq("a character's name gets 'costume'", costumeName("Margaret"), "Margaret costume");
eq("one that says it already is kept", costumeName("Margaret Costume"), "Margaret Costume");
eq("so is a plural", costumeName("Chorus costumes"), "Chorus costumes");
eq("a word ending in 'costume' inside isn't enough", costumeName("Postcostumer"), "Postcostumer costume");
eq("spaces tidied", costumeName("  Harry   Beaton "), "Harry Beaton costume");
eq("blank is nothing", costumeName("   "), null);
eq("cut to the database's 80", costumeName("x".repeat(100)).length, MAX_COSTUME_NAME);
eq("short name for the checklist", costumeShortName("Margaret costume"), "Margaret");
eq("short name keeps a set's name", costumeShortName("Tea set"), "Tea set");
eq("a name that is only 'costume' stays", costumeShortName("Costume"), "Costume");

console.log("── Arranging a list");
const lines = [
  { id: "l1", item_id: "dress", group_id: "g1", status: "pulled", items: { category: "costume" } },
  { id: "l2", item_id: "fan", group_id: null, status: "pending", items: { category: "prop" } },
  { id: "l3", item_id: "corset", group_id: "g1", status: "pending", items: { category: "costume" } },
  { id: "l4", item_id: "hat", group_id: null, status: "pending", items: { category: "costume" } },
  { id: "l5", item_id: "kilt", group_id: "g2", status: "returned", items: { category: "costume" } },
  { id: "l6", item_id: "parasol", group_id: "g2", status: "pending", items: { category: "prop" } },
  { id: "l7", item_id: "gone", group_id: "g-deleted", status: "pending", items: { category: "costume" } },
];
const groups = [
  { id: "g2", name: "Harry costume", position: 1, created_at: "2026-11-02" },
  { id: "g1", name: "Margaret costume", position: 0, created_at: "2026-11-01" },
];
const arranged = arrangeList(lines, groups);
eq("costumes in their order", arranged.costumes.map((c) => c.group.name), ["Margaret costume", "Harry costume"]);
eq("each with its pieces, in order", arranged.costumes.map((c) => c.lines.map((l) => l.id)), [["l1", "l3"], ["l5", "l6"]]);
eq("a prop can be part of a costume", arranged.costumes[1].lines.map((l) => l.item_id), ["kilt", "parasol"]);
eq("loose costume pieces, including one whose costume has gone", arranged.loosePieces.map((l) => l.id), ["l4", "l7"]);
eq("props on their own", arranged.props.map((l) => l.id), ["l2"]);
eq("every line appears exactly once",
  [...arranged.costumes.flatMap((c) => c.lines), ...arranged.loosePieces, ...arranged.props].map((l) => l.id).sort(),
  lines.map((l) => l.id).sort());
eq("an empty costume still shows", arrangeList([], groups).costumes.length, 2);
eq("summary counts pulled and returned as pulled", costumeSummary(arranged.costumes[0].lines), { pieces: 2, pulled: 1 });
eq("and returned too", costumeSummary(arranged.costumes[1].lines), { pieces: 2, pulled: 1 });

console.log("── Suggestions from past shows");
// Brigadoon (now) has the dress. Two past shows had it too.
const H = (item_id, pull_list_id, production_id, group_id = null, status = "returned") => ({ item_id, pull_list_id, production_id, group_id, status });
const history = [
  // 2024: Margaret costume with dress, shawl, clogs; a lantern on the same list.
  H("dress", "pl-24", "show-24", "g-24"), H("shawl", "pl-24", "show-24", "g-24"), H("clogs", "pl-24", "show-24", "g-24"),
  H("lantern", "pl-24", "show-24"),
  // 2025: dress and shawl together again; the lantern again, loose; gloves in another costume.
  H("dress", "pl-25", "show-25", "g-25"), H("shawl", "pl-25", "show-25", "g-25"),
  H("lantern", "pl-25", "show-25"), H("gloves", "pl-25", "show-25", "g-25b"),
  // A show without the dress: nothing from it counts.
  H("sword", "pl-26", "show-26"), H("shawl", "pl-26", "show-26"),
  // Now: the dress is on Brigadoon's list, and the clogs are pulled right now for another show.
  H("dress", "pl-now", "brigadoon", "g-now", "pending"),
  H("clogs", "pl-other", "show-now", null, "pulled"),
];
const names = new Map([["g-24", "Margaret costume"], ["g-25", "Margaret costume"]]);
const got = suggestPieces(history, { seeds: ["dress"], production: "brigadoon", groupNames: names });
eq("best first: worn with it twice, then once, then only on the same list",
  got.map((s) => s.item_id), ["shawl", "clogs", "lantern", "gloves"]);
eq("the shawl: same costume in 2 shows", [got[0].sameCostume, got[0].sameList], [2, 2]);
eq("the lantern: never in the costume, on the list twice", [got[2].sameCostume, got[2].sameList], [0, 2]);
eq("it names the costume they were in", got[0].costume, "Margaret costume");
eq("and nothing for the lantern", got[2].costume, null);
eq("the clogs are pulled for another show right now", got.find((s) => s.item_id === "clogs").inUse, true);
eq("a show without the piece adds nothing (no sword)", got.some((s) => s.item_id === "sword"), false);
eq("never suggests the piece itself", got.some((s) => s.item_id === "dress"), false);
eq("skips what's on the list already",
  suggestPieces(history, { seeds: ["dress"], production: "brigadoon", skip: ["shawl"] }).map((s) => s.item_id),
  ["clogs", "lantern", "gloves"]);
eq("this show's own list isn't 'the past'",
  suggestPieces([H("dress", "p", "brigadoon", "g"), H("hat", "p", "brigadoon", "g")], { seeds: ["dress"], production: "brigadoon" }), []);
eq("no history, no suggestions", suggestPieces([], { seeds: ["dress"], production: "x" }), []);
eq("no seeds, no suggestions", suggestPieces(history, { seeds: [], production: "brigadoon" }), []);
eq("a limit", suggestPieces(history, { seeds: ["dress"], production: "brigadoon", limit: 2 }).length, 2);
eq("several seeds pool what they bring",
  suggestPieces(history, { seeds: ["dress", "sword"], production: "brigadoon" }).map((s) => s.item_id).includes("shawl"), true);

console.log("── The words beside a suggestion");
eq("worn with a named costume", suggestionNote(got[0]), "with Margaret costume, 2 shows");
eq("only on the same list", suggestionNote(got[2]), "2 shows");
eq("one show", suggestionNote({ item_id: "x", sameCostume: 0, sameList: 1, costume: null, inUse: false }), "1 show");

console.log("");
console.log(`════ ${passed} passed, ${failed} failed ════`);
process.exit(failed ? 1 : 0);
