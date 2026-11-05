// Writing an Excel workbook (.xlsx), with no dependency.
//
// The other half of src/lib/xlsx.ts, which reads one. Same reasoning as that
// file and the ZIP, QR and CSV code: a spreadsheet library is a large thing to
// take on (SheetJS's npm release carries known advisories) for what is, here,
// one sheet of text and a column of numbers.
//
// An .xlsx is a ZIP of XML parts (ECMA-376, Office Open XML). This writes the
// smallest set Excel, Numbers, Google Sheets and LibreOffice all open without
// complaint: content types, the package and workbook relationships, the
// workbook, one worksheet, and a stylesheet. Text goes in as inline strings
// rather than through a shared-string table, which costs some size and saves
// a second part that has to agree with the first.
//
// Things a spreadsheet person expects and gets: the heading row bold, frozen
// and filterable, columns sized to what's in them, quantities as numbers that
// add up, and picture links you can click.

import { makeZip, type ZipEntry } from "@/lib/zip";

export type XlsxSheet = {
  /** The tab's name. Cleaned to what Excel allows. */
  name: string;
  /** Headings first, then one array per row. Empty strings leave a cell empty. */
  rows: string[][];
  /** 0-based columns whose plain numbers should be numbers, not text. */
  numberColumns?: number[];
  /** 0-based columns whose http(s) addresses should be clickable links. */
  linkColumns?: number[];
};

/** Excel's own hard limits. Past these it "repairs" the file by deleting things. */
const MAX_CELL_CHARS = 32767;
const MAX_ROWS = 1048576;
const MAX_COLUMNS = 16384;
const MAX_LINKS = 65530;

const MIME_XML = "application/vnd.openxmlformats-officedocument";
export const XLSX_CONTENT_TYPE = `${MIME_XML}.spreadsheetml.sheet`;

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

/**
 * Characters XML 1.0 can't carry at all, not even escaped: most control
 * characters, and the two non-characters. A pasted description can contain
 * them (a stray form feed from a PDF), and one of them makes the whole file
 * unopenable, so they're dropped. Lone surrogates are dropped too, since they
 * can't be encoded as UTF-8.
 */
