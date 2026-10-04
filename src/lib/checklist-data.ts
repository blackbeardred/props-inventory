// Loading a production's pull-list rows in the shape the checklist works in.
//
// Shared by the checklist and the pull-issues page, because both want the same
// thing: every row on the production's lists, with the item's name, where it
// lives, and whether anyone has checked it.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChecklistRow, CheckState } from "@/lib/checklist";
import type { LocationNode } from "@/lib/locations";

type RawRow = {
  id: string;
  pull_list_id: string;
  quantity_needed: number;
  status: "pending" | "pulled" | "returned" | null;
  check_state: CheckState | null;
  checked_at: string | null;
  checked_by: string | null;
  items: { id: string; name: string; photo_url: string | null; location_id: string | null } | null;
};

export type ChecklistData = {
  rows: ChecklistRow[];
  locations: LocationNode[];
  /** Photo storage paths, for the caller to sign in one batch. */
  photoPaths: string[];
  photoPathByRowId: Map<string, string>;
};

/**
 * Every row on the given pull lists, ready to group. Returns empty rather than
 * throwing when there are no lists — a production with nothing on it is a
 * normal state, not an error.
 */
export async function loadChecklistRows(
  // The generated database types aren't wired up in this project, so the
  // client is used loosely here and the shapes are asserted below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  pullListIds: string[]
): Promise<ChecklistData> {
  const empty: ChecklistData = {
    rows: [],
    locations: [],
    photoPaths: [],
    photoPathByRowId: new Map(),
  };
  if (pullListIds.length === 0) return empty;

  const [{ data: rawRows }, { data: locationRows }] = await Promise.all([
    supabase
      .from("pull_list_items")
      .select(
        "id, pull_list_id, quantity_needed, status, check_state, checked_at, checked_by, items(id, name, photo_url, location_id)"
      )
      .in("pull_list_id", pullListIds),
    supabase.from("locations").select("id, name, parent_location_id"),
  ]);

  const raw = (rawRows ?? []) as unknown as RawRow[];

  // Who did the checking, resolved in one go rather than a join per row.
  const checkerIds = [...new Set(raw.map((row) => row.checked_by).filter(Boolean))] as string[];
  const nameById = new Map<string, string>();
  if (checkerIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", checkerIds);
    for (const profile of (profiles ?? []) as { id: string; full_name: string | null }[]) {
      if (profile.full_name) nameById.set(profile.id, profile.full_name);
    }
  }

  const photoPathByRowId = new Map<string, string>();
  const rows: ChecklistRow[] = raw
    .filter((row) => row.items)
    .map((row) => {
      if (row.items?.photo_url) photoPathByRowId.set(row.id, row.items.photo_url);
      return {
        id: row.id,
        itemId: row.items!.id,
        name: row.items!.name,
        quantityNeeded: row.quantity_needed,
        checkState: row.check_state ?? "open",
        checkedAt: row.checked_at,
        checkedByName: row.checked_by ? (nameById.get(row.checked_by) ?? null) : null,
        locationId: row.items!.location_id,
        pullStatus: row.status ?? undefined,
      };
    });

  return {
    rows,
    locations: (locationRows ?? []) as unknown as LocationNode[],
    photoPaths: [...photoPathByRowId.values()],
    photoPathByRowId,
  };
}
