// Tests for the CSV import parser. No test framework in this project, so:
//
//   node --experimental-strip-types src/lib/csv.test.mjs
//
// (Node 22+ strips the TypeScript from csv.ts on the fly.) These caught three
// real bugs when the importer was written: blank lines shifting the reported
// line numbers, multi-word headers like "Storage Location" never matching,
// and a "Prop" alias hijacking the name column.

import { parseCsv, guessMapping, parseItemsCsv, validateRow } from "./csv.ts";

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
  "Table,2,furniture,mint",          // unknown category + condition -> warnings only
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
console.log(`════ ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
