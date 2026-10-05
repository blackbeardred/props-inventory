/**
 * Keeping each item's visual fingerprint up to date, and finding the items a
 * photograph looks like.
 *
 * Everything here runs in the browser, for the same reason the importer
 * uploads embedded pictures from the browser: the bytes are already there.
 * Sending a thousand photographs to a server action so it could send them
 * back out to be embedded would be slower, cost a serverless invocation per
 * handful, and gain nothing — row-level security decides what may be written
 * either way.
 */

import { createClient } from "@/lib/supabase/client";
import { PHOTOS_BUCKET } from "@/lib/supabase/storage";
import {
  EMBEDDING_MODEL,
  embedImage,
  toVectorLiteral,
  type LoadProgress,
} from "@/lib/embedding";

export { describeSimilarity } from "@/lib/visual-match";

export type FingerprintTarget = {
  id: string;
  name: string;
  /** The storage path of the photo to fingerprint. */
  photoUrl: string;
  /** When the item was added, so the newest can go first. */
  createdAt: string;
  /** Set when this is one of the item's extra pictures (migration 008)
   *  rather than its own photo: the item_reference_photos row to fill in. */
  referenceId?: string;
};

export type FingerprintFailure = { name: string; reason: string };

export type FingerprintTally = {
  /** Items with a photo at all — the most that could ever be fingerprinted. */
  withPhotos: number;
  /** Already fingerprinted, against this photo and this model. */
  current: number;
  /** Needing work: never done, photo replaced since, or done by another model. */
  outstanding: FingerprintTarget[];
};

/**
 * Works out what still needs fingerprinting.
 *
 * Both lists are read whole and compared here rather than asked of Postgres as
 * a join, because supabase-js can't express "rows of A with no matching row in
 * B" without a view or a function, and at a theatre's scale — a few thousand
 * items — two small reads are cheaper than another migration.
 *
 * An item counts as outstanding when it has no fingerprint, when the stored
 * one was taken from a photo that has since been replaced, or when it was
 * taken by a different model. That last case is why `model` is stored: without
 * it, changing model would leave a mix of incomparable vectors that nothing
 * could detect.
 */
export async function takeFingerprintTally(): Promise<FingerprintTally> {
  const supabase = createClient();

  const [{ data: items, error: itemsError }, { data: existing, error: existingError }] =
    await Promise.all([
      supabase
        .from("items")
        .select("id, name, photo_url, created_at")
        .not("photo_url", "is", null)
        .order("name"),
      supabase.from("item_photo_embeddings").select("item_id, photo_url, model"),
    ]);

  if (itemsError) throw new Error(itemsError.message);
  if (existingError) throw new Error(existingError.message);

  const done = new Map<string, { photo_url: string; model: string }>();
  for (const row of (existing ?? []) as { item_id: string; photo_url: string; model: string }[]) {
    done.set(row.item_id, { photo_url: row.photo_url, model: row.model });
  }

  const rows = (items ?? []) as { id: string; name: string; photo_url: string; created_at: string }[];
  const outstanding: FingerprintTarget[] = [];
  let current = 0;

  for (const item of rows) {
    const fingerprint = done.get(item.id);
    if (fingerprint && fingerprint.photo_url === item.photo_url && fingerprint.model === EMBEDDING_MODEL) {
      current += 1;
    } else {
      outstanding.push({
        id: item.id,
        name: item.name,
        photoUrl: item.photo_url,
        createdAt: item.created_at,
      });
    }
  }

  outstanding.push(...(await referencesWithoutFingerprints()));

  return { withPhotos: rows.length, current, outstanding };
}

/**
 * Extra pictures kept from confirmed matches (migration 008) that were saved
 * on a device without the model, and so still have no fingerprint. They join
 * the same queue as item photos. Read separately and forgivingly: a theatre
 * that hasn't run 008 yet simply has none, which mustn't stop its item photos
 * being fingerprinted.
 */
async function referencesWithoutFingerprints(): Promise<FingerprintTarget[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("item_reference_photos")
    .select("id, item_id, photo_path, created_at, items(name)")
    .is("embedding", null);
  if (error || !data) return [];

  return (data as unknown as {
    id: string;
    item_id: string;
    photo_path: string;
    created_at: string;
    items: { name: string } | null;
  }[]).map((row) => ({
    id: row.item_id,
    name: row.items?.name ?? "Another picture",
    photoUrl: row.photo_path,
    createdAt: row.created_at,
    referenceId: row.id,
  }));
}

/**
 * Downloads one photo through the Supabase client rather than a signed URL.
 * The client already carries the session, so there's no URL to mint, nothing
 * to expire halfway through a long backfill, and no cross-origin request to
 * configure.
 */
async function readPhoto(path: string): Promise<Blob> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(PHOTOS_BUCKET).download(path);
  if (error || !data) throw new Error(error?.message ?? "That photo couldn't be read.");
  return data;
}

/** Fingerprints one item and stores the result. Throws with something worth
 *  showing a person if it can't. */
