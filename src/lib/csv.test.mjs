// Tests for the CSV import parser. No test framework in this project, so:
//
//   node --experimental-strip-types src/lib/csv.test.mjs
//
// (Node 22+ strips the TypeScript from csv.ts on the fly.) These caught three
// real bugs when the importer was written: blank lines shifting the reported
// line numbers, multi-word headers like "Storage Location" never matching,
// and a "Prop" alias hijacking the name column.

import { parseCsv, guessMapping, parseItemsCsv, validateRow, extraColumns, toCsv } from "./csv.ts";

let pass = 0, fail = 0;
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log("  PASS  " + label); pass++; }
  else { console.log(`  FAIL  ${label}\n        got      ${a}\n        expected ${e}`); fail++; }
};

console.log("── The parser itself");
eq("plain row", parseCsv("a,b,c"), [["a","b","c"]]);
eq("quoted comma", parseCsv('a,"b,c",d'), [["a","b,c","d"]]);
eq("escaped quote", parseCsv('a,"say ""hi""",c'), [["a",'say "hi"',"c"]]);
eq("newline inside quotes", parseCsv('a,"line1\nline2",c'), [["a","line1\nline2","c"]]);
eq("CRLF line endings", parseCsv("a,b\r\nc,d"), [["a","b"],["c","d"]]);
eq("lone CR", parseCsv("a,b\rc,d"), [["a","b"],["c","d"]]);
eq("BOM stripped", parseCsv("﻿name,qty"), [["name","qty"]]);
eq("trailing newline makes no phantom row", parseCsv("a,b\n"), [["a","b"]]);
eq("empty trailing field kept", parseCsv("a,b,"), [["a","b",""]]);
eq("blank line between rows", parseCsv("a\n\nb"), [["a"],[""],["b"]]);

console.log("");
console.log("── Header guessing");
eq("obvious headers", guessMapping(["Name","Qty","Shelf"]), ["name","quantity","location"]);
eq("messy spellings", guessMapping(["ITEM_NAME","Type","Storage Location"]), ["name","category","location"]);
eq("unknown column ignored", guessMapping(["Name","Insurance value"]), ["name", null]);
eq("duplicate targets: first wins", guessMapping(["Name","Title"]), ["name", null]);

console.log("");
console.log("── Whole files");
const good = parseItemsCsv([
  "name,category,quantity,condition,location,tags",
  "Yorick's skull,prop,1,fair,Shelf B,graveyard;hamlet",
  "Velvet cloak,costume,2,needs repair,Rack 3,velvet",
].join("\n"));
eq("2 rows parsed", good.rows.length, 2);
eq("no errors", good.rows.flatMap(r => r.errors), []);
eq("category mapped", good.rows.map(r => r.category), ["prop","costume"]);
eq("condition words normalised", good.rows.map(r => r.condition), ["fair","needs_repair"]);
eq("tags split on ;", good.rows[0].tags, ["graveyard","hamlet"]);
eq("line numbers are file lines", good.rows.map(r => r.line), [2,3]);

const messy = parseItemsCsv([
  "name,quantity,category,condition",
  ",3,prop,good",                    // no name -> error
  "Chair,zero,prop,good",            // bad quantity -> error
  "Table,2,furniture,gubbins",          // unknown category + condition -> warnings only
  "",                                 // blank line -> skipped entirely
  "Lamp,,,",                          // defaults
].join("\n"));
eq("blank line skipped", messy.rows.length, 4);
eq("missing name errors", messy.rows[0].errors, ["No name"]);
eq('bad quantity errors', messy.rows[1].errors, ['Quantity "zero" isn\'t a whole number of 1 or more']);
eq("unknown category is a warning, not an error", messy.rows[2].errors, []);
eq("both warnings collected", messy.rows[2].warnings.length, 2);
eq("defaults applied", [messy.rows[3].quantity, messy.rows[3].category, messy.rows[3].condition], [1,"prop",null]);

