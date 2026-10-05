// Recently Deleted's rules. Run with:
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/deleted-records.test.mjs

import {
  KEEP_DAYS,
  expiresAt,
  purgeBefore,
  daysLeft,
  deletedAgo,
  locationDetail,
  productionDetail,
  itemDetail,
  relinkPlan,
  orphanedPhotos,
} from "./deleted-records.ts";

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}\n        expected ${b}\n        actual   ${a}`); }
}

const deleted = "2026-10-01T12:00:00.000Z";

console.log("── keeping for 30 days");
eq("the user's choice: 30 days", KEEP_DAYS, 30);
eq("restorable until 30 days after", expiresAt(deleted).toISOString(), "2026-10-31T12:00:00.000Z");
eq("the purge cut-off is 30 days back", purgeBefore(new Date("2026-10-31T12:00:00.000Z")), deleted);
eq("on the day it's deleted: 30 days left", daysLeft(deleted, new Date("2026-10-01T12:00:01.000Z")), 30);
eq("an hour before the end: 1 day left, not 0", daysLeft(deleted, new Date("2026-10-31T11:00:00.000Z")), 1);
eq("after the end: 0, never negative", daysLeft(deleted, new Date("2026-11-05T00:00:00.000Z")), 0);
eq("deleted earlier today", deletedAgo(deleted, new Date("2026-10-01T20:00:00.000Z")), "today");
eq("deleted yesterday", deletedAgo(deleted, new Date("2026-10-02T13:00:00.000Z")), "yesterday");
eq("deleted days ago", deletedAgo(deleted, new Date("2026-10-04T13:00:00.000Z")), "3 days ago");

console.log("── what the list says about each");
eq("a place with shelves and items", locationDetail(2, 1), "2 places and 1 item were in it");
eq("a place with only items", locationDetail(0, 3), "3 items were in it");
eq("an empty place says nothing", locationDetail(0, 0), null);
eq("a production with lists", productionDetail(2, 14), "2 pull lists, 14 lines");
eq("a production with none says nothing", productionDetail(0, 0), null);
eq("an item: where it was kept", itemDetail("Props Room A / A", 0), "Props Room A / A");
eq("…and what it was on", itemDetail("Props Room A / A", 1), "Props Room A / A · on 1 pull list");
eq("an unfiled item", itemDetail(null, 0), "Unassigned");

console.log("── restoring a place: only what's still where the delete left it goes back");
const plan = relinkPlan(["shelfA", "shelfB", "shelfC"], ["it1", "it2", "it3"], {
  locations: [
    { id: "shelfA", parent_location_id: null }, // still at the top level
    { id: "shelfB", parent_location_id: "roomB" }, // filed elsewhere since
    // shelfC has since been deleted itself
  ],
  items: [
    { id: "it1", location_id: null }, // still unassigned
    { id: "it2", location_id: "loft" }, // given a new home since
    { id: "it3", location_id: null },
  ],
});
eq("shelves still at the top level go back inside", plan.childIds, ["shelfA"]);
eq("items still unassigned go back in", plan.itemIds, ["it1", "it3"]);
eq("and it counts what stays put: moved on since, or gone", plan.movedOn, 3);
eq("nothing to relink, nothing done", relinkPlan([], [], { locations: [], items: [] }), { childIds: [], itemIds: [], movedOn: 0 });

console.log("── which photos a purge may remove");
eq("paths no item uses any more", orphanedPhotos(["org/a.jpg", "org/b.jpg"], ["org/b.jpg"]), ["org/a.jpg"]);
eq("each once, and never an empty path", orphanedPhotos(["org/a.jpg", "org/a.jpg", ""], []), ["org/a.jpg"]);
eq("none when everything is still in use", orphanedPhotos(["x"], ["x"]), []);

console.log("");
console.log(`════ ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
