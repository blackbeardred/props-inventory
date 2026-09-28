// Reads .xlsx workbooks into the same string[][] shape the CSV parser produces,
// so an Excel file and a CSV export of that same file import identically.
//
// Written by hand rather than pulled from npm on purpose. An .xlsx is a ZIP of
// XML parts, and both halves of that are small jobs: the browser already ships
// an inflater (DecompressionStream) and the parts we need are simple enough to
// scan. The alternative on npm is a large dependency whose registry release has
// known advisories, for a feature that boils down to "read a table".
//
// Scope: the first worksheet of a .xlsx file. Formulas are read as their last
// cached result, which is what the spreadsheet was showing. The old binary .xls
// format is a different thing entirely and isn't handled.

import { parseCsv } from "@/lib/csv";

/* ───────────────────────── ZIP ───────────────────────── */

type ZipEntry = { name: string; offset: number; compressed: number; method: number };

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;

/**
 * Locates the End Of Central Directory record, which lives at the very end of
 * the file after an optional comment, so it has to be found by scanning back.
 */
function findEocd(view: DataView): number {
  const max = Math.min(view.byteLength, 0xffff + 22);
  for (let back = 22; back <= max; back += 1) {
    const offset = view.byteLength - back;
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function readZipEntries(buffer: ArrayBuffer): Map<string, ZipEntry> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocd = findEocd(view);
  if (eocd < 0) throw new SpreadsheetError("That file isn’t a readable .xlsx workbook.");

  let count = view.getUint16(eocd + 10, true);
  let directory = view.getUint32(eocd + 16, true);

  // Zip64: the 32-bit fields saturate and the real ones live in a separate
  // record pointed at by a locator just before the EOCD.
  if (count === 0xffff || directory === 0xffffffff) {
    const locator = eocd - 20;
    if (locator >= 0 && view.getUint32(locator, true) === 0x07064b50) {
      const zip64 = Number(view.getBigUint64(locator + 8, true));
      if (view.getUint32(zip64, true) === ZIP64_EOCD_SIGNATURE) {
        count = Number(view.getBigUint64(zip64 + 32, true));
        directory = Number(view.getBigUint64(zip64 + 48, true));
      }
    }
  }

  const entries = new Map<string, ZipEntry>();
  let cursor = directory;

  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > view.byteLength) break;
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) break;

    const method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    let localOffset = view.getUint32(cursor + 42, true);

    const name = utf8(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    if (localOffset === 0xffffffff) {
      localOffset = zip64LocalOffset(view, cursor + 46 + nameLength, extraLength) ?? localOffset;
    }

    entries.set(name, { name, offset: localOffset, compressed, method });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** Digs the 64-bit local-header offset out of a central entry's extra fields. */
function zip64LocalOffset(view: DataView, start: number, length: number): number | null {
  let cursor = start;
  const end = start + length;
  while (cursor + 4 <= end) {
    const id = view.getUint16(cursor, true);
    const size = view.getUint16(cursor + 2, true);
    if (id === 0x0001) {
      // Sizes come first and are only present when they saturated too, so the
      // offset's position varies with how many 8-byte values precede it.
      for (let slot = 0; slot + 8 <= size; slot += 8) {
        if (slot + 8 === size || size >= 24) {
          return Number(view.getBigUint64(cursor + 4 + size - 8, true));
        }
      }
    }
    cursor += 4 + size;
  }
  return null;
}

/** Reads one entry's bytes, skipping past its local header to the payload. */
async function readEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(buffer);
  const nameLength = view.getUint16(entry.offset + 26, true);
  const extraLength = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLength + extraLength;
  const payload = new Uint8Array(buffer, start, entry.compressed);

  if (entry.method === 0) return payload;
  if (entry.method !== 8) {
    throw new SpreadsheetError("That workbook uses a compression method this importer can’t read.");
  }
  return inflateRaw(payload);
}