console.log("");
console.log("── Columns the sheet doesn't have, and reordering");
const reordered = parseItemsCsv("Shelf,Qty,Item\nRack 3,4,Foil");
eq("mapped regardless of order", [reordered.rows[0].name, reordered.rows[0].quantity, reordered.rows[0].locationName], ["Foil", 4, "Rack 3"]);
const nameOnly = parseItemsCsv("Name\nSkull");
eq("name-only sheet works", [nameOnly.rows[0].name, nameOnly.rows[0].quantity, nameOnly.rows[0].errors], ["Skull", 1, []]);
const noNameCol = parseItemsCsv("Description\nA thing");
eq("no name column: row errors", noNameCol.rows[0].errors, ["No name"]);

console.log("");
console.log("── Quoted description containing a comma (the classic)");
const q = parseItemsCsv('name,description\nSkull,"Cast resin, aged finish"');
eq("description kept whole", q.rows[0].description, "Cast resin, aged finish");

console.log("");
console.log("── Line numbers survive blank lines (regression)");
const withGaps = parseItemsCsv("name\nSkull\n\n\nChair\n\nTable");
eq("blanks dropped from results", withGaps.rows.map(r => r.name), ["Skull","Chair","Table"]);
eq("line numbers match the file", withGaps.rows.map(r => r.line), [2,5,7]);
const badLate = parseItemsCsv("name,quantity\nSkull,1\n\nChair,nope");
eq("error points at the real line", badLate.rows[1].line, 4);

console.log("");
console.log("── Multi-word headers");
eq("Storage Location", guessMapping(["Storage Location"]), ["location"]);
eq("Quantity on hand", guessMapping(["Quantity on hand"]), ["quantity"]);
eq("Item Name / Costume or Prop", guessMapping(["Item Name","Costume or Prop"]), ["name","category"]);
eq("still ignores nonsense", guessMapping(["Insurance value","Acquired"]), [null,null]);

console.log("");
console.log("── Reported bugs (100-prop import)");
// An "Item #" column was stealing the name field from the real Name column.
eq("Item # doesn't steal the name", guessMapping(["Item #","Name","Qty"]), [null,"name","quantity"]);
eq("Inventory No. ignored", guessMapping(["Inventory No.","Name"]), [null,"name"]);
eq("Item ID ignored", guessMapping(["Item ID","Item Name"]), [null,"name"]);
eq("plain 'Item' is still a name", guessMapping(["Item","Qty"]), ["name","quantity"]);
eq("exact beats contained", guessMapping(["Item Description","Name"]), ["description","name"]);

const cond = parseItemsCsv([
  "name,condition",
  "A,excellent",
  "B,Like New",
  "C,very good",
  "D,well used",
  "E,needs work",
  "F,mint",
  "G,gubbins",
].join("\n"));
eq("condition words understood", cond.rows.map(r => r.condition),
   ["new","new","good","fair","needs_repair","new",null]);
eq("only the unknown one warns", cond.rows.filter(r => r.warnings.length > 0).map(r => r.name), ["G"]);

const photos = parseItemsCsv([
  "name,image url",
  "A,https://example.com/a.jpg",
  "B,not-a-link",
  "C,",
].join("\n"));
eq("photo column recognised", photos.mapping, ["name","photo"]);
eq("good link kept", photos.rows[0].photoUrl, "https://example.com/a.jpg");
eq("bad link warns, doesn't fail the row", [photos.rows[1].photoUrl, photos.rows[1].errors.length, photos.rows[1].warnings.length], [null, 0, 1]);
eq("no link is fine", [photos.rows[2].photoUrl, photos.rows[2].warnings.length], [null, 0]);

console.log("");
console.log("── Columns no field matched");
// Nothing in a spreadsheet gets dropped: whatever the mapping doesn't use is
// kept on the item, keyed by its heading, and folded into what search matches.
const leftovers = parseItemsCsv([
  "Item #,Name,Qty,Donor,Acquired,Value,Notes",
  "P-001,Yorick's skull,1,Jane Pemberton,2026-01-05,£40,Fragile — handle by the jaw",
  "P-002,Brass candlestick,6,,,,",
].join("\n"));

