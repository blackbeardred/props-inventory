// What the Delete item form needs to ask "Is this a duplicate?": whether there
// is anything to give a twin, and which items to suggest. Server only; the
// rules themselves are in ./twins.ts.

import type { createClient } from "@/lib/supabase/server";
import { EMBEDDING_MODEL } from "@/lib/embedding";
import { locationPaths, type LocationNode } from "@/lib/locations";
import { suggestTwins, type TwinSuggestion } from "@/lib/twins";

type Client = Awaited<ReturnType<typeof createClient>>;

export type TwinChoice = {
  /** False when there is nothing to hand over (no photo, no extra pictures),
   *  or migration 008 hasn't been run, so there's nowhere to put them. */
  offer: boolean;
  /** The item's photo plus its extra pictures: what a twin would get. */
  photoCount: number;
  suggestions: TwinSuggestion[];
};

/** How many photo matches to ask for, before keeping only the near-certain. */
const PICTURE_MATCHES = 6;

export async function loadTwinChoice(
  supabase: Client,
  item: { id: string; name: string; photo_url: string | null },
  locations: LocationNode[]
): Promise<TwinChoice> {
  const { count, error } = await supabase
    .from("item_reference_photos")
    .select("id", { count: "exact", head: true })
    .eq("item_id", item.id);
  if (error) return { offer: false, photoCount: 0, suggestions: [] };

  const photoCount = (item.photo_url ? 1 : 0) + (count ?? 0);
  if (photoCount === 0) return { offer: false, photoCount, suggestions: [] };

  const [{ data: others }, { data: fingerprint }] = await Promise.all([
    supabase.from("items").select("id, name, location_id").neq("id", item.id),
    supabase
      .from("item_photo_embeddings")
      .select("photo_url, model, embedding")
      .eq("item_id", item.id)
      .maybeSingle(),
  ]);

  // Its own photo, compared against everything else's. Only a fingerprint
  // taken from the photo it has now, by the current model, means anything.
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

  const places = locationPaths(locations);
  const candidates = ((others ?? []) as { id: string; name: string; location_id: string | null }[]).map(
    (other) => ({
      id: other.id,
      name: other.name,
      locationName: other.location_id ? (places.get(other.location_id) ?? null) : null,
    })
  );

  return {
    offer: true,
    photoCount,
    suggestions: suggestTwins({ id: item.id, name: item.name }, candidates, pictureMatches),
  };
}