async function inflateRaw(payload: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new SpreadsheetError(
      "This browser can’t unpack .xlsx files. Save the sheet as CSV and import that instead."
    );
  }

  const stream = new Blob([payload as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

const decoder = new TextDecoder("utf-8");
function utf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/* ───────────────────────── XML ───────────────────────── */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function unescapeXml(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  if (!match) return undefined;
  return unescapeXml(match[2] ?? match[3] ?? "");
}

/** Concatenates the text of every <t> element inside a fragment. */
function collectText(fragment: string): string {
  let out = "";
  const pattern = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  for (let match = pattern.exec(fragment); match; match = pattern.exec(fragment)) {
    out += unescapeXml(match[1] ?? "");
  }
  return out;
}

/* ───────────────────── workbook parts ───────────────────── */

export class SpreadsheetError extends Error {}

function sharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const pattern = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si(?:\s[^>]*)?\/>/g;
  for (let match = pattern.exec(xml); match; match = pattern.exec(xml)) {
    strings.push(match[1] === undefined ? "" : collectText(match[1]));
  }
  return strings;
}

/**
 * Works out which style indexes format their number as a date, so a cell
 * holding 46023 comes back as "2026-01-05" — what the sheet actually shows —
 * rather than the raw serial.
 */
function dateStyles(xml: string): Set<number> {
  const dateFormats = new Set<number>([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

  const custom = /<numFmt\b[^>]*\/?>/g;
  for (let match = custom.exec(xml); match; match = custom.exec(xml)) {
    const id = Number(attribute(match[0], "numFmtId"));
    const code = attribute(match[0], "formatCode") ?? "";
    if (!Number.isFinite(id)) continue;
    // Strip quoted literals and colour/condition sections before looking for
    // date tokens, so a currency format like "[Red]$#,##0.00" isn't mistaken
    // for one because of a stray letter.
    // A lone "m" is minutes as often as months, so it only counts as a date
    // alongside a day or year, or spelled out as a month name ("mmm").
    const bare = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
    if (/[dy]/i.test(bare) || /m{3,}/i.test(bare)) dateFormats.add(id);
  }

  const styles = new Set<number>();
  const cellXfs = /<cellXfs\b[\s\S]*?<\/cellXfs>/.exec(xml)?.[0] ?? "";
  const xf = /<xf\b[^>]*\/?>/g;
  let index = 0;
  for (let match = xf.exec(cellXfs); match; match = xf.exec(cellXfs)) {
    const id = Number(attribute(match[0], "numFmtId"));
    if (Number.isFinite(id) && dateFormats.has(id)) styles.add(index);
    index += 1;
  }
  return styles;
}

function twoDigits(value: number): string {
  return String(Math.floor(value)).padStart(2, "0");
}

/** Excel's day-serial to an ISO string, including the famous 1900 leap-year lie. */
function serialToIso(serial: number, epoch1904: boolean): string {
  // Under a day means a clock time with no date behind it. Excel shows "14:30";
  // printing 1899-12-31 alongside it would be inventing a day that isn't there.
  if (serial > 0 && serial < 1) {
    const seconds = Math.round(serial * 86400);
    return `${twoDigits(seconds / 3600)}:${twoDigits((seconds % 3600) / 60)}:${twoDigits(
      seconds % 60
    )}`;
  }

  const base = epoch1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  // 1900 systems count a 29 February 1900 that never existed; serials at or
  // below 60 are therefore one day ahead of reality.
  const adjusted = !epoch1904 && serial < 61 ? serial + 1 : serial;
  const ms = base + Math.round(adjusted * 86400 * 1000);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return String(serial);

  const day = date.toISOString().slice(0, 10);
  const timeOfDay = Math.abs(adjusted % 1);
  if (timeOfDay < 1 / 86400 || timeOfDay > 1 - 1 / 86400) return day;
  return `${day} ${date.toISOString().slice(11, 19)}`;
}

/** "A" → 0, "AB" → 27. Returns null for a reference without a column part. */
function columnIndex(reference: string | undefined): number | null {
  if (!reference) return null;
  let index = 0;
  let seen = false;
  for (const character of reference) {
    const code = character.toUpperCase().charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
    seen = true;
  }
  return seen ? index - 1 : null;
}

function rowNumber(reference: string | undefined): number | null {
  if (!reference) return null;
  const digits = /(\d+)\s*$/.exec(reference);
  return digits ? Number(digits[1]) : null;
}

/**
 * Turns a worksheet part into a rectangular table, honouring each cell's own
 * row and column reference. Gaps matter: a blank row 7 has to stay row 7 so
 * "line 7" in an error message means line 7 of the user's spreadsheet.
 */
function readSheet(
  xml: string,
  strings: string[],
  dates: Set<number>,
  epoch1904: boolean
): string[][] {
  const table: string[][] = [];
  let fallbackRow = 0;

  const rowPattern = /<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g;
  for (let rowMatch = rowPattern.exec(xml); rowMatch; rowMatch = rowPattern.exec(xml)) {
    const attributes = rowMatch[1];
    const body = rowMatch[3] ?? "";
    const declared = Number(attribute(`<row ${attributes}>`, "r"));
    const line = Number.isFinite(declared) && declared > 0 ? declared : fallbackRow + 1;
    fallbackRow = line;

    const cells: string[] = [];
    let fallbackColumn = -1;

    const cellPattern = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
    for (let cellMatch = cellPattern.exec(body); cellMatch; cellMatch = cellPattern.exec(body)) {
      const tag = `<c ${cellMatch[1]}>`;
      const inner = cellMatch[3] ?? "";
      const column = columnIndex(attribute(tag, "r")) ?? fallbackColumn + 1;
      fallbackColumn = column;

      while (cells.length < column) cells.push("");
      cells[column] = cellValue(tag, inner, strings, dates, epoch1904);
    }

    while (table.length < line - 1) table.push([]);
    table[line - 1] = cells;
  }

  // A sheet's used range often runs past the data — Excel keeps empty rows it
  // has touched. The CSV path drops trailing blanks too.
  while (table.length > 0 && table[table.length - 1].every((cell) => cell === "")) {
    table.pop();
  }
  return table;
}

function cellValue(
  tag: string,
  inner: string,
  strings: string[],
  dates: Set<number>,
  epoch1904: boolean
): string {
  const type = attribute(tag, "t") ?? "n";

  if (type === "inlineStr") return collectText(inner).trim();

  if (type === "s") {
    const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1];
    const index = Number(raw);
    return Number.isInteger(index) ? (strings[index] ?? "") : "";
  }

  const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1];
  if (raw === undefined) {
    // A formula cell with no cached result, or a cell that only carries
    // formatting. Either way there's nothing to read.
    return type === "str" ? collectText(inner).trim() : "";
  }
  const value = unescapeXml(raw);

  if (type === "str" || type === "d") return value.trim();
  if (type === "e") return "";
  if (type === "b") return value === "1" ? "TRUE" : "FALSE";

  const style = Number(attribute(tag, "s"));
  const number = Number(value);
  if (Number.isFinite(number) && Number.isFinite(style) && dates.has(style)) {
    return serialToIso(number, epoch1904);
  }
  return value.trim();
}

/* ───────────────────────── entry point ───────────────────────── */

/** Resolves a relationship target against the part that declared it. */
function resolvePath(from: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const base = from.slice(0, from.lastIndexOf("/") + 1);
  const segments = (base + target).split("/");
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

/**
 * A picture sitting on the sheet, anchored to a cell. Spreadsheets of props
 * usually carry their photos this way rather than as links, so these are the
 * item photos in all but name.
 */
export type SheetImage = {
  /** 1-based row the picture's top-left corner sits in, as the sheet counts. */
  line: number;
  /** 0-based column, for telling a photo column from a decorative logo. */
  column: number;
  bytes: Uint8Array;
  contentType: string;
};

export type Workbook = {
  table: string[][];
  images: SheetImage[];
};

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** Beyond this a picture isn't a thumbnail any more, and won't upload either. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 2000;

/**
 * Pulls the pictures out of a worksheet, each tagged with the cell it's
 * anchored to.
 *
 * Three files are involved, which is why this looks long for what it does:
 * the sheet points at a drawing, the drawing says which cell each picture
 * sits in and names it by relationship id, and the drawing's own
 * relationships turn that id into a file in xl/media. Element names may or
 * may not carry the `xdr:` prefix depending on which program wrote the file.
 */
async function readSheetImages(
  buffer: ArrayBuffer,
  entries: Map<string, ZipEntry>,
  sheetPath: string,
  text: (path: string) => Promise<string>
): Promise<SheetImage[]> {
  const sheetName = sheetPath.split("/").pop() ?? "";
  const sheetRels = await text(resolvePath(sheetPath, `_rels/${sheetName}.rels`));
  if (!sheetRels) return [];

  let drawingPath: string | undefined;
  const relationships = /<Relationship\b[^>]*>/g;
  for (let match = relationships.exec(sheetRels); match; match = relationships.exec(sheetRels)) {
    if ((attribute(match[0], "Type") ?? "").endsWith("/drawing")) {
      const target = attribute(match[0], "Target");
      if (target) drawingPath = resolvePath(sheetPath, target);
      break;
    }
  }
  if (!drawingPath || !entries.has(drawingPath)) return [];

  const drawingName = drawingPath.split("/").pop() ?? "";
  const drawingRels = await text(resolvePath(drawingPath, `_rels/${drawingName}.rels`));

  const mediaById = new Map<string, string>();
  const drawingRelationships = /<Relationship\b[^>]*>/g;
  for (
    let match = drawingRelationships.exec(drawingRels);
    match;
    match = drawingRelationships.exec(drawingRels)
  ) {
    const id = attribute(match[0], "Id");
    const target = attribute(match[0], "Target");
    if (id && target) mediaById.set(id, resolvePath(drawingPath, target));
  }

  const drawing = await text(drawingPath);
  const images: SheetImage[] = [];

  // A picture is anchored to one cell or stretched between two; either way
  // its <from> corner is the cell it belongs to. Pictures placed at absolute
  // coordinates belong to no cell and are left alone — a logo, usually.
  const anchors = /<(?:xdr:)?(one|two)CellAnchor\b[^>]*>([\s\S]*?)<\/(?:xdr:)?\1CellAnchor>/g;
  for (let match = anchors.exec(drawing); match; match = anchors.exec(drawing)) {
    if (images.length >= MAX_IMAGES) break;
    const body = match[2];

    const from = /<(?:xdr:)?from\b[^>]*>([\s\S]*?)<\/(?:xdr:)?from>/.exec(body)?.[1];
    if (!from) continue;
    const column = Number(/<(?:xdr:)?col>(\d+)<\/(?:xdr:)?col>/.exec(from)?.[1]);
    const row = Number(/<(?:xdr:)?row>(\d+)<\/(?:xdr:)?row>/.exec(from)?.[1]);
    if (!Number.isFinite(column) || !Number.isFinite(row)) continue;

    const embedId = /<a:blip\b[^>]*r:embed\s*=\s*"([^"]+)"/.exec(body)?.[1];
    const mediaPath = embedId ? mediaById.get(embedId) : undefined;
    const entry = mediaPath ? entries.get(mediaPath) : undefined;
    if (!entry || !mediaPath) continue;

    const extension = mediaPath.slice(mediaPath.lastIndexOf(".") + 1).toLowerCase();
    const contentType = IMAGE_TYPES[extension];
    if (!contentType) continue;

    const bytes = await readEntry(buffer, entry);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) continue;

    images.push({ line: row + 1, column, bytes, contentType });
  }

  return images;
}

