// "Haven't you imported this already?" before an import goes in.
//
// An import only ever adds: the same spreadsheet twice gives two of
// everything. So before importing, each row is compared with what the
// theatre already has. A row is "already here" when an existing item has the
// same name (ignoring case and spacing) and is in the same place, or both are
// unfiled. A row headed for a place that doesn't exist yet can't be already
// here.
//
// Matching is one-to-one: a sheet listing two Silver Trays in box A, against
// an inventory with one there, finds one already here and one new. That's
// what keeps a sheet with a few added rows importing just the added ones.
//
// Pure, so the rule is tested on its own (import-duplicates.test.mjs).

import { sameNameKey } from "@/lib/item-copies";

export type IncomingRowKey = { line: number; name: string; locationName: string | null };
export type ExistingItemKey = { id: string; name: string; location_id: string | null };

/**
 * Where a row's place name points: an id, null for a row with no place, or
 * undefined for a place that doesn't exist yet.
 */
export type ResolvePlace = (locationName: string | null) => string | null | undefined;

export type AlreadyHere = { line: number; itemId: string };

export function findAlreadyHere(
  rows: IncomingRowKey[],
  existing: ExistingItemKey[],
  resolvePlace: ResolvePlace
): AlreadyHere[] {
  const pool = new Map<string, string[]>();
  for (const item of existing) {
    const key = `${item.location_id ?? ""}\u0000${sameNameKey(item.name)}`;
    const ids = pool.get(key);
    if (ids) ids.push(item.id);
    else pool.set(key, [item.id]);
  }

  const found: AlreadyHere[] = [];
  for (const row of rows) {
    const place = resolvePlace(row.locationName);
    if (place === undefined) continue;
    const ids = pool.get(`${place ?? ""}\u0000${sameNameKey(row.name)}`);
    const itemId = ids?.shift();
    if (itemId) found.push({ line: row.line, itemId });
  }
  return found;
}
