// Deciding when a name the model gave a thing is obviously the same thing as
// an item already in the inventory.
//
// Used to pre-select a match on the photo review screen. The bar is meant to
// be high: a wrong pre-selection is worse than none, because someone scrolling
// a list of twenty rows will trust what's already filled in. "pewter tankard"
// against "Pewter tankard" should be ticked for them; "tankard" against
// "Tankard stand" should not.

/** Words that carry no identity and would otherwise inflate a match. */
const NOISE = new Set([
  "a", "an", "the", "of", "with", "and", "in", "on", "for",
  "small", "large", "old", "new", "pair", "set", "piece",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !NOISE.has(word));
}

/** Crude singular, enough for tankards and candlesticks. */
function stem(word: string): string {
  if (word.length > 3 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/**
 * True when every meaningful word of the seen name appears in the item's name
 * (or the other way round), and neither is padded out with much else.
 *
 * Containment both ways matters: "tankard" is contained in "pewter tankard"
 * but is a much vaguer thing, so it only counts as the same when the item name
 * adds little. That keeps a bare "chair" from pre-selecting "Ladderback chair,
 * carved" out of six similar ones.
 */
export function looksLikeSameThing(seenName: string, itemName: string): boolean {
  const seen = words(seenName).map(stem);
  const item = words(itemName).map(stem);
  if (seen.length === 0 || item.length === 0) return false;

  const itemSet = new Set(item);
  const seenSet = new Set(seen);

  const seenInItem = seen.filter((word) => itemSet.has(word)).length / seen.length;
  const itemInSeen = item.filter((word) => seenSet.has(word)).length / item.length;

  // Both directions have to be strong: the names describe the same thing, and
  // neither carries much the other doesn't.
  return seenInItem >= 0.99 && itemInSeen >= 0.6;
}