/**
 * Reads the first worksheet of an .xlsx file: its cells as rows of strings —
 * the same shape parseCsv returns, so everything downstream is shared — and
 * any pictures sitting on it.
 */
export async function parseXlsx(buffer: ArrayBuffer): Promise<Workbook> {
  const entries = readZipEntries(buffer);

  const workbookPath = ["xl/workbook.xml", "xl/workbook.bin"].find((path) => entries.has(path));
  if (!workbookPath) {
    if ([...entries.keys()].some((name) => name.endsWith(".bin"))) {
      throw new SpreadsheetError(
        "That looks like a binary .xlsb workbook. Save it as .xlsx or CSV and try again."
      );
    }
    throw new SpreadsheetError("That file isn’t a readable .xlsx workbook.");
  }

  const text = async (path: string) => {
    const entry = entries.get(path);
    return entry ? utf8(await readEntry(buffer, entry)) : "";
  };

  const workbook = await text(workbookPath);
  const epoch1904 = /date1904\s*=\s*"(1|true)"/i.test(workbook);

  // The first <sheet> is the one the user sees first; its r:id points into the
  // workbook's relationships, which is where the actual part name lives.
  const firstSheet = /<sheet\b[^>]*>/.exec(workbook)?.[0];
  if (!firstSheet) throw new SpreadsheetError("That workbook has no sheets in it.");

  const relationshipId = attribute(firstSheet, "r:id") ?? attribute(firstSheet, "id");
  const relsPath = resolvePath(workbookPath, `_rels/${workbookPath.split("/").pop()}.rels`);
  const rels = await text(relsPath);

  let sheetPath: string | undefined;
  if (relationshipId) {
    const pattern = /<Relationship\b[^>]*>/g;
    for (let match = pattern.exec(rels); match; match = pattern.exec(rels)) {
      if (attribute(match[0], "Id") === relationshipId) {
        const target = attribute(match[0], "Target");
        if (target) sheetPath = resolvePath(workbookPath, target);
        break;
      }
    }
  }
  if (!sheetPath || !entries.has(sheetPath)) {
    // Some writers omit or mangle the relationships. The conventional path is
    // a reliable fallback.
    sheetPath = [...entries.keys()]
      .filter((name) => /^xl\/worksheets\/sheet\d*\.xml$/.test(name))
      .sort()[0];
  }
  if (!sheetPath) throw new SpreadsheetError("That workbook has no sheets in it.");

  const [sheetXml, stringsXml, stylesXml, images] = await Promise.all([
    text(sheetPath),
    text("xl/sharedStrings.xml"),
    text("xl/styles.xml"),
    readSheetImages(buffer, entries, sheetPath, text),
  ]);

  return {
    table: readSheet(sheetXml, sharedStrings(stringsXml), dateStyles(stylesXml), epoch1904),
    images,
  };
}

