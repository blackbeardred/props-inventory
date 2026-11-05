// Tests for the .xlsx writer. Run with:
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/xlsx-write.test.mjs
//
// The writer's output is machine-readable, so it's read back rather than
// looked at: by this app's own .xlsx reader (the importer), and part by part
// as XML. A workbook that merely "looks like" a workbook is the failure this
// guards against: Excel won't say what's wrong, it just offers to repair it.

import { buildXlsx, cleanSheetName, columnName, escapeXml, XLSX_CONTENT_TYPE } from "./xlsx-write.ts";
import { parseXlsx } from "./xlsx.ts";
import { readZip } from "./zip.ts";
import { buildExportTable } from "./export.ts";
import { parseItemsTable } from "./csv.ts";

let passed = 0;
let failed = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}\n        expected ${b}\n        actual   ${a}`); }
}
function ok(label, value) { eq(label, Boolean(value), true); }

const decoder = new TextDecoder();
function parts(bytes) {
  return Object.fromEntries(readZip(bytes).map((p) => [p.name, decoder.decode(p.data)]));
}
const asBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
/** The reader leaves out empty cells at the end of a row; so does the writer. */
const trimRow = (row) => { const r = [...row]; while (r.length && r[r.length - 1] === "") r.pop(); return r; };

console.log("── Small pieces");
eq("column letters", [0, 25, 26, 51, 52, 701, 702].map(columnName), ["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
eq("XML specials are escaped", escapeXml(`a & b < c > "d"`), "a &amp; b &lt; c &gt; &quot;d&quot;");
eq("characters XML can't hold are dropped", escapeXml("form\u000Cfeed\u0000"), "formfeed");
eq("ordinary line breaks and tabs are kept", escapeXml("one\ntwo\tthree"), "one\ntwo\tthree");
eq("emoji survive escaping", escapeXml("🎭 mask"), "🎭 mask");
eq("a sheet name loses what Excel forbids", cleanSheetName("Props: [Room A] / 2026?"), "Props Room A 2026");
eq("and is cut to 31 characters", cleanSheetName("x".repeat(40)).length, 31);
eq("a blank one becomes Sheet1", cleanSheetName("  "), "Sheet1");
eq("the download's type", XLSX_CONTENT_TYPE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

console.log("── The package");
const rows = [
  ["Name", "Quantity", "Description", "Photo"],
  ["Yorick's skull", "1", 'Cast resin, aged & "weathered"', "https://example.test/a.jpg?token=x&y=1"],
  ["Crimson cloak", "12", "Line one\nLine two", ""],
  ["=SUM(A1:A9)", "007", "<b>not markup</b>", "not a link"],
  ["  Spaced  ", "", "🎭 Comedy mask", ""],
];
const bytes = buildXlsx({ name: "Inventory", rows, numberColumns: [1], linkColumns: [3] });
const p = parts(bytes);

ok("it's a ZIP", bytes[0] === 0x50 && bytes[1] === 0x4b);
eq("with the parts Excel needs, content types first",
  readZip(bytes).map((e) => e.name),
  ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels",
   "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/_rels/sheet1.xml.rels"]);
ok("every part named in the content types exists",
  [...p["[Content_Types].xml"].matchAll(/PartName="\/([^"]+)"/g)].every(([, name]) => name in p));
ok("every relationship points at a part that exists",
  [...p["xl/_rels/workbook.xml.rels"].matchAll(/Target="([^"]+)"/g)].every(([, t]) => `xl/${t}` in p));

const sheet = p["xl/worksheets/sheet1.xml"];
ok("the sheet's elements are in the order the schema demands",
  ["<dimension", "<sheetViews", "<sheetFormatPr", "<cols", "<sheetData", "<autoFilter", "<hyperlinks", "<pageMargins"]
    .map((tag) => sheet.indexOf(tag)).every((at, i, all) => at >= 0 && (i === 0 || at > all[i - 1])));
ok("the heading row is frozen", sheet.includes('state="frozen"') && sheet.includes('ySplit="1"'));
ok("and filterable", sheet.includes('<autoFilter ref="A1:D5"/>'));
ok("and the filter has the hidden name Excel needs", p["xl/workbook.xml"].includes("_xlnm._FilterDatabase"));
ok("the heading row is bold", /<c r="A1" s="1" t="inlineStr">/.test(sheet));
ok("a quantity is a number, so it adds up", sheet.includes('<c r="B2"><v>1</v></c>') && sheet.includes('<c r="B3"><v>12</v></c>'));
ok("but 007 stays text, so it isn't turned into 7", /<c r="B4" t="inlineStr"><is><t xml:space="preserve">007<\/t>/.test(sheet));
ok("a name starting with = is text, never a formula", !sheet.includes("<f>") && sheet.includes("=SUM(A1:A9)"));
ok("markup in a description is escaped, not obeyed", sheet.includes("&lt;b&gt;not markup&lt;/b&gt;"));
ok("a description with line breaks wraps", /<c r="C3" s="3" t="inlineStr">/.test(sheet));
ok("an empty cell is left out rather than written empty", !sheet.includes('r="B5"'));
ok("a picture link is clickable", sheet.includes('<hyperlink ref="D2" r:id="rId1"/>') && /<c r="D2" s="2"/.test(sheet));
ok("and its address is escaped in the relationship",
  p["xl/worksheets/_rels/sheet1.xml.rels"].includes('Target="https://example.test/a.jpg?token=x&amp;y=1" TargetMode="External"'));
ok("text that isn't an address isn't made a link", !sheet.includes('ref="D4"'));
ok("long link columns are capped in width", /<col min="4" max="4" width="24"/.test(sheet));

console.log("── Read back by the importer's own reader");
const { table } = await parseXlsx(asBuffer(bytes));
eq("every row comes back", table.length, rows.length);
eq("headings intact", table[0], rows[0]);
eq("quotes and ampersands survive", table[1][2], 'Cast resin, aged & "weathered"');
eq("line breaks survive", table[2][2], "Line one\nLine two");
eq("a number comes back as the same digits", table[2][1], "12");
eq("007 comes back as 007", table[3][1], "007");
eq("emoji survive", table[4][2], "🎭 Comedy mask");
eq("the link text comes back as the address", table[1][3], "https://example.test/a.jpg?token=x&y=1");

console.log("── Edges");
const huge = buildXlsx({ name: "Big", rows: [["Notes"], ["x".repeat(40000)]] });
const hugeBack = (await parseXlsx(asBuffer(huge))).table[1][0];
eq("a cell over Excel's 32,767-character limit is cut to fit", hugeBack.length, 32767);
ok("and marked as cut", hugeBack.endsWith("…"));
const plain = parts(buildXlsx({ name: "Plain", rows: [["Name"], ["Cane"]] }));
ok("no links means no link relationships part", !("xl/worksheets/_rels/sheet1.xml.rels" in plain));
ok("no hyperlinks element either", !plain["xl/worksheets/sheet1.xml"].includes("<hyperlinks"));
const quote = parts(buildXlsx({ name: "Shakespeare's props", rows: [["Name"], ["Cane"]] }));
ok("an apostrophe in the sheet name is doubled in the filter's reference",
  quote["xl/workbook.xml"].includes("&apos;") || quote["xl/workbook.xml"].includes("'Shakespeare''s props'!"));
let threw = "";
try { buildXlsx({ name: "Empty", rows: [] }); } catch (e) { threw = e.message; }
eq("an empty sheet is refused with a sentence", threw, "Nothing to put in the spreadsheet.");

console.log("── An export, through the importer, unchanged");
const PATHS = new Map([["shake", "Props Room A / Shakespeare box"], ["rack", "Costume Storage / Rack 3"]]);
const ITEMS = [
  { id: "1", name: "Yorick's skull", category: "prop", description: 'Cast resin, aged & "weathered"',
    photo_url: "org/1/a.jpg", quantity: 1, condition: "fair", location_id: "shake", created_at: "",
    auto_tags: [], import_data: { "Item #": "P-001", Donor: "Jane Pemberton" } },
  { id: "2", name: "Crimson cloak", category: "costume", description: null, photo_url: null,
    quantity: 2, condition: null, location_id: "rack", created_at: "", auto_tags: [],
    import_data: { "Item #": "007", "Insurance value": "£120" } },
  { id: "3", name: "Hand-typed chair", category: "prop", description: "Added through the form",
    photo_url: null, quantity: 4, condition: "needs_repair", location_id: null, created_at: "",
    auto_tags: [], import_data: {} },
];
const exported = buildExportTable(ITEMS, {
  pathById: PATHS,
  photoUrlByPath: new Map([["org/1/a.jpg", "https://example.test/signed/a.jpg"]]),
});
const book = buildXlsx({ name: "Inventory", rows: exported, numberColumns: [2], linkColumns: [6] });
const back = (await parseXlsx(asBuffer(book))).table;
eq("the sheet reads back exactly as exported", back.map(trimRow), exported.map(trimRow));
const reread = parseItemsTable(back);
eq("every item imports", reread.rows.length, 3);
eq("names survive", reread.rows.map((r) => r.name), ["Yorick's skull", "Crimson cloak", "Hand-typed chair"]);
eq("quantities survive as numbers", reread.rows.map((r) => r.quantity), [1, 2, 4]);
eq("conditions survive", reread.rows.map((r) => r.condition), ["fair", null, "needs_repair"]);
eq("locations survive as full paths", reread.rows[0].locationName, "Props Room A / Shakespeare box");
eq("leftover columns survive, leading zeros included", reread.rows[1].extra,
  { "Item #": "007", "Insurance value": "£120" });
eq("nothing failed to import", reread.rows.flatMap((r) => r.errors), []);

console.log("");
console.log(`════ ${passed} passed, ${failed} failed ════`);
process.exit(failed ? 1 : 0);
