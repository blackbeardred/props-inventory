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
};

function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
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
  const taken = new Set<ImportField>();
  return headers.map((header) => {
    const field = matchHeader(header);
    if (!field || taken.has(field)) return null;
    taken.add(field);
    return field;
  });
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

const CONDITION_WORDS: Record<string, Condition> = {
  new: "new",
  good: "good",
  fine: "good",
  fair: "fair",
  ok: "fair",
  poor: "needs_repair",
  needsrepair: "needs_repair",
  repair: "needs_repair",
  broken: "needs_repair",
  damaged: "needs_repair",
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

  return {
    line,
    name,
    category,
    description,
    quantity,
    condition,
    locationName,
    tags,
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
  "name,category,quantity,condition,location,description,tags",
  'Yorick\'s skull,prop,1,fair,Shelf B,"Cast resin, aged finish",graveyard;hamlet',
  "Brass candlestick,prop,6,good,Shelf C,Single taper 11in,brass;lighting",
  'Crimson velvet cloak,costume,2,needs repair,Rack 3,"Floor length, gold frogging",velvet;red',
].join("\n");
