// Turning items into the rows of a spreadsheet.
//
// Kept apart from the route that serves it so the shape of an export — which
// columns, in what order, holding what — can be tested without a database.
// The format is the importer's own: what comes out here goes back in through
// /items/import unchanged.

import { CATEGORY_LABELS, CONDITION_LABELS, type ItemRow } from "@/lib/inventory";

export type ExportableItem = ItemRow & {
  import_data?: Record<string, string> | null;
};

export type ExportOptions = {
  /** Full location paths by id, so "Shakespeare box" says which room it's in. */
  pathById: Map<string, string>;
  /** Signed picture links by storage path; omitted entirely when not wanted. */
  photoUrlByPath?: Map<string, string>;
};

/**
 * The headings an export carries: the fields this app knows about, then one
 * column for every heading any item kept from the sheet it was imported from,
 * in the order they were first seen. A round trip that dropped those would
 * quietly lose the donor, the inventory number and the acquisition date.
 */
export function exportHeadings(
  items: ExportableItem[],
  withPhotos: boolean
): string[] {
  const extra: string[] = [];
  for (const item of items) {
    for (const heading of Object.keys(item.import_data ?? {})) {
      if (!extra.includes(heading)) extra.push(heading);
    }
  }

  return [
    "Name",
    "Category",
    "Quantity",
    "Condition",
    "Location",
    "Description",
    ...(withPhotos ? ["Photo"] : []),
    ...extra,
  ];
}

/** The whole sheet, headings first. */
export function buildExportTable(
  items: ExportableItem[],
  { pathById, photoUrlByPath }: ExportOptions
): string[][] {
  const withPhotos = Boolean(photoUrlByPath);
  const headings = exportHeadings(items, withPhotos);
  const extraHeadings = headings.slice(withPhotos ? 7 : 6);

  const rows = items.map((item) => [
    item.name,
    CATEGORY_LABELS[item.category] ?? item.category,
    String(item.quantity),
    item.condition ? (CONDITION_LABELS[item.condition] ?? item.condition) : "",
    item.location_id ? (pathById.get(item.location_id) ?? "") : "",
    item.description ?? "",
    ...(withPhotos
      ? [item.photo_url ? (photoUrlByPath!.get(item.photo_url) ?? "") : ""]
      : []),
    ...extraHeadings.map((heading) => item.import_data?.[heading] ?? ""),
  ]);

  return [headings, ...rows];
}
