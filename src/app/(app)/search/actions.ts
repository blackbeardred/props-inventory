"use server";

import { createClient } from "@/lib/supabase/server";
import { locationPaths, type LocationNode } from "@/lib/locations";
import { PHOTOS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/supabase/storage";
import type { ItemRow } from "@/lib/inventory";

export type PulledFor = {
  productionId: string;
  productionName: string;
  quantity: number;
};

export type SearchResultItem = ItemRow & {
  locationName: string | null;
  photoUrl: string | null;
  /** The production it's out on, when it's out on one. */
  pulledFor: PulledFor | null;
};

export type SearchItemsResult = {
  items: SearchResultItem[];
  error: string | null;
};

const ITEM_COLUMNS =
  "id, name, category, description, photo_url, quantity, condition, location_id, created_at";

/**
 * Live search-as-you-type, called directly from the client search bar (not
 * a form submit). With text: prefix-matches every word against name +
 * description via search_items_prefix, narrowing results with each
 * keystroke. With only location chips and no text: lists everything in
 * those locations. Location names and photo signed URLs are resolved here
 * so the client only ever renders plain data.
 */
export async function searchItemsLive(
  query: string,
  locationIds: string[]
): Promise<SearchItemsResult> {
  const trimmed = query.trim();

  if (!trimmed && locationIds.length === 0) {
    return { items: [], error: null };
  }

  const supabase = await createClient();

  let rows: ItemRow[];

  if (trimmed) {
    const { data, error } = await supabase.rpc("search_items_prefix", {
      search_query: trimmed,
      location_ids: locationIds.length > 0 ? locationIds : null,
    });
    if (error) {
      return { items: [], error: error.message };
    }
    rows = (data ?? []) as unknown as ItemRow[];
  } else {
    // Everything beneath the chosen places too, the same as a text search
    // does — "Props Room A" means its shelves and boxes, not just what's
    // loose on its floor.
    const { data: below } = await supabase.rpc("location_descendants", {
      p_ids: locationIds,
    });
    const ids = [
      ...new Set([
        ...locationIds,
        ...((below ?? []) as unknown[]).map((row) =>
          typeof row === "string" ? row : String(Object.values(row as object)[0])
        ),
      ]),
    ];
    const { data, error } = await supabase
      .from("items")
      .select(ITEM_COLUMNS)
      .in("location_id", ids)
      .order("name");
    if (error) {
      return { items: [], error: error.message };
    }
    rows = (data ?? []) as unknown as ItemRow[];
  }

  const locationIdsToResolve = Array.from(
    new Set(
      rows.map((row) => row.location_id).filter((id): id is string => Boolean(id))
    )
  );
  // Full paths, which needs every location rather than just the ones these
  // results sit in — a box's path runs through rooms no result is filed in.
  let locationNameById = new Map<string, string>();
  if (locationIdsToResolve.length > 0) {
    const { data: locationRows } = await supabase
      .from("locations")
      .select("id, name, parent_location_id");
    locationNameById = locationPaths((locationRows ?? []) as unknown as LocationNode[]);
  }

  const photoPaths = rows
    .map((row) => row.photo_url)
    .filter((path): path is string => Boolean(path));
  const photoUrlByPath = new Map<string, string>();
  if (photoPaths.length > 0) {
    const { data: signedUrls } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .createSignedUrls(photoPaths, SIGNED_URL_TTL_SECONDS);
    for (const entry of signedUrls ?? []) {
      if (entry.signedUrl && !entry.error) {
        photoUrlByPath.set(entry.path ?? "", entry.signedUrl);
      }
    }
  }

  // Whether each one is out on a show. Resolved here rather than in the
  // client so a result carries everything it needs to be shown.
  const pulledByItem = new Map<string, PulledFor>();
  if (rows.length > 0) {
    const { data: pulled } = await supabase
      .from("pull_list_items")
      .select("item_id, quantity_needed, pull_lists(productions(id, name))")
      .eq("status", "pulled")
      .in("item_id", rows.map((row) => row.id));

    for (const entry of (pulled ?? []) as unknown as {
      item_id: string;
      quantity_needed: number;
      pull_lists: { productions: { id: string; name: string } | null } | null;
    }[]) {
      const production = entry.pull_lists?.productions;
      if (!production) continue;
      const existing = pulledByItem.get(entry.item_id);
      // Two productions at once is rare and already handled this way on the
      // items list: show one, and count what's out for it.
      if (existing && existing.productionId !== production.id) continue;
      pulledByItem.set(entry.item_id, {
        productionId: production.id,
        productionName: production.name,
        quantity: (existing?.quantity ?? 0) + entry.quantity_needed,
      });
    }
  }

  const items: SearchResultItem[] = rows.map((row) => ({
    ...row,
    locationName: row.location_id
      ? (locationNameById.get(row.location_id) ?? null)
      : null,
    photoUrl: row.photo_url ? (photoUrlByPath.get(row.photo_url) ?? null) : null,
    pulledFor: pulledByItem.get(row.id) ?? null,
  }));

  return { items, error: null };
}
