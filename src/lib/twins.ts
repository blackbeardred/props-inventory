// Twins: props the theatre owns more than one of, that look exactly alike
// (migration 009). Two brass candlesticks bought as a pair are two real
// items, each with its own shelf and pull-list life, but no photo can tell
// them apart, so a picture of one counts for both.
//
// This file holds the rules: which items to suggest as a twin, how a link
// joins or merges sets, and which twin a prop-table photo should mark. A
// person always makes the link: two items with the same name are often two
// different things, so a suggestion is only ever a starting point.
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

/** Whether two names say the same thing, as far as twins go. */
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

// ── Linking ─────────────────────────────────────────────────────────────

/**
 * What linking item `a` with item `b` writes. Each is in a set already or
 * not. Two loners start a new set; a loner joins the other's set; two sets
 * become one (b's members move into a's). `rows` are the item_twins rows to
 * upsert, keyed on item_id.
 */
export function linkPlan(
  a: { id: string; set: string | null },
  b: { id: string; set: string | null; members?: string[] },
  newSet: () => string
): { set: string; rows: { item_id: string; twin_set: string }[] } {
  if (a.id === b.id) return { set: a.set ?? "", rows: [] };
  if (a.set && a.set === b.set) return { set: a.set, rows: [] };
  const set = a.set ?? b.set ?? newSet();
  const ids = new Set<string>([a.id, b.id]);
  // Only when b's set is being folded into a's do its other members move.
  if (a.set && b.set) for (const member of b.members ?? []) ids.add(member);
  return { set, rows: [...ids].map((item_id) => ({ item_id, twin_set: set })) };
}

/** Item ids grouped into sets: each id mapped to every member of its set,
 *  itself included, in a stable order. Ids with no set map to themselves. */
export function twinsByItem(rows: { item_id: string; twin_set: string }[]): Map<string, string[]> {
  const sets = new Map<string, string[]>();
  for (const row of rows) {
    const members = sets.get(row.twin_set) ?? [];
    if (!members.includes(row.item_id)) members.push(row.item_id);
    sets.set(row.twin_set, members);
  }
  const out = new Map<string, string[]>();
  for (const members of sets.values()) {
    const sorted = [...members].sort();
    for (const id of sorted) out.set(id, sorted);
  }
  return out;
}

// ── Which twin a photo marks ────────────────────────────────────────────

export type TwinPick = {
  key: string;
  /** The item this row is set to, or null for skip / new. */
  itemId: string | null;
  /** The reviewer chose it themselves: never changed, and it counts as taken. */
  locked: boolean;
};

/**
 * The prop-table photo screen proposes an item for each thing it sees. When
 * that item has twins, any of them would be right, so the proposal goes to
 * one that's free: not already on this production's list, not pulled for
 * another, and not proposed for an earlier row of the same photo (so a photo
 * showing both candlesticks marks both). Rows the reviewer chose are left
 * exactly as they are and are counted first. When every twin is taken the
 * row keeps what it had, and the screen says it's already listed.
 *
 * Returns the item each row should be set to, by key.
 */
export function pickFreeTwins(
  rows: TwinPick[],
  twinsOf: Map<string, string[]>,
  busy: Set<string>
): Map<string, string | null> {
  const taken = new Set(busy);
  const out = new Map<string, string | null>();
  for (const row of rows) {
    if (row.locked) {
      out.set(row.key, row.itemId);
      if (row.itemId) taken.add(row.itemId);
    }
  }
  for (const row of rows) {
    if (row.locked) continue;
    if (!row.itemId) {
      out.set(row.key, null);
      continue;
    }
    const set = twinsOf.get(row.itemId) ?? [row.itemId];
    const free = taken.has(row.itemId) ? set.find((id) => !taken.has(id)) : row.itemId;
    const chosen = free ?? row.itemId;
    out.set(row.key, chosen);
    taken.add(chosen);
  }
  // In the rows' own order, whichever pass decided each one.
  return new Map(rows.map((row) => [row.key, out.get(row.key) ?? null]));
}