// "Notes" is a description in disguise and gets mapped; the rest have no field.
eq("only the real fields are mapped", leftovers.mapping, [null,"name","quantity",null,null,null,"description"]);
eq("the rest are kept, keyed by heading", leftovers.rows[0].extra, {
  "Item #": "P-001",
  Donor: "Jane Pemberton",
  Acquired: "2026-01-05",
  Value: "£40",
});
eq("blank cells aren't kept as empty strings", leftovers.rows[1].extra, { "Item #": "P-002" });
eq("mapped columns never leak into it", Object.keys(leftovers.rows[0].extra).includes("Name"), false);
eq("the headings are listable for the preview", extraColumns(leftovers.headers, leftovers.mapping),
   ["Item #","Donor","Acquired","Value"]);

// A column with no heading can't be labelled, so it isn't kept.
const headless = parseItemsCsv(["name,,qty", "Chair,orphan,2"].join("\n"));
eq("an unheaded column is dropped", headless.rows[0].extra, {});

// Overriding the mapping by hand has to move a column in and out of the kept set.
const overridden = parseItemsCsv(
  ["Item #,Name,Notes", "P-003,Lantern,tin"].join("\n"),
  [null, "name", "description"]
);
eq("a column given a field stops being extra", overridden.rows[0].extra, { "Item #": "P-003" });
eq("and its value lands in that field instead", overridden.rows[0].description, "tin");

// Long values and runaway column counts are bounded before they reach jsonb.
const wide = parseItemsCsv([
  ["name", ...Array.from({ length: 40 }, (_, i) => `col${i}`)].join(","),
  ["Wide", ...Array.from({ length: 40 }, () => "x")].join(","),
].join("\n"));
eq("at most 30 leftover columns are kept", Object.keys(wide.rows[0].extra).length, 30);

const long = parseItemsCsv(["name,Provenance", `Long,${"y".repeat(900)}`].join("\n"));
eq("a very long value is truncated", long.rows[0].extra.Provenance.length, 500);

eq("validateRow without headers keeps nothing", validateRow(["Chair"], ["name"], 2).extra, {});

console.log("");
console.log("── Writing CSV back out");

// An export has to survive its own importer, or it's a one-way door.
const awkward = [
  ["name", "description", "location", "Insurance value"],
  ["Yorick's skull", 'Cast resin, aged & "weathered"', "Shelf B", "£40"],
  ["Rope, 30ft", "Coiled\nin a crate", "Shed", ""],
  ["  Padded name  ", "", "Rack 3", "0"],
  ["Comma, inside", "semi; colon", "", "1,200"],
];

const written = toCsv(awkward);
eq("what goes out comes back identical", parseCsv(written), awkward);
eq("only the fields that need quotes get them",
   written.split("\r\n")[0], "name,description,location,Insurance value");
eq("rows are separated by CRLF, which Excel prefers", written.includes("\r\n"), true);
eq("an embedded newline stays inside one field", parseCsv(written)[2][1], "Coiled\nin a crate");
eq("doubled quotes survive the trip", parseCsv(written)[1][1], 'Cast resin, aged & "weathered"');
eq("padding is preserved rather than trimmed away", parseCsv(written)[3][0], "  Padded name  ");
eq("an empty table writes as nothing", toCsv([]), "");

// And the real point: an export re-read by the importer gives the same items.
const roundTripped = parseItemsCsv(toCsv([
  ["Name", "Category", "Quantity", "Condition", "Location", "Description"],
  ["Pewter tankard", "prop", "12", "good", "Tableware Crate", "Dented, one handle loose"],
  ["Crimson cloak", "costume", "2", "needs repair", "Rack 3", 'Gold frogging, "stage left" tag'],
]));
eq("the importer reads an export cleanly", roundTripped.rows.map((r) => [r.name, r.category, r.quantity, r.condition, r.locationName]), [
  ["Pewter tankard", "prop", 12, "good", "Tableware Crate"],
  ["Crimson cloak", "costume", 2, "needs_repair", "Rack 3"],
]);
eq("descriptions survive the round trip", roundTripped.rows[1].description, 'Gold frogging, "stage left" tag');
eq("nothing errored on the way round", roundTripped.rows.flatMap((r) => r.errors), []);

console.log("");
console.log(`════ ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
