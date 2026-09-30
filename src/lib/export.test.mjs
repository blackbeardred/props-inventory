// What an export contains, and that the importer can read it back.
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/export.test.mjs

import { buildExportTable, exportHeadings } from "./export.ts";
import { toCsv, parseItemsCsv } from "./csv.ts";

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}\n        expected ${b}\n        actual   ${a}`); }
}

const PATHS = new Map([
  ["shake", "Props Room A / Shakespeare box"],
  ["rack", "Costume Storage / Rack 3"],
]);

const ITEMS = [
  {
    id: "1", name: "Yorick's skull", category: "prop", description: 'Cast resin, aged & "weathered"',
    photo_url: "org/1/a.jpg", quantity: 1, condition: "fair", location_id: "shake",
    created_at: "", auto_tags: ["bone"],
    import_data: { "Item #": "P-001", Donor: "Jane Pemberton" },
  },
  {
    id: "2", name: "Crimson cloak", category: "costume", description: null,
    photo_url: null, quantity: 2, condition: null, location_id: "rack",
    created_at: "", auto_tags: [],
    import_data: { "Item #": "P-002", "Insurance value": "£120" },
  },
  {
    id: "3", name: "Hand-typed chair", category: "prop", description: "Added through the form",
    photo_url: null, quantity: 4, condition: "needs_repair", location_id: null,
    created_at: "", auto_tags: [], import_data: {},
  },
];

console.log("── What an export carries");

const headings = exportHeadings(ITEMS, false);
eq("the app's own fields come first", headings.slice(0, 6),
   ["Name", "Category", "Quantity", "Condition", "Location", "Description"]);
eq("then every heading any item kept, first seen first", headings.slice(6),
   ["Item #", "Donor", "Insurance value"]);
eq("a photo column only when pictures are wanted",
   exportHeadings(ITEMS, true).includes("Photo"), true);

const table = buildExportTable(ITEMS, { pathById: PATHS });

eq("a row per item, plus the headings", table.length, 4);
eq("locations are full paths, not bare names", table[1][4], "Props Room A / Shakespeare box");
eq("conditions are written the way the app shows them", table[1][3], "Fair");
eq("an unset condition is blank rather than null", table[2][3], "");
eq("an unfiled item has an empty location", table[3][4], "");
eq("leftover columns line up with their headings", table[1].slice(6), ["P-001", "Jane Pemberton", ""]);
eq("an item missing one of them gets a blank there", table[2].slice(6), ["P-002", "", "£120"]);
eq("an item with none gets blanks throughout", table[3].slice(6), ["", "", ""]);

const withPhotos = buildExportTable(ITEMS, {
  pathById: PATHS,
  photoUrlByPath: new Map([["org/1/a.jpg", "https://example.test/signed/a.jpg"]]),
});
eq("a picture link where there's a picture", withPhotos[1][6], "https://example.test/signed/a.jpg");
eq("and a blank where there isn't", withPhotos[2][6], "");

console.log("");
console.log("── And back in through the importer");

const reread = parseItemsCsv(toCsv(table));

eq("every item comes back", reread.rows.length, 3);
eq("names survive", reread.rows.map((r) => r.name),
   ["Yorick's skull", "Crimson cloak", "Hand-typed chair"]);
eq("categories survive", reread.rows.map((r) => r.category), ["prop", "costume", "prop"]);
eq("quantities survive", reread.rows.map((r) => r.quantity), [1, 2, 4]);
eq("conditions survive the label round trip", reread.rows.map((r) => r.condition),
   ["fair", null, "needs_repair"]);
eq("locations survive as their full path", reread.rows[0].locationName, "Props Room A / Shakespeare box");
eq("a quoted description survives", reread.rows[0].description, 'Cast resin, aged & "weathered"');
eq("the leftover columns are kept as leftovers again", reread.rows[0].extra,
   { "Item #": "P-001", Donor: "Jane Pemberton" });
eq("nothing failed to import", reread.rows.flatMap((r) => r.errors), []);

console.log("");
console.log(`════ ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
