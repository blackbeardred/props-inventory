// CSV parsing and row validation for the bulk item import.
//
// Shared deliberately between the browser (which parses the file for the
// preview, so the user sees problems before anything is written) and the
// server action (which re-validates every row, because the browser's opinion
// isn't trustworthy). Both agreeing is the point of putting it here.

import type { Category, Condition } from "@/lib/inventory";

/**
 * Splits CSV text into rows of fields, following RFC 4180: fields may be
 * quoted, a doubled quote inside a quoted field is a literal quote, and a
 * quoted field may contain commas and newlines.
 */
export function parseCsv(text: string): string[][] {
  // Strip a UTF-8 BOM — Excel writes one and it otherwise becomes part of
  // the first header name, which then matches nothing.
  const input = text.replace(/^﻿/, "");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // Blank lines are kept rather than dropped: parseItemsCsv filters them
    // out later, but only after it has used each row's position to work out
    // which line of the file it came from. Dropping them here would shift
    // every reported line number after the first blank line, and the whole
    // point of the number is that the user can find the row in their sheet.
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      endField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      // CRLF or a lone CR both end the row.
      endRow();
      i += input[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  // Whatever is left when the text runs out is a final row — but a file
  // ending in a newline has nothing left, and mustn't gain a phantom one.
  if (field !== "" || row.length > 0 || inQuotes) endRow();

  return rows;
}

/** The item fields an imported column can be mapped onto. */
export const IMPORT_FIELDS = [
  "name",
  "category",
  "description",
  "quantity",
  "condition",
  "location",
  "tags",
  "photo",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  name: "Name",
  category: "Category",
  description: "Description",
  quantity: "Quantity",
  condition: "Condition",
  location: "Location",
  tags: "Search tags",
  photo: "Photo URL",
};

// Header spellings a theatre's own spreadsheet is likely to use. Matched
// after lowercasing and stripping anything that isn't a letter or digit, so
// "Item Name", "item_name" and "ITEM-NAME" all land in the same place.
const HEADER_ALIASES: Record<string, ImportField> = {
  name: "name",
  item: "name",
  itemname: "name",
  title: "name",
  description: "description",
  desc: "description",
  notes: "description",
  details: "description",
  category: "category",
  type: "category",
  kind: "category",
  // A column headed "Costume", or "Costume or Prop", is naming the kind of
  // thing rather than the thing. ("Prop" on its own is deliberately absent:
  // it collides with too much, and the user can remap by hand anyway.)
  costume: "category",
  quantity: "quantity",
  qty: "quantity",
  count: "quantity",
  amount: "quantity",
  condition: "condition",
  state: "condition",
  location: "location",
  shelf: "location",
  storage: "location",
  where: "location",
  bin: "location",
  tags: "tags",
  keywords: "tags",
  labels: "tags",
  photo: "photo",
  photos: "photo",
  image: "photo",
  images: "photo",
  picture: "photo",
  thumbnail: "photo",
  imageurl: "photo",
  photourl: "photo",
  imagelink: "photo",
  url: "photo",
  link: "photo",
};

function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Column headings that identify a row rather than describe it. A sheet's
// first column is very often "Item #" or "Inventory No.", which normalises
// to "item" and would otherwise be taken for the name — pushing the real
// Name column out, since a field can only be filled once.
const IDENTIFIER_TOKENS = new Set([
  "no",
  "nos",
  "num",
  "number",
  "id",
  "ids",
  "sku",
  "code",
  "ref",
  "reference",
  "barcode",
  "qr",
  "inv",
  "index",
]);

function isIdentifierHeader(header: string): boolean {
  if (header.includes("#")) return true;
  return header
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .some((token) => IDENTIFIER_TOKENS.has(token));
}

// Longest first, so "storagelocation" resolves to location rather than
// storage, and "itemname" to name rather than item.
const ALIASES_BY_LENGTH = Object.keys(HEADER_ALIASES).sort(
  (a, b) => b.length - a.length
);

/** Exact header match, then the longest alias contained within it. */
function matchHeader(header: string): ImportField | undefined {
  const normalised = normaliseHeader(header);
  if (!normalised) return undefined;
  const exact = HEADER_ALIASES[normalised];
  if (exact) return exact;
  const contained = ALIASES_BY_LENGTH.find(
    (alias) => alias.length >= 3 && normalised.includes(alias)
  );
  return contained ? HEADER_ALIASES[contained] : undefined;
}

/**
 * Guesses which item field each column holds. Returns one entry per column,
 * null where nothing matched, and never maps two columns to the same field —
 * the first match wins, so a sheet with both "Name" and "Title" doesn't
 * silently drop one on top of the other.
 */
export function guessMapping(headers: string[]): (ImportField | null)[] {
  // Every column proposes what it might be and how sure it is, then the
  // strongest proposals are honoured first. Assigning left to right instead
  // let a weak early guess ("Item #" → name) take a field that a later
  // column matched exactly ("Name" → name).
  type Candidate = { column: number; field: ImportField; strength: number };
  const candidates: Candidate[] = [];

  headers.forEach((header, column) => {
    if (isIdentifierHeader(header)) return;

    const normalised = normaliseHeader(header);
    if (!normalised) return;

    const exact = HEADER_ALIASES[normalised];
    if (exact) {
      candidates.push({ column, field: exact, strength: 2 });
      return;
    }

    const contained = ALIASES_BY_LENGTH.find(
      (alias) => alias.length >= 3 && normalised.includes(alias)
    );
    if (contained) {
      candidates.push({ column, field: HEADER_ALIASES[contained], strength: 1 });
    }
  });

  candidates.sort(
    (a, b) => b.strength - a.strength || a.column - b.column
  );

  const mapping: (ImportField | null)[] = headers.map(() => null);
  const takenFields = new Set<ImportField>();
  const takenColumns = new Set<number>();

  for (const candidate of candidates) {
    if (takenFields.has(candidate.field) || takenColumns.has(candidate.column)) {
      continue;
    }
    mapping[candidate.column] = candidate.field;
    takenFields.add(candidate.field);
    takenColumns.add(candidate.column);
  }

  return mapping;
}

const CATEGORY_WORDS: Record<string, Category> = {
  prop: "prop",
  props: "prop",
  set: "prop",
  setpiece: "prop",
  costume: "costume",
  costumes: "costume",
  wardrobe: "costume",
  garment: "costume",
};

// Nobody writes the four words this app stores. A spreadsheet says
// "excellent", "like new", "well used", "needs work" — and "excellent" is
// plainly better than good, so it belongs in new rather than being dropped
// on the floor with a warning.
const CONDITION_WORDS: Record<string, Condition> = {
  new: "new",
  brandnew: "new",
  likenew: "new",
  asnew: "new",
  unused: "new",
  excellent: "new",
  mint: "new",
  pristine: "new",
  perfect: "new",
  immaculate: "new",

  good: "good",
  verygood: "good",
  great: "good",
  fine: "good",
  solid: "good",
  serviceable: "good",
  sound: "good",

  fair: "fair",
  ok: "fair",
  okay: "fair",
  average: "fair",
  used: "fair",
  wellused: "fair",
  worn: "fair",
  usable: "fair",
  acceptable: "fair",
  tatty: "fair",
  scuffed: "fair",

  poor: "needs_repair",
  bad: "needs_repair",
  needsrepair: "needs_repair",
  needswork: "needs_repair",
  needsattention: "needs_repair",
  repair: "needs_repair",
  broken: "needs_repair",
  damaged: "needs_repair",
  torn: "needs_repair",
  cracked: "needs_repair",
  unusable: "needs_repair",
  unsafe: "needs_repair",
};

export type ParsedRow = {
  /** 1-based line number in the file, for error messages. */
  line: number;
  name: string;
  category: Category;
  description: string | null;
  quantity: number;
  condition: Condition | null;
  /** As written in the file; resolved to a real location on the server. */
  locationName: string | null;
  tags: string[];
  /** An http(s) link to a picture, fetched and stored during the import. */
  photoUrl: string | null;
  /** Blocking problems. A row with any of these is not imported. */
  errors: string[];
  /** Non-blocking: the row imports, but something was assumed. */
  warnings: string[];
};

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;

function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const entry of raw.split(/[,;|]/)) {
    const tag = entry.trim().toLowerCase();
    if (!tag || tag.length > MAX_TAG_LENGTH || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

/**
 * Turns one CSV row into an item, collecting every problem rather than
 * stopping at the first — someone fixing a spreadsheet wants the whole list.
 */
export function validateRow(
  cells: string[],
  mapping: (ImportField | null)[],
  line: number
): ParsedRow {
  const errors: string[] = [];
  const warnings: string[] = [];

  const valueOf = (field: ImportField): string => {
    const index = mapping.indexOf(field);
    if (index === -1) return "";
    return (cells[index] ?? "").trim();
  };

  const name = valueOf("name");
  if (!name) {
    errors.push("No name");
  } else if (name.length > 200) {
    errors.push("Name is longer than 200 characters");
  }

  const categoryRaw = valueOf("category");
  let category: Category = "prop";
  if (categoryRaw) {
    const matched = CATEGORY_WORDS[normaliseHeader(categoryRaw)];
    if (matched) {
      category = matched;
    } else {
      warnings.push(`Didn't recognise category "${categoryRaw}" — treated as a prop`);
    }
  }

  const quantityRaw = valueOf("quantity");
  let quantity = 1;
  if (quantityRaw) {
    const parsed = Number.parseInt(quantityRaw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      errors.push(`Quantity "${quantityRaw}" isn't a whole number of 1 or more`);
    } else {
      quantity = parsed;
    }
  }

  const conditionRaw = valueOf("condition");
  let condition: Condition | null = null;
  if (conditionRaw) {
    const matched = CONDITION_WORDS[normaliseHeader(conditionRaw)];
    if (matched) {
      condition = matched;
    } else {
      warnings.push(`Didn't recognise condition "${conditionRaw}" — left blank`);
    }
  }

  const description = valueOf("description") || null;
  const locationName = valueOf("location") || null;
  const tags = parseTags(valueOf("tags"));

  // A bad link shouldn't cost you the row — the item imports, just without
  // its picture, and the warning says which line to go and fix.
  const photoRaw = valueOf("photo");
  let photoUrl: string | null = null;
  if (photoRaw) {
    if (/^https?:\/\/\S+$/i.test(photoRaw)) {
      photoUrl = photoRaw;
    } else {
      warnings.push(`“${photoRaw}” isn’t a web link, so no photo was fetched`);
    }
  }

  return {
    line,
    name,
    category,
    description,
    quantity,
    condition,
    locationName,
    tags,
    photoUrl,
    errors,
    warnings,
  };
}

export type ParsedFile = {
  headers: string[];
  mapping: (ImportField | null)[];
  rows: ParsedRow[];
};

export const MAX_IMPORT_ROWS = 2000;

/** Parses a whole file: first row is headers, everything after is data. */
export function parseItemsCsv(
  text: string,
  mappingOverride?: (ImportField | null)[]
): ParsedFile {
  const table = parseCsv(text);

  if (table.length === 0) {
    return { headers: [], mapping: [], rows: [] };
  }

  const headers = table[0].map((h) => h.trim());
  const mapping = mappingOverride ?? guessMapping(headers);

  const rows = table
    .slice(1, MAX_IMPORT_ROWS + 1)
    // Pair each row with its line in the file *before* discarding blanks,
    // so "line 14" means line 14 of their spreadsheet.
    .map((cells, index) => ({ cells, line: index + 2 }))
    // Rows that are entirely empty aren't errors — a spreadsheet export
    // trailing a dozen blank lines shouldn't produce a dozen complaints.
    .filter(({ cells }) => cells.some((cell) => cell.trim() !== ""))
    .map(({ cells, line }) => validateRow(cells, mapping, line));

  return { headers, mapping, rows };
}

/** The template offered on the import page, so a first-timer has a shape to copy. */
export const CSV_TEMPLATE = [
  "name,category,quantity,condition,location,description,tags,photo",
  'Yorick\'s skull,prop,1,fair,Shelf B,"Cast resin, aged finish",graveyard;hamlet,https://example.com/skull.jpg',
  "Brass candlestick,prop,6,excellent,Shelf C,Single taper 11in,brass;lighting,",
  'Crimson velvet cloak,costume,2,needs repair,Rack 3,"Floor length, gold frogging",velvet;red,https://example.com/cloak.jpg',
].join("\n");
