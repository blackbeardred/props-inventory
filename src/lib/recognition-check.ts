// How well does recognition find the right item? Measured, not guessed.
//
// Every picture someone confirmed ("That's it", a ticked prop-table match)
// is a photo with a known answer. Hold it out, ask which item the rest of the
// collection says it is, and see whether the right one comes back first.
// That's leave-one-out: the same test a recognition service runs on its own
// training data, here run on this theatre's own props, in its own light.
//
// Pure, with no database or browser in it, so the ranking rule can be tested
// against the SQL's (match_items: an item scores as its closest picture, and
// twins share their pictures).

export type Vector = Float32Array | number[];

/** pgvector's text form, "[0.1,0.2,…]", as supabase-js returns it. */
export function parseVector(text: string | null | undefined): Float32Array | null {
  if (typeof text !== "string" || text.length < 3 || text[0] !== "[") return null;
  const parts = text.slice(1, -1).split(",");
  const out = new Float32Array(parts.length);
  for (let i = 0; i < parts.length; i += 1) {
    const value = Number(parts[i]);
    if (!Number.isFinite(value)) return null;
    out[i] = value;
  }
  return out;
}

export function normalise(values: Vector): Float32Array {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i] * values[i];
  const magnitude = Math.sqrt(sum) || 1;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) out[i] = values[i] / magnitude;
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  let total = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) total += a[i] * b[i];
  return total;
}

/** One stored picture: an item's own photo, or one of its confirmed ones. */
export type Picture = { key: string; itemId: string; vector: Float32Array };

/**
 * Every item, ranked by how much its pictures (or its twins') look like the
 * query, closest first. `skipKey` leaves one picture out: the query's own.
 * Vectors must already be normalised (normalise()).
 */
export function rankItems(
  query: Float32Array,
  pictures: Picture[],
  twinsOf: Map<string, string[]> = new Map(),
  skipKey?: string
): { itemId: string; score: number }[] {
  const best = new Map<string, number>();
  for (const picture of pictures) {
    if (picture.key === skipKey) continue;
    const score = dot(query, picture.vector);
    for (const itemId of twinsOf.get(picture.itemId) ?? [picture.itemId]) {
      if (score > (best.get(itemId) ?? -Infinity)) best.set(itemId, score);
    }
  }
  return [...best]
    .map(([itemId, score]) => ({ itemId, score }))
    .sort((a, b) => b.score - a.score || a.itemId.localeCompare(b.itemId));
}

/** A test photo with its known answer. */
export type Trial = { key: string; itemId: string; vector: Float32Array };

export type TrialResult = {
  key: string;
  itemId: string;
  /** Where the right item came: 1 is first. Null when it can't be found at
   *  all (nothing else of it to compare against). */
  rank: number | null;
  /** What came first instead, when it wasn't the right one. */
  topItemId: string | null;
  topScore: number | null;
  rightScore: number | null;
};

export type CheckSummary = {
  /** Trials that could be scored: the item has another picture to find. */
  scored: number;
  first: number;
  topThree: number;
  /** Trials skipped: the held-out photo is the only picture of its item. */
  unscorable: number;
  results: TrialResult[];
};

/**
 * Leave-one-out over the trials. A twin counts as the right answer: a camera
 * can't tell twins apart, and the app shows every twin together.
 */
export function runCheck(
  trials: Trial[],
  pictures: Picture[],
  twinsOf: Map<string, string[]> = new Map()
): CheckSummary {
  const results: TrialResult[] = [];
  let first = 0;
  let topThree = 0;
  let unscorable = 0;
  for (const trial of trials) {
    const right = new Set(twinsOf.get(trial.itemId) ?? [trial.itemId]);
    const hasOther = pictures.some((p) => p.key !== trial.key && right.has(p.itemId));
    if (!hasOther) {
      unscorable += 1;
      results.push({ key: trial.key, itemId: trial.itemId, rank: null, topItemId: null, topScore: null, rightScore: null });
      continue;
    }
    const ranked = rankItems(trial.vector, pictures, twinsOf, trial.key);
    // The first of the right item or its twins is the rank.
    const index = ranked.findIndex((entry) => right.has(entry.itemId));
    const rank = index + 1;
    if (rank === 1) first += 1;
    if (rank <= 3) topThree += 1;
    results.push({
      key: trial.key,
      itemId: trial.itemId,
      rank,
      topItemId: ranked[0]?.itemId ?? null,
      topScore: ranked[0]?.score ?? null,
      rightScore: ranked[index]?.score ?? null,
    });
  }
  return { scored: trials.length - unscorable, first, topThree, unscorable, results };
}

/** "17 of 20 (85%)". */
export function share(count: number, total: number): string {
  if (!total) return "none to test";
  return `${count} of ${total} (${Math.round((count / total) * 100)}%)`;
}
