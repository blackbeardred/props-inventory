// Tests for the .xlsx reader. Run with:
//   node --experimental-strip-types src/lib/xlsx.test.mjs
//
// Two kinds of case here. The committed fixture is a real workbook written by a
// real spreadsheet program — the only honest check that the zip and XML reading
// survive what actual files look like. The hand-built zips after it cover the
// shapes a writer only produces occasionally (inline strings, stored entries,
// oddly named sheet parts), which would otherwise go untested until a user hit
// one.

import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseXlsx,
  looksLikeWorkbook,
  readSpreadsheetFile,
  unreadableSpreadsheetReason,
  SpreadsheetError,
} from "./xlsx.ts";
import { parseItemsTable } from "./csv.ts";

let passed = 0;
let failed = 0;

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}\n        expected ${b}\n        actual   ${a}`);
  }
}

function ok(label, condition) {
  eq(label, condition === true, true);
}

/* ─────────── a real workbook ─────────── */

const here = dirname(fileURLToPath(import.meta.url));
const bytes = await readFile(join(here, "fixtures", "import-sample.xlsx"));
const { table } = await parseXlsx(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
);

console.log("── A real workbook");

eq("title row read as-is", table[0], ["Hamlet props — master list"]);
eq("blank row 2 stays blank", table[1], []);
eq("header row intact", table[2], [
  "Item #", "Name", "Category", "Qty", "Condition",
  "Storage Location", "Description", "Acquired", "Photo URL",
]);
eq("numbers, escapes and dates", table[3], [
  "P-001", "Yorick's skull", "prop", "1", "excellent", "Shelf B",
  'Cast resin, aged & "weathered"', "2026-01-05", "https://example.com/skull.jpg",
]);
eq("a date before 1970", table[4][7], "2019-11-30");
eq("blank row in the middle is kept", table[5], []);
eq("leading empty cells keep their columns", table[8], ["", "Ghost chains", "", "3", "", "Shed"]);
eq("trailing blank rows dropped", table.length, 9);

console.log("");
console.log("── Through the shared mapping");

const parsed = parseItemsTable(table);

eq("headers found below the title", parsed.headers[1], "Name");
eq("identifier column still ignored", parsed.mapping, [
  null, "name", "category", "quantity", "condition", "location", "description", null, "photo",
]);
eq("rows above the headers aren't errors", parsed.rows.length, 4);
eq("line numbers match the spreadsheet", parsed.rows.map((row) => row.line), [4, 5, 7, 9]);
eq("nothing failed", parsed.rows.flatMap((row) => row.errors), []);
eq("names", parsed.rows.map((row) => row.name), [
  "Yorick's skull", "Brass candlestick", "Crimson cloak", "Ghost chains",
]);
eq("numeric quantities survive", parsed.rows.map((row) => row.quantity), [1, 6, 2, 3]);
eq("conditions still interpreted", parsed.rows.map((row) => row.condition), [
  "new", "good", "needs_repair", null,
]);
eq("photo links kept", parsed.rows[0].photoUrl, "https://example.com/skull.jpg");

/* ─────────── hand-built workbooks ─────────── */

/** The smallest zip a reader has to accept: local headers, central dir, EOCD. */
function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, content, store = false] of files) {
    const nameBytes = Buffer.from(name, "utf8");
    const raw = Buffer.from(content, "utf8");
    const body = store ? raw : deflateRawSync(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(0, 14); // crc — nothing here checks it
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(store ? 0 : 8, 10);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([entry, nameBytes]));

    chunks.push(local, nameBytes, body);
    offset += 30 + nameBytes.length + body.length;
  }

  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  const all = Buffer.concat([...chunks, directory, eocd]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
}

const RELS = (target) =>
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Target="${target}" Type=".../worksheet"/></Relationships>`;

const WORKBOOK = `<?xml version="1.0"?><workbook xmlns:r="..."><sheets>` +
  `<sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;

console.log("");
console.log("── Shapes other writers produce");

const inlineSheet = `<worksheet><sheetData>
  <row r="1"><c r="A1" t="inlineStr"><is><t>name</t></is></c><c r="B1" t="inlineStr"><is><t>quantity</t></is></c></row>
  <row r="2"><c r="A2" t="inlineStr"><is><t>Lantern</t></is></c><c r="B2"><v>2</v></c></row>
</sheetData></worksheet>`;

const { table: inline } = await parseXlsx(
  zip([
    ["xl/workbook.xml", WORKBOOK],
    ["xl/_rels/workbook.xml.rels", RELS("worksheets/oddly-named.xml")],
    ["xl/worksheets/oddly-named.xml", inlineSheet],
  ])
);
eq("inline strings read", inline, [["name", "quantity"], ["Lantern", "2"]]);

const { table: stored } = await parseXlsx(
  zip([
    ["xl/workbook.xml", WORKBOOK, true],
    ["xl/_rels/workbook.xml.rels", RELS("/xl/worksheets/sheet1.xml"), true],
    ["xl/worksheets/sheet1.xml", inlineSheet, true],
  ])
);
eq("uncompressed entries read", stored[1], ["Lantern", "2"]);

const { table: shared } = await parseXlsx(
  zip([
    ["xl/workbook.xml", WORKBOOK],
    // No rels at all: fall back to the conventional worksheet path.
    [
      "xl/sharedStrings.xml",
      `<sst><si><t>na</t></si><si><r><t>Bro</t></r><r><t>ken &amp; </t></r><r><t>joined</t></r></si>` +
      `<si><t xml:space="preserve"> padded </t></si></sst>`,
    ],
    [
      "xl/worksheets/sheet1.xml",
      `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row>` +
      `<row r="3"><c r="A3" t="s"><v>1</v></c><c r="C3" t="s"><v>2</v></c>` +
      `<c r="D3" t="b"><v>0</v></c><c r="E3" t="e"><v>#REF!</v></c>` +
      `<c r="F3" t="str"><f>A1</f><v>from formula</v></c><c r="G3" s="0"/></row>` +
      `</sheetData></worksheet>`,
    ],
  ])
);
eq("runs inside one string are joined", shared[2][0], "Broken & joined");
eq("row 2 left blank by the r attribute", shared[1], []);
eq("a skipped column shifts the rest right", shared[2][2], " padded ");
eq("booleans", shared[2][3], "FALSE");
eq("errors come through empty", shared[2][4], "");
eq("cached formula text", shared[2][5], "from formula");
eq("a formatting-only cell is empty", shared[2][6], "");

