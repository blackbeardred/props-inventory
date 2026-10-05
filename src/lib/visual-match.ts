// Putting what the picture says next to what the name says.
//
// The prop-table screen gets two opinions about each thing in a photo: the
// app's own search, which goes by name, and the fingerprints, which go by
// what the crop looks like. Each is wrong in its own way. A name search for
// "goblet" never finds "Chalice, pewter"; a picture of one brass candlestick
// looks a great deal like the other five. This file decides how the two
// opinions are combined, and — the part that matters most — when the
// combination is sure enough to pre-select something for a person who is
// going to trust whatever is already filled in.
//
// Pure, with no Supabase or browser in it, so every rule can be tested.

import { looksLikeSameThing } from "@/lib/name-match";

/** At or above this, two photographs are very probably of the same object. */
export const STRONG_SIMILARITY = 0.9;

/** At or above this, worth offering. Below it, a picture-only match is noise. */
export const LIKELY_SIMILARITY = 0.75;

/**
 * How to describe a score to someone who is about to trust it.
 *
 * The thresholds are a first guess, deliberately cautious, and meant to be
 * moved once there are real photographs of real props to try them against.
 * Being told "probably" about a right answer costs a glance; being told
 * "certain" about a wrong one costs a prop nobody can find on opening night.
 */
export function describeSimilarity(score: number): "strong" | "likely" | "weak" {
  if (score >= STRONG_SIMILARITY) return "strong";
  if (score >= LIKELY_SIMILARITY) return "likely";
  return "weak";
}

/** The least a candidate needs, whichever way it was found. */
export type BaseCandidate = { id: string; name: string };

export type Ranked<T extends BaseCandidate> = T & {
  /** How alike the pictures are, 0..1, or null when there was nothing to compare. */
  similarity: number | null;
  /** Which of the two opinions put it on the list. */
  foundBy: "name" | "picture" | "both";
};

/** Room for every name result plus a few the name search missed. */
export const MAX_MERGED = 8;

/**
 * Combines the name search's candidates with the picture's.
 *
 * Order: anything that looks at least "likely" alike, closest first; then the
 * rest of the name results in the order the search gave them. A picture-only
 * match that isn't even likely is dropped — it adds a row to a dropdown on a
 * phone and has nothing going for it.
 *
 * When both found the same item, the name result's own fields win: it came
 * from the server with "already on this list" worked out.
 */
export function mergeCandidates<T extends BaseCandidate>(
  byName: T[],
  byPicture: (T & { similarity: number })[]
): Ranked<T>[] {
  const scores = new Map<string, number>();
  for (const hit of byPicture) {
    const previous = scores.get(hit.id);
    if (previous === undefined || hit.similarity > previous) scores.set(hit.id, hit.similarity);
  }

  const seen = new Set<string>();
  const merged: Ranked<T>[] = [];

  for (const candidate of byName) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    const similarity = scores.get(candidate.id) ?? null;
    merged.push({ ...candidate, similarity, foundBy: similarity === null ? "name" : "both" });
  }

  for (const hit of byPicture) {
    if (seen.has(hit.id) || hit.similarity < LIKELY_SIMILARITY) continue;
    seen.add(hit.id);
    merged.push({ ...hit, similarity: scores.get(hit.id) ?? hit.similarity, foundBy: "picture" });
  }

  // Stable: equal keys keep the order they arrived in, so name results that
  // the picture says nothing about stay in the search's own order.
  const rank = (candidate: Ranked<T>) =>
    candidate.similarity !== null && candidate.similarity >= LIKELY_SIMILARITY
      ? candidate.similarity
      : -1;
  return merged
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => rank(b.candidate) - rank(a.candidate) || a.index - b.index)
    .slice(0, MAX_MERGED)
    .map(({ candidate }) => candidate);
}

/**
 * The one candidate obvious enough to tick for someone, or null.
 *
 * The bar is the same as before the pictures arrived: **the names have to
 * agree.** A picture alone never ticks anything, however close — the six
 * candlesticks are the reason. What the picture adds is choosing *between*
 * the items whose names agree, and vetoing a name match it plainly
 * contradicts:
 *
 *   - Several names agree → the one that looks most alike. Without pictures,
 *     the first the search returned, as it always was.
 *   - The picture says strongly that it's some *other* item, and says the
 *     name match doesn't look alike → nothing. Two opinions disagreeing is
 *     exactly when a person should look.
 */
export function pickObvious<T extends BaseCandidate>(
  seenName: string,
  candidates: Ranked<T>[]
): Ranked<T> | null {
  const agreeing = candidates.filter((candidate) => looksLikeSameThing(seenName, candidate.name));
  if (agreeing.length === 0) return null;

  let best = agreeing[0];
  for (const candidate of agreeing) {
    if ((candidate.similarity ?? -1) > (best.similarity ?? -1)) best = candidate;
  }

  const closest = candidates.reduce<Ranked<T> | null>(
    (top, candidate) =>
      candidate.similarity !== null && candidate.similarity > (top?.similarity ?? -1)
        ? candidate
        : top,
    null
  );

  const contradicted =
    closest !== null &&
    closest.id !== best.id &&
    closest.similarity !== null &&
    closest.similarity >= STRONG_SIMILARITY &&
    best.similarity !== null &&
    best.similarity < LIKELY_SIMILARITY;

  return contradicted ? null : best;
}

/**
 * True when a name match exists but the picture vetoed it — the one case
 * where a row is left on "Skip" for a reason the reviewer should be told,
 * rather than because nothing fitted.
 */
export function picturesDisagree<T extends BaseCandidate>(
  seenName: string,
  candidates: Ranked<T>[]
): boolean {
  return (
    candidates.some((candidate) => looksLikeSameThing(seenName, candidate.name)) &&
    pickObvious(seenName, candidates) === null
  );
}

/**
 * At or above this, a confirmed photo is the same picture the item already
 * has: someone chose the item's own photo from their library, or a second
 * copy of it. Kept as an extra reference picture it would add nothing, and
 * would make the item look better recognised than it is.
 */
export const SAME_PICTURE_SIMILARITY = 0.985;

/**
 * Whether a photo a person has just confirmed as an item is worth keeping as
 * another picture of it (migration 008). Only the confirmation makes it
 * eligible at all; this only weeds out copies. A match made by name alone has
 * no score, and is kept: it's a picture nobody had compared yet.
 */
export function worthKeepingAsReference(similarity: number | null | undefined): boolean {
  if (similarity === null || similarity === undefined || !Number.isFinite(similarity)) return true;
  return similarity < SAME_PICTURE_SIMILARITY;
}