export async function fingerprintItem(
  orgId: string,
  target: FingerprintTarget,
  onProgress?: (progress: LoadProgress) => void
): Promise<void> {
  const blob = await readPhoto(target.photoUrl);
  const embedding = await embedImage(blob, onProgress);

  const supabase = createClient();

  if (target.referenceId) {
    const { error } = await supabase
      .from("item_reference_photos")
      .update({ model: EMBEDDING_MODEL, embedding: toVectorLiteral(embedding) })
      .eq("id", target.referenceId);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase.from("item_photo_embeddings").upsert(
    {
      item_id: target.id,
      org_id: orgId,
      photo_url: target.photoUrl,
      model: EMBEDDING_MODEL,
      embedding: toVectorLiteral(embedding),
    },
    { onConflict: "item_id" }
  );

  if (error) throw new Error(error.message);
}

export type RunProgress = {
  done: number;
  failed: number;
  total: number;
  /** The item being worked on, so a long run doesn't look stuck. */
  current: string | null;
};

/**
 * Fingerprints everything outstanding, one at a time.
 *
 * Deliberately sequential, unlike the photo uploads, which run four at once.
 * Uploading is waiting on the network and parallelism helps; this is the CPU
 * doing arithmetic, and asking for four at once on a laptop makes each one
 * slower and the page unresponsive while it happens.
 *
 * A failure is recorded and the run carries on. One unreadable photo in two
 * thousand should not cost someone the other 1,999.
 */
export async function runFingerprints(
  orgId: string,
  targets: FingerprintTarget[],
  onProgress: (progress: RunProgress) => void,
  onLoadProgress?: (progress: LoadProgress) => void,
  shouldStop?: () => boolean
): Promise<{ done: number; failures: FingerprintFailure[] }> {
  const failures: FingerprintFailure[] = [];
  let done = 0;

  for (const target of targets) {
    if (shouldStop?.()) break;

    onProgress({ done, failed: failures.length, total: targets.length, current: target.name });
    try {
      await fingerprintItem(orgId, target, onLoadProgress);
      done += 1;
    } catch (error) {
      failures.push({
        name: target.name,
        reason: error instanceof Error ? error.message : "Unknown problem",
      });
    }
  }

  onProgress({ done, failed: failures.length, total: targets.length, current: null });
  return { done, failures };
}

export type Lookalike = {
  id: string;
  name: string;
  category: string;
  locationName: string | null;
  quantity: number;
  /** 0..1, higher being more alike. */
  similarity: number;
  /** A short-lived URL for showing the stored photo beside the new one. */
  photoUrl: string | null;
};

/** Signed URLs live this long — long enough to sit on a review screen. */
const PREVIEW_URL_TTL = 60 * 60;

/**
 * The items whose photographs look most like the one given.
 *
 * match_items returns ids and scores; the items themselves are fetched
 * separately so that "may I see this item" is decided by the items policy, in
 * the one place it is decided everywhere else.
 */
export async function findLookalikes(blob: Blob, limit = 5): Promise<Lookalike[]> {
  return matchEmbedding(await embedImage(blob), limit);
}

/**
 * The same, for a fingerprint already in hand — the prop-table screen takes
 * one per crop and would otherwise be re-embedding nothing.
 */
export async function matchEmbedding(embedding: number[], limit = 5): Promise<Lookalike[]> {
  const supabase = createClient();

  const { data: matches, error } = await supabase.rpc("match_items", {
    query_embedding: toVectorLiteral(embedding),
    match_count: limit,
  });
  if (error) throw new Error(error.message);

  const scored = (matches ?? []) as { item_id: string; similarity: number }[];
  if (scored.length === 0) return [];

  const { data: items, error: itemsError } = await supabase
    .from("items")
    .select("id, name, category, quantity, photo_url, locations(name)")
    .in(
      "id",
      scored.map((row) => row.item_id)
    );
  if (itemsError) throw new Error(itemsError.message);

  const byId = new Map(
    ((items ?? []) as unknown as {
      id: string;
      name: string;
      category: string;
      quantity: number;
      photo_url: string | null;
      locations: { name: string } | null;
    }[]).map((item) => [item.id, item])
  );

  // One request for every photo rather than one per match.
  const paths = [...byId.values()]
    .map((item) => item.photo_url)
    .filter((path): path is string => Boolean(path));
  const signedByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .createSignedUrls(paths, PREVIEW_URL_TTL);
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) signedByPath.set(entry.path, entry.signedUrl);
    }
  }

  const results: Lookalike[] = [];
  for (const match of scored) {
    const item = byId.get(match.item_id);
    // A match whose item the items policy won't return isn't an error — it
    // just doesn't belong to this theatre, so it silently isn't shown.
    if (!item) continue;

    results.push({
      id: item.id,
      name: item.name,
      category: item.category,
      locationName: item.locations?.name ?? null,
      quantity: item.quantity,
      similarity: match.similarity,
      photoUrl: item.photo_url ? (signedByPath.get(item.photo_url) ?? null) : null,
    });
  }

  return results;
}

/**
 * Whether an error means the fingerprints table or match_items isn't there —
 * migration 006 not yet run. Worth telling apart from a passing network
 * failure: one is fixed by trying again, the other never will be.
 */
export function isMissingFingerprintSchema(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /item_photo_embeddings|match_items|schema cache|does not exist/i.test(message);
}
