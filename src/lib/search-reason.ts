// Why a search result is there, when its name doesn't say.
//
// Search matches on far more than the name: the description, the columns an
// import kept, and generated tags for what a thing is and is made of. That's
// the point — "wood" finds the guitar — but a result with nothing visibly to
// do with the word looks like a broken search. "brass" returning "Tea Set"
// reads as a bug unless the row says the word was in its notes.
//
// The generated tags themselves stay unshown, as they always have been; this
// only says *that* they were what matched.

export type ReasonSource = {
  name: string;
  description: string | null;
  importData?: Record<string, string> | null;
};

export type MatchReason = "notes" | "spreadsheet" | "what-it-is";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Prefix match per word, the same way the search itself treats a term:
 * "lant" finds "lantern", "candlestick" finds "candlesticks".
 */
function contains(haystack: string, term: string): boolean {
  if (!term) return true;
  const words = normalize(haystack).split(" ");
  return words.some((word) => word.startsWith(term));
}

/**
 * For each word that isn't in the name, where it was found instead. Empty when
 * the name accounts for every word, which is the usual case and needs no
 * explanation.
 */
export function matchReasons(
  item: ReasonSource,
  terms: string[]
): { term: string; reason: MatchReason }[] {
  const reasons: { term: string; reason: MatchReason }[] = [];
  const spreadsheet = Object.values(item.importData ?? {}).join(" ");

  for (const raw of terms) {
    const term = normalize(raw);
    if (!term || contains(item.name, term)) continue;
    if (item.description && contains(item.description, term)) {
      reasons.push({ term: raw, reason: "notes" });
    } else if (spreadsheet && contains(spreadsheet, term)) {
      reasons.push({ term: raw, reason: "spreadsheet" });
    } else {
      reasons.push({ term: raw, reason: "what-it-is" });
    }
  }
  return reasons;
}

const WORDS: Record<MatchReason, string> = {
  notes: "in its notes",
  spreadsheet: "in its spreadsheet columns",
  "what-it-is": "by what it is or is made of",
};

/** One short line, or null when the name explains itself. */
export function describeMatch(item: ReasonSource, terms: string[]): string | null {
  const reasons = matchReasons(item, terms);
  if (reasons.length === 0) return null;
  return reasons.map(({ term, reason }) => `“${term}” ${WORDS[reason]}`).join(" · ");
}
