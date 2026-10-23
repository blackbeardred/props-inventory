/**
 * What makes search tags find things: every item says what it's made of and
 * what colour it is, in the plain words people type.
 *
 * The model is asked for materials and colours (tag-item.ts), but a model
 * answer alone was too loose: "mahogany" without "wood", "navy" without
 * "blue", and the same three words on every item ("prop", "stage",
 * "theatrical") so that a search for "prop" matched the whole inventory.
 * refineTags tidies whatever came back, and adds the everyday family word
 * for any specific material or colour it can see, in the tags or in the
 * item's own name and description. It needs no model: a cane called
 * "mahogany" is wood whether or not anyone asked.
 *
 * Pure, so the rules are tested on their own (tag-words.test.mjs).
 */

/** Material → the word people search for. */
const MATERIAL_FAMILY: Record<string, string> = {};
function materials(family: string, words: string[]) {
  MATERIAL_FAMILY[family] = family;
  for (const word of words) MATERIAL_FAMILY[word] = family;
}
materials("wood", [
  "wooden", "mahogany", "oak", "oaken", "pine", "walnut", "maple", "birch", "cedar", "teak", "ebony",
  "rosewood", "beech", "cherrywood", "bamboo", "wicker", "rattan", "plywood", "mdf", "timber", "balsa",
  "driftwood", "hardwood", "softwood", "veneer", "elm", "willow",
]);
materials("metal", [
  "metallic", "brass", "bronze", "copper", "iron", "steel", "tin", "pewter", "aluminium", "aluminum",
  "chrome", "nickel", "zinc", "gilt", "gilded", "wrought", "cast iron", "silverplate", "silverware",
]);
materials("fabric", [
  "textile", "cloth", "velvet", "silk", "cotton", "wool", "woollen", "woolen", "linen", "satin", "lace",
  "felt", "denim", "canvas", "chiffon", "tulle", "taffeta", "brocade", "tweed", "polyester", "muslin",
  "organza", "jersey", "fleece", "corduroy", "damask", "chintz", "calico", "hessian", "burlap", "knit",
  "knitted", "embroidered",
]);
materials("leather", ["suede", "leatherette", "faux leather"]);
materials("glass", ["crystal", "glassware", "stained glass"]);
materials("ceramic", ["porcelain", "china", "stoneware", "earthenware", "terracotta", "pottery", "clay", "enamel", "enamelled"]);
materials("plastic", ["resin", "vinyl", "acrylic", "polystyrene", "foam", "nylon", "pvc"]);
materials("paper", ["cardboard", "card", "parchment", "papier-mache", "cardstock", "paperboard"]);
materials("stone", ["marble", "granite", "slate", "alabaster"]);
materials("rubber", ["latex"]);
// Not "cord": on a prop that is nearly always a telephone or a lamp flex.
materials("rope", ["twine", "hemp", "jute"]);

/** Shade → the colour word people search for. Some map to two. */
const COLOUR_FAMILY: Record<string, string[]> = {};
function colours(family: string, words: string[]) {
  for (const word of [family, ...words]) {
    COLOUR_FAMILY[word] = [...new Set([...(COLOUR_FAMILY[word] ?? []), family])];
  }
}
colours("red", ["crimson", "scarlet", "maroon", "burgundy", "ruby", "vermilion", "oxblood"]);
colours("blue", ["navy", "azure", "cobalt", "sapphire", "indigo", "cerulean", "turquoise", "teal", "cyan", "denim"]);
colours("green", ["emerald", "jade", "teal", "turquoise", "khaki", "olive green", "sage green", "lime green"]);
colours("yellow", ["mustard", "ochre", "gold", "golden"]);
colours("orange", ["rust", "amber", "tangerine", "copper"]);
colours("purple", ["violet", "lavender", "lilac", "mauve", "magenta", "aubergine"]);
colours("pink", ["blush", "fuchsia"]);
colours("brown", ["tan", "beige", "khaki", "mahogany", "walnut", "sepia", "taupe", "caramel", "chestnut", "bronze"]);
colours("white", ["ivory", "cream", "off-white", "eggshell"]);
colours("black", ["ebony", "onyx"]);
colours("grey", ["gray", "charcoal", "silver", "slate", "pewter", "gunmetal"]);
colours("gold", ["golden", "gilt", "gilded", "brass"]);
colours("silver", ["silvery", "chrome", "pewter"]);
// Both spellings, whichever someone types.
for (const shades of Object.values(COLOUR_FAMILY)) {
  if (shades.includes("grey") && !shades.includes("gray")) shades.push("gray");
}

/** Words that would match every item in a theatre's storage. */
const NOISE = new Set([
  "prop", "props", "stage", "theatre", "theater", "theatrical", "performance", "show", "production",
  "item", "object", "thing", "piece", "stage prop", "theatre prop", "theater prop", "scenic",
]);

const MAX_TAGS = 24;
const MAX_TAG_LENGTH = 40;

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z-]+/).filter(Boolean);
}

/**
 * Tidies tags (lowercase, trimmed, no repeats, no noise) and adds the family
 * word for every material and colour found in the tags, the name or the
 * description. The family words are added beyond the length cap, so a long
 * answer can't crowd out "wood".
 */
export function refineTags(tags: string[], text = ""): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (tag: string) => {
    const t = tag.trim().toLowerCase().replace(/\s+/g, " ");
    if (!t || t.length > MAX_TAG_LENGTH || NOISE.has(t) || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  const families: string[] = [];
  const consider = (phrase: string) => {
    const material = MATERIAL_FAMILY[phrase];
    if (material) families.push(material);
    for (const colour of COLOUR_FAMILY[phrase] ?? []) families.push(colour);
  };
  const considerAll = (text: string) => {
    const lower = text.toLowerCase();
    const ws = words(lower);
    consider(lower.trim());
    ws.forEach((w, i) => {
      consider(w);
      if (i + 1 < ws.length) consider(`${w} ${ws[i + 1]}`);
    });
  };

  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    add(tag);
    considerAll(tag);
  }
  considerAll(text);

  const kept = out.slice(0, MAX_TAGS);
  for (const family of families) {
    if (!kept.includes(family)) kept.push(family);
  }
  return kept;
}

/** True when the tags name at least one material family and one colour. */
export function hasMaterialAndColour(tags: string[]): boolean {
  const set = new Set(tags);
  const materialFamilies = new Set(Object.values(MATERIAL_FAMILY));
  const colourFamilies = new Set(Object.values(COLOUR_FAMILY).flat());
  return [...set].some((t) => materialFamilies.has(t)) && [...set].some((t) => colourFamilies.has(t));
}