/** Every .xlsx is a zip, so its first two bytes are always "PK". */
function looksLikeZip(buffer: ArrayBuffer): boolean {
  const head = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  return head[0] === 0x50 && head[1] === 0x4b;
}

/**
 * True when the bytes read as ordinary text — no NULs or stray control
 * characters. Used to spot a CSV that's been given a workbook's name, which
 * happens often enough (a system exports "inventory.xlsx" full of commas) to
 * be worth handling instead of refusing.
 */
function looksLikeText(buffer: ArrayBuffer): boolean {
  const sample = new Uint8Array(buffer, 0, Math.min(4096, buffer.byteLength));
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte < 32) return false;
  }
  return true;
}

/**
 * Reads whichever kind of file the user picked into rows. This is the one
 * entry point the import wizard needs: the decision between workbook and text
 * is made on the bytes, so a mislabelled file still comes in.
 */
export async function readSpreadsheetFile(file: File): Promise<Workbook> {
  if (!looksLikeWorkbook(file)) {
    return { table: parseCsv(await file.text()), images: [] };
  }

  const buffer = await file.arrayBuffer();
  if (looksLikeZip(buffer)) return parseXlsx(buffer);
  if (looksLikeText(buffer)) {
    return { table: parseCsv(new TextDecoder("utf-8").decode(buffer)), images: [] };
  }

  throw new SpreadsheetError(
    "That file is named like a workbook but isn’t one. Re-save it as .xlsx or CSV and try again."
  );
}

const XLSX_EXTENSIONS = [".xlsx", ".xlsm"];

/** True when a file should go down the workbook path rather than the CSV one. */
export function looksLikeWorkbook(file: { name: string; type?: string }): boolean {
  const name = file.name.toLowerCase();
  if (XLSX_EXTENSIONS.some((extension) => name.endsWith(extension))) return true;
  return (
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.type === "application/vnd.ms-excel.sheet.macroEnabled.12"
  );
}

/** A friendly refusal for formats that look like spreadsheets but aren't readable. */
export function unreadableSpreadsheetReason(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xls")) {
    return "That’s the older .xls format. Open it in Excel and save as .xlsx or CSV, then try again.";
  }
  if (lower.endsWith(".xlsb")) {
    return "That’s a binary .xlsb workbook. Save it as .xlsx or CSV, then try again.";
  }
  if (lower.endsWith(".numbers") || lower.endsWith(".ods")) {
    return "Export that to .xlsx or CSV first — this importer reads those two.";
  }
  return null;
}
