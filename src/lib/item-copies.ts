// Identical items kept in the same box, shown as one row: "Silver Tray (2)".
//
// A theatre often owns several of the same thing, entered as separate items
// (an import makes one row per line of the spreadsheet). Four "Silver Tray"
// rows in a list read as a mistake. Where they're in the same box, they are
// one stack of trays to anyone fetching them, so the Inventory page shows
// them as one.
//
// The rule (Oct 8):
//   - Same name (ignoring case and spacing) and same category, in the same
//     place, combine.
//   - Only in a place with no other places inside it: a box, or a room with
//     no boxes in it. Two trays loose in a room that does have boxes stay
//     two rows, as do trays in different boxes.
//   - Unassigned items never combine: "nowhere" isn't a box.
//
// Display only. Every item keeps its own record, photo, condition and page.
//
// Pure, so the rule is tested on its own (item-copies.test.mjs).

export type CopyCandidate = {
  id: string;
  name: string;
  category: string;
  location_id: string | null;
};

export type PlaceLink = { id: string; parent_location_id: string | null };

/** "  Silver  tray " and "Silver Tray" are the same name. */
export function sameNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The items in their original order, identical ones in the same box gathered
 * into one group at the place of the first. Every group has at least one
 * item; a group of one is an ordinary row.
 */
export function groupCopies<T extends CopyCandidate>(items: T[], places: PlaceLink[]): T[][] {
  const hasPlacesInside = new Set<string>();
  for (const place of places) {
    if (place.parent_location_id) hasPlacesInside.add(place.parent_location_id);
  }

  const groups: T[][] = [];
  const groupByKey = new Map<string, T[]>();
  for (const item of items) {
    const box = item.location_id;
    if (!box || hasPlacesInside.has(box)) {
      groups.push([item]);
      continue;
    }
    const key = `${box}\u0000${item.category}\u0000${sameNameKey(item.name)}`;
    const existing = groupByKey.get(key);
    if (existing) {
      existing.push(item);
      continue;
    }
    const group = [item];
    groupByKey.set(key, group);
    groups.push(group);
  }
  return groups;
}

/** How many there are in all: a single item can itself be "×2". */
export function copiesCount(copies: { quantity: number }[]): number {
  return copies.reduce((total, copy) => total + Math.max(1, copy.quantity || 1), 0);
}
