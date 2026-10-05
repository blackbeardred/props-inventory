// Twins in the database (migration 009): reading a set, linking, leaving,
// and what the item page's Twins section shows. Server only; the rules
// themselves are in ./twins.ts.
//
// Every read is forgiving: before 009 is run the table doesn't exist, and an
// inventory without twins must work exactly as it did.

import { randomUUID } from "node:crypto";
import type { createClient } from "@/lib/supabase/server";
import { EMBEDDING_MODEL } from "@/lib/embedding";
import { locationPaths, type LocationNode } from "@/lib/locations";
import { linkPlan, suggestTwins, sameTwinName, type TwinSuggestion } from "@/lib/twins";

type Client = Awaited<ReturnType<typeof createClient>>;

export type TwinRow = { item_id: string; twin_set: string };
export type TwinItem = { id: string; name: string; locationName: string | null };

/** The twin rows for these items and every other member of their sets.
 *  Empty when there are none, or when migration 009 hasn't been run. */
export async function loadTwinRows(supabase: Client, itemIds: string[]): Promise<TwinRow[]> {
  if (!itemIds.length) return [];
  const { data: mine, error } = await supabase
    .from("item_twins")
    .select("item_id, twin_set")
    .in("item_id", itemIds);
  if (error || !mine?.length) return [];
  const sets = [...new Set((mine as TwinRow[]).map((row) => row.twin_set))];
  const { data: all } = await supabase.from("item_twins").select("item_id, twin_set").in("twin_set", sets);
  return ((all ?? mine) as TwinRow[]).map((row) => ({ item_id: row.item_id, twin_set: row.twin_set }));
}

/** An item's set and the other items in it, or null when it has none. */
export async function twinSetOf(
  supabase: Client,
  itemId: string
): Promise<{ set: string; others: string[] } | null> {
  const rows = await loadTwinRows(supabase, [itemId]);
  const set = rows.find((row) => row.item_id === itemId)?.twin_set;
  if (!set) return null;
  return { set, others: rows.filter((row) => row.twin_set === set && row.item_id !== itemId).map((row) => row.item_id) };
}

/**
 * Links two items as twins: a new set, one joining the other's, or two sets
 * becoming one. Both must be the theatre's own, which reading them through
 * the items policy checks.
 */
export async function linkAsTwins(
  supabase: Client,
  itemId: string,
  twinId: string
): Promise<{ ok: true; twinName: string } | { ok: false; message: string }> {
  if (itemId === twinId) return { ok: false, message: "An item can’t be its own twin." };

  const { data: items } = await supabase.from("items").select("id, name, org_id").in("id", [itemId, twinId]);
  const rows = (items ?? []) as { id: string; name: string; org_id: string }[];
  const item = rows.find((row) => row.id === itemId);
  const twin = rows.find((row) => row.id === twinId);
  if (!item || !twin) return { ok: false, message: "That item isn’t there any more." };
  if (item.org_id !== twin.org_id) return { ok: false, message: "Twins have to belong to the same theatre." };

  const existing = await loadTwinRows(supabase, [itemId, twinId]);
  const setOf = (id: string) => existing.find((row) => row.item_id === id)?.twin_set ?? null;
  const twinSet = setOf(twinId);
  const plan = linkPlan(
    { id: itemId, set: setOf(itemId) },
    {
      id: twinId,
      set: twinSet,
      members: existing.filter((row) => twinSet && row.twin_set === twinSet).map((row) => row.item_id),
    },
    () => randomUUID()
  );
  if (!plan.rows.length) return { ok: true, twinName: twin.name };

  const { error } = await supabase.from("item_twins").upsert(
    plan.rows.map((row) => ({ ...row, org_id: item.org_id })),
    { onConflict: "item_id" }
  );
  if (error) {
    return {
      ok: false,
      message: /item_twins|schema cache|does not exist/i.test(error.message)
        ? "Twins aren’t set up yet: migration 009 needs running in Supabase."
        : error.message,
    };
  }
  return { ok: true, twinName: twin.name };
}