let refused = null;
try {
  await parseXlsx(Buffer.from("name,quantity\nLantern,2\n").buffer);
} catch (error) {
  refused = error;
}
ok("a CSV handed to the workbook reader is refused clearly", refused instanceof SpreadsheetError);

console.log("");
console.log("── Picking the right reader");

ok("by extension", looksLikeWorkbook({ name: "Inventory.XLSX" }));
ok("macro workbooks too", looksLikeWorkbook({ name: "inventory.xlsm" }));
ok(
  "by mime type when the name is unhelpful",
  looksLikeWorkbook({
    name: "download",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
);
ok("csv isn't a workbook", looksLikeWorkbook({ name: "items.csv", type: "text/csv" }) === false);
ok("old .xls is named as unreadable", unreadableSpreadsheetReason("book.xls") !== null);
ok(".xlsb is named as unreadable", unreadableSpreadsheetReason("book.xlsb") !== null);
ok(".xlsx isn't refused", unreadableSpreadsheetReason("book.xlsx") === null);
ok(".csv isn't refused", unreadableSpreadsheetReason("book.csv") === null);

console.log("");
console.log("── Reading whatever the user picked");

// Stands in for a browser File: name, type, and the two readers the code uses.
function fakeFile(name, type, content) {
  const buffer =
    typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
  return {
    name,
    type,
    text: async () => buffer.toString("utf8"),
    arrayBuffer: async () =>
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}

const workbookBytes = Buffer.from(
  new Uint8Array(
    zip([
      ["xl/workbook.xml", WORKBOOK],
      ["xl/_rels/workbook.xml.rels", RELS("worksheets/sheet1.xml")],
      ["xl/worksheets/sheet1.xml", inlineSheet],
    ])
  )
);

eq(
  "a csv is read as text",
  (await readSpreadsheetFile(fakeFile("items.csv", "text/csv", "name,quantity\nLantern,2\n"))).table,
  [["name", "quantity"], ["Lantern", "2"]]
);
eq(
  "a workbook is unzipped",
  (await readSpreadsheetFile(fakeFile("items.xlsx", "", workbookBytes))).table,
  [["name", "quantity"], ["Lantern", "2"]]
);
// Some systems export a CSV under a .xlsx name. Refusing that would be pedantic
// when the bytes say plainly what it is.
eq(
  "a csv wearing a .xlsx name still comes in",
  (await readSpreadsheetFile(fakeFile("items.xlsx", "", "name,quantity\nLantern,2\n"))).table,
  [["name", "quantity"], ["Lantern", "2"]]
);

let binaryRefusal = null;
try {
  await readSpreadsheetFile(fakeFile("items.xlsx", "", Buffer.from([0x00, 0x01, 0x02, 0x00])));
} catch (error) {
  binaryRefusal = error;
}
ok("but actual binary junk is refused", binaryRefusal instanceof SpreadsheetError);

console.log("");
console.log("── Pictures inside the sheet");

// A props inventory usually carries its photos in the workbook rather than as
// links, so these have to come out with the cell they're anchored to.
const withImages = await readFile(join(here, "fixtures", "embedded-images.xlsx"));
const workbook = await parseXlsx(
  withImages.buffer.slice(withImages.byteOffset, withImages.byteOffset + withImages.byteLength)
);

eq("one picture per row", workbook.images.length, 5);
eq("anchored to the rows the items are on", workbook.images.map((image) => image.line), [2, 3, 4, 5, 6]);
eq("and to the photo column", [...new Set(workbook.images.map((image) => image.column))], [8]);
eq("read as real image bytes", workbook.images.every((image) => image.contentType === "image/png"), true);
eq("that aren't empty", workbook.images.every((image) => image.bytes.byteLength > 100), true);
eq("PNG magic number intact", [...workbook.images[0].bytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
eq("the cells themselves still read normally", workbook.table[1][1], "Rapier, basket hilt");
eq("the photo column's cells are empty text", workbook.table[1][8], undefined);

// A workbook with no drawing at all mustn't trip over the missing parts.
eq("no pictures is not an error", (await parseXlsx(
  zip([
    ["xl/workbook.xml", WORKBOOK],
    ["xl/_rels/workbook.xml.rels", RELS("worksheets/sheet1.xml")],
    ["xl/worksheets/sheet1.xml", inlineSheet],
  ])
)).images, []);

console.log("");
console.log(`════ ${passed} passed, ${failed} failed ════`);
if (failed > 0) process.exitCode = 1;