const INVALID_XML =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Text made safe to sit in XML, between tags or inside a quoted attribute. */
export function escapeXml(text: string): string {
  return text
    .replace(INVALID_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 0 → A, 25 → Z, 26 → AA: Excel's column letters. */
export function columnName(index: number): string {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/**
 * A sheet name Excel will accept: none of : \ / ? * [ ], not starting or ending
 * with an apostrophe, not blank, at most 31 characters.
 */
export function cleanSheetName(name: string): string {
  const cleaned = name
    .replace(INVALID_XML, "")
    .replace(/[:\\/?*[\]]/g, " ")
    .replace(/^'+|'+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31)
    .trim();
  return cleaned || "Sheet1";
}

/**
 * Whether text should be written as a number. Deliberately narrow: "007" and
 * "P-001" stay text, because turning them into 7 and an error is exactly the
 * damage people curse Excel for. Fifteen significant digits is as far as
 * Excel keeps a number exactly.
 */
function asNumber(text: string): string | null {
  if (!/^-?(0|[1-9]\d*)(\.\d+)?$/.test(text)) return null;
  if (text.replace(/[-.]/g, "").length > 15) return null;
  return text;
}

function isLink(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text);
}

/**
 * A cell's text, cut to Excel's limit. Nothing in the app normally comes close
 * — the risk is a spreadsheet column that once held a whole document — but a
 * workbook with one over-long cell won't open cleanly at all.
 */
function fitCell(text: string): string {
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS - 1)}…` : text;
}

/** How wide a column should be, in Excel's character units. */
function columnWidth(rows: string[][], column: number, isLinkColumn: boolean): number {
  let longest = 0;
  for (const row of rows) {
    const text = row[column] ?? "";
    // The longest line, not the whole thing: a description with line breaks
    // is as wide as its widest line.
    for (const line of text.split("\n")) longest = Math.max(longest, line.length);
  }
  // A signed link is hundreds of characters of noise; show the start of it
  // and let the click do the rest.
  const cap = isLinkColumn ? 24 : 60;
  return Math.min(Math.max(longest + 2, 8), cap);
}

// Style indexes into cellXfs below.
const STYLE_HEADING = 1;
const STYLE_LINK = 2;
const STYLE_WRAP = 3;

const STYLES = `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Builds the workbook. Throws, with a sentence, when the sheet can't fit. */
export function buildXlsx(sheet: XlsxSheet, now: Date = new Date()): Uint8Array {
  const rows = sheet.rows;
  if (rows.length === 0) throw new Error("Nothing to put in the spreadsheet.");
  if (rows.length > MAX_ROWS) throw new Error("Too many rows for one Excel sheet.");
  const width = Math.max(...rows.map((row) => row.length));
  if (width > MAX_COLUMNS) throw new Error("Too many columns for one Excel sheet.");

  const name = cleanSheetName(sheet.name);
  const numberColumns = new Set(sheet.numberColumns ?? []);
  const linkColumns = new Set(sheet.linkColumns ?? []);
  const lastColumn = columnName(Math.max(width, 1) - 1);
  const lastRow = rows.length;

  const links: { ref: string; target: string }[] = [];
  const sheetRows: string[] = [];

  rows.forEach((row, r) => {
    const line = r + 1;
    const cells: string[] = [];
    row.forEach((raw, c) => {
      const text = fitCell(raw ?? "");
      if (text === "") return;
      const ref = `${columnName(c)}${line}`;

      if (r > 0 && numberColumns.has(c)) {
        const number = asNumber(text);
        if (number !== null) {
          cells.push(`<c r="${ref}"><v>${number}</v></c>`);
          return;
        }
      }

      let style = r === 0 ? STYLE_HEADING : 0;
      if (r > 0 && linkColumns.has(c) && isLink(text) && links.length < MAX_LINKS) {
        links.push({ ref, target: text });
        style = STYLE_LINK;
      } else if (r > 0 && text.includes("\n")) {
        style = STYLE_WRAP;
      }

      // An inline string: always text, never a formula, so a name that starts
      // with "=" or "+" stays a name. (The CSV export can't promise that.)
      cells.push(
        `<c r="${ref}"${style ? ` s="${style}"` : ""} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`
      );
    });
    sheetRows.push(`<row r="${line}">${cells.join("")}</row>`);
  });

  const cols = Array.from({ length: width }, (_, c) => {
    const w = columnWidth(rows, c, linkColumns.has(c));
    return `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`;
  }).join("");

  const range = `A1:${lastColumn}${lastRow}`;
  const frozen =
    lastRow > 1
      ? `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>`
      : "";

  const hyperlinks = links.length
    ? `<hyperlinks>${links
        .map((link, i) => `<hyperlink ref="${link.ref}" r:id="rId${i + 1}"/>`)
        .join("")}</hyperlinks>`
    : "";

  // Element order is fixed by the schema; Excel rejects a file that strays
  // from it: dimension, sheetViews, sheetFormatPr, cols, sheetData,
  // autoFilter, hyperlinks, pageMargins.
  const worksheet = `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">
<dimension ref="${range}"/>
<sheetViews><sheetView workbookViewId="0">${frozen}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${sheetRows.join("")}</sheetData>
<autoFilter ref="${range}"/>
${hyperlinks}
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;

  const sheetRels = links.length
    ? `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">${links
        .map(
          (link, i) =>
            `<Relationship Id="rId${i + 1}" Type="${NS_REL}/hyperlink" Target="${escapeXml(link.target)}" TargetMode="External"/>`
        )
        .join("")}</Relationships>`
    : null;

  // A filter needs this hidden name, or Excel quietly drops it on opening.
  const quoted = `'${name.replace(/'/g, "''")}'`;
  const workbook = `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">
<bookViews><workbookView/></bookViews>
<sheets><sheet name="${escapeXml(name)}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${escapeXml(
    `${quoted}!$A$1:$${lastColumn}$${lastRow}`
  )}</definedName></definedNames>
</workbook>`;

  const workbookRels = `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">
<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/>
</Relationships>`;

  const rootRels = `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">
<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const contentTypes = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="${MIME_XML}.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${MIME_XML}.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="${MIME_XML}.spreadsheetml.styles+xml"/>
</Types>`;

  const encoder = new TextEncoder();
  const file = (path: string, xml: string): ZipEntry => ({
    name: path,
    data: encoder.encode(xml),
    date: now,
  });

  // [Content_Types].xml first: some readers look for it at the very start.
  const entries: ZipEntry[] = [
    file("[Content_Types].xml", contentTypes),
    file("_rels/.rels", rootRels),
    file("xl/workbook.xml", workbook),
    file("xl/_rels/workbook.xml.rels", workbookRels),
    file("xl/styles.xml", STYLES),
    file("xl/worksheets/sheet1.xml", worksheet),
  ];
  if (sheetRels) entries.push(file("xl/worksheets/_rels/sheet1.xml.rels", sheetRels));

  return makeZip(entries);
}
