// Recently Deleted: the parts that are pure rules, kept apart from the
// database code (src/lib/recently-deleted.ts) so they can be tested without
// one. See supabase/migrations/007_recently_deleted.sql.

import { pluralize } from "@/lib/inventory";

/** How long a deleted thing can be restored. The user chose 30 days. */
export const KEEP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DeletedKind = "item" | "location" | "production" | "pull_list" | "pull_list_item";

export const KIND_LABELS: Record<DeletedKind, string> = {
  item: "Item",
  location: "Place",
  production: "Production",
  pull_list: "Pull list",
  pull_list_item: "Pull-list line",
};

type Row = Record<string, unknown>;

/** What a snapshot holds, by kind. Rows are as the database returned them. */
export type Snapshot =
  | { kind: "item"; item: Row; lines: Row[]; embedding: Row | null }
  | { kind: "location"; location: Row; childIds: string[]; itemIds: string[] }
  | { kind: "production"; production: Row; lists: Row[]; lines: Row[] }
  | { kind: "pull_list"; list: Row; lines: Row[]; productionName: string }
  | { kind: "pull_list_item"; line: Row; productionId: string; productionName: string; listName: string };

/** When a snapshot stops being restorable. */
export function expiresAt(deletedAt: string | Date): Date {
  return new Date(new Date(deletedAt).getTime() + KEEP_DAYS * DAY_MS);
}

/** The cut-off: anything deleted before this has had its 30 days. */
export function purgeBefore(now: Date): string {
  return new Date(now.getTime() - KEEP_DAYS * DAY_MS).toISOString();
}

/** Whole days left before it's gone, never below zero. */
export function daysLeft(deletedAt: string | Date, now: Date): number {
  return Math.max(0, Math.ceil((expiresAt(deletedAt).getTime() - now.getTime()) / DAY_MS));
}

/** "today", "yesterday", "3 days ago". */
export function deletedAgo(deletedAt: string | Date, now: Date): string {
  const days = Math.floor((now.getTime() - new Date(deletedAt).getTime()) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** The line under a deleted place: what moved out of it when it went. */
export function locationDetail(childCount: number, itemCount: number): string | null {
  const parts = [
    childCount ? pluralize(childCount, "place") : null,
    itemCount ? pluralize(itemCount, "item") : null,
  ].filter(Boolean);
  return parts.length ? `${parts.join(" and ")} were in it` : null;
}

export function productionDetail(listCount: number, lineCount: number): string | null {
  if (!listCount) return null;
  return `${pluralize(listCount, "pull list")}, ${pluralize(lineCount, "line")}`;
}

export function itemDetail(place: string | null, lineCount: number): string {
  const where = place ?? "Unassigned";
  return lineCount ? `${where} · on ${pluralize(lineCount, "pull list")}` : where;
}

/**
 * Restoring a place: which of the things that moved out of it go back.
 *
 * When a place is deleted its shelves move to the top level and the items
 * kept directly in it become unassigned. Only the ones that are still where
 * the delete left them go back in: a shelf someone has since filed inside
 * another room, or an item since given a new home, stays where it was put.
 */
export function relinkPlan(
  childIds: string[],
  itemIds: string[],
  now: {
    locations: { id: string; parent_location_id: string | null }[];
    items: { id: string; location_id: string | null }[];
  }
): {
  childIds: string[];
  itemIds: string[];
  /** Moved somewhere else since, or deleted since: left as they are. */
  movedOn: number;
} {
  const children = new Set(childIds);
  const items = new Set(itemIds);
  const backChildren = now.locations.filter((l) => children.has(l.id) && l.parent_location_id === null).map((l) => l.id);
  const backItems = now.items.filter((i) => items.has(i.id) && i.location_id === null).map((i) => i.id);
  const movedOn = childIds.length + itemIds.length - backChildren.length - backItems.length;
  return { childIds: backChildren, itemIds: backItems, movedOn };
}

/**
 * Which photos a purge may remove from storage: the paths its snapshots held
 * that no item still uses (an item restored and then deleted again, say, or
 * a re-import that reused a photo, keeps its picture).
 */
export function orphanedPhotos(paths: string[], stillUsed: string[]): string[] {
  const used = new Set(stillUsed);
  return [...new Set(paths)].filter((path) => path && !used.has(path));
}
