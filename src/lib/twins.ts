// Which other items an item being deleted might be a duplicate of.
//
// Deleting an item offers "This is a duplicate of…", so its photos can go to
// the item it duplicates rather than out with it (src/lib/recently-deleted.ts,
// giveToTwin). This decides what to suggest there, and which suggestion, if
// any, starts chosen. A person always confirms: two items with the same name
// are often two real things (a theatre owns six brass candlesticks), so a
// suggestion is only ever a starting point.
//
// Pure, with no Supabase or browser in it, so every rule can be tested.

import { STRONG_SIMILARITY } from "@/lib/visual-match";

/**
 * A name reduced to what makes it that name: case, accents, punctuation and
 * spacing ignored, "&" read as "and", and the markers a copy picks up when
 * it's entered twice — "(2)", "copy", "duplicate" — dropped from the end.
 * Plain numbers are kept: "Chair 2" and "Chair 3" are usually two chairs.
 */
export function twinName(name: string): string {
  let out = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  // Repeated, so "Crown (copy) (2)" loses both.
  for (;;) {
    const next = out.replace(/\s+(copy|duplicate|dup)$/, "").replace(/^copy of\s+/, "");
    if (next === out) return out;
    out = next;
  }
}

/** Strips a trailing "(2)" or "[3]" before the name is reduced, since once
 *  the brackets are gone it can't be told from a real number. */
function withoutCopyNumber(name: string): string {
  let out = name.trim();
  for (;;) {
    const next = out.replace(/\s*[([]\s*\d+\s*[)\]]\s*$/, "").replace(/\s*[([]\s*(copy|duplicate)\s*[)\]]\s*$/i, "").trim();
    if (next === out) return out;
    out = next;
  }
}

/** Whether two names say the same thing, as far as a duplicate goes. */
export function sameTwinName(a: string, b: string): boolean {
  const left = twinName(withoutCopyNumber(a));
  return left.length > 0 && left === twinName(withoutCopyNumber(b));
}

export type TwinCandidate = {
  id: string;
  name: string;
  locationName: string | null;
};

export type TwinSuggestion = TwinCandidate & {
  sameName: boolean;
  /** How alike its photo is, 0..1, when it's an almost-certain match. */
  similarity: number | null;
};

/** How many suggestions to show. More than this and it stops being a hint. */
export const MAX_TWIN_SUGGESTIONS = 4;

/**
 * The items worth suggesting: those whose name says the same thing, and those
 * whose photo is an almost-certain match (STRONG_SIMILARITY). Both at once
 * first, then same name, then by how alike the photo is.
 */
export function suggestTwins(
  item: { id: string; name: string },
  others: TwinCandidate[],
  pictureMatches: { id: string; similarity: number }[] = []
): TwinSuggestion[] {
  const alike = new Map<string, number>();
  for (const match of pictureMatches) {
    if (match.id === item.id || !(match.similarity >= STRONG_SIMILARITY)) continue;
    alike.set(match.id, Math.max(alike.get(match.id) ?? 0, match.similarity));
  }

  const suggestions: TwinSuggestion[] = [];
  const seen = new Set<string>([item.id]);
  for (const other of others) {
    if (seen.has(other.id)) continue;
    seen.add(other.id);
    const sameName = sameTwinName(item.name, other.name);
    const similarity = alike.get(other.id) ?? null;
    if (sameName || similarity !== null) suggestions.push({ ...other, sameName, similarity });
  }

  const rank = (s: TwinSuggestion) => (s.sameName && s.similarity !== null ? 0 : s.sameName ? 1 : 2);
  return suggestions
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (b.similarity ?? 0) - (a.similarity ?? 0) ||
        a.name.localeCompare(b.name)
    )
    .slice(0, MAX_TWIN_SUGGESTIONS);
}

/** Why it's suggested, in a few words. */
export function twinReason(suggestion: TwinSuggestion): string {
  if (suggestion.sameName && suggestion.similarity !== null) return "same name, and its photo looks just like this one";
  if (suggestion.sameName) return "same name";
  return "its photo looks just like this one";
}