/** Takes an item out of its set. Its twins stay twins of one another. */
export async function leaveTwins(supabase: Client, itemId: string): Promise<string | null> {
  const { error } = await supabase.from("item_twins").delete().eq("item_id", itemId);
  return error ? error.message : null;
}

export type TwinPanel = {
  /** False before migration 009, so the section isn't offered at all. */
  available: boolean;
  twins: TwinItem[];
  suggestions: TwinSuggestion[];
  /** Its own photo plus its extra pictures: what a twin gets if it's deleted. */
  photoCount: number;
};

/** How many photo matches to ask for, before keeping only the near-certain. */
const PICTURE_MATCHES = 8;

/** What the item page's Twins section shows: its twins, and likely ones. */
export async function loadTwinPanel(
  supabase: Client,
  item: { id: string; name: string; photo_url: string | null },
  locations: LocationNode[]
): Promise<TwinPanel> {
  const probe = await supabase.from("item_twins").select("item_id").limit(1);
  if (probe.error) return { available: false, twins: [], suggestions: [], photoCount: 0 };

  const [mine, { data: others }, { data: fingerprint }, { count: pictures }] = await Promise.all([
    twinSetOf(supabase, item.id),
    supabase.from("items").select("id, name, location_id").neq("id", item.id),
    supabase
      .from("item_photo_embeddings")
      .select("photo_url, model, embedding")
      .eq("item_id", item.id)
      .maybeSingle(),
    supabase
      .from("item_reference_photos")
      .select("id", { count: "exact", head: true })
      .eq("item_id", item.id),
  ]);

  const places = locationPaths(locations);
  const candidates = ((others ?? []) as { id: string; name: string; location_id: string | null }[]).map(
    (other) => ({
      id: other.id,
      name: other.name,
      locationName: other.location_id ? (places.get(other.location_id) ?? null) : null,
    })
  );
  const twinIds = new Set(mine?.others ?? []);

  // Its own photo against everyone else's. Only a fingerprint of the photo
  // it has now, by the current model, means anything.
  let pictureMatches: { id: string; similarity: number }[] = [];
  const print = fingerprint as { photo_url: string; model: string; embedding: string } | null;
  if (print && print.photo_url === item.photo_url && print.model === EMBEDDING_MODEL && print.embedding) {
    const { data: matches } = await supabase.rpc("match_items", {
      query_embedding: print.embedding,
      match_count: PICTURE_MATCHES,
    });
    pictureMatches = ((matches ?? []) as { item_id: string; similarity: number }[]).map((match) => ({
      id: match.item_id,
      similarity: match.similarity,
    }));
  }

  return {
    available: true,
    photoCount: (item.photo_url ? 1 : 0) + (pictures ?? 0),
    // By id: the order trashItem picks the twin that gets the photos in.
    twins: candidates
      .filter((candidate) => twinIds.has(candidate.id))
      .sort((a, b) => a.id.localeCompare(b.id)),
    suggestions: suggestTwins(
      { id: item.id, name: item.name },
      candidates.filter((candidate) => !twinIds.has(candidate.id)),
      pictureMatches
    ),
  };
}

/** Items already in the inventory under the same name (twins.ts's sense of
 *  "same"), for Add item's "Is this another one of those?". */
export async function findSameNamed(
  supabase: Client,
  name: string,
  limit = 3
): Promise<TwinItem[]> {
  const trimmed = name.trim();
  if (trimmed.length < 2) return [];
  const { data } = await supabase.rpc("search_items_prefix", {
    search_query: trimmed,
    location_ids: null,
  });
  const hits = ((data ?? []) as { id: string; name: string; location_id: string | null }[]).filter((hit) =>
    sameTwinName(trimmed, hit.name)
  );
  if (!hits.length) return [];
  const { data: locations } = await supabase.from("locations").select("id, name, parent_location_id");
  const places = locationPaths((locations ?? []) as LocationNode[]);
  return hits.slice(0, limit).map((hit) => ({
    id: hit.id,
    name: hit.name,
    locationName: hit.location_id ? (places.get(hit.location_id) ?? null) : null,
  }));
}
