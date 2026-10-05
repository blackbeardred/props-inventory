// Reading the model's description of a new item's photo into form values.
//
// Kept apart from the API call (./describe-item.ts) so it can be tested
// without a key, and without loading sharp. Everything the model says is
// treated as a suggestion to be cleaned: the person adding the item sees
// every field before anything is saved.

export type ItemCategory = "prop" | "costume";
export type ItemCondition = "new" | "good" | "fair" | "needs_repair";

export type PhotoSuggestion = {
  /** What a shelf label would say: "White cup", "Red velvet cloak". */
  name: string;
  category: ItemCategory;
  /** One sentence of what's visible, or "" when there's nothing useful. */
  description: string;
  /** Only when the photo makes it obvious; usually null. */
  condition: ItemCondition | null;
  /** Hidden search tags (items.auto_tags), never shown. */
  tags: string[];
};

const MAX_NAME = 60;
const MAX_DESCRIPTION = 300;
export const MAX_TAGS = 15;
const MAX_TAG_LENGTH = 40;
const CONDITIONS: ItemCondition[] = ["new", "good", "fair", "needs_repair"];

function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

/**
 * Lowercase, trimmed, de-duplicated, sensible length, at most 15. Used for
 * the model's tags and for tags that come back from the add-item form,
 * which arrive from the browser and so are checked like any other input.
 */
export function cleanTags(value: unknown, max = MAX_TAGS): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const tag = entry.trim().toLowerCase().replace(/\s+/g, " ");
    if (!tag || tag.length > MAX_TAG_LENGTH || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= max) break;
  }
  return tags;
}

/** "white cup." → "White cup": a label, not a sentence. */
function cleanName(value: unknown): string {
  if (typeof value !== "string") return "";
  let name = value.replace(/\s+/g, " ").trim().replace(/^["'“”]+|["'“”]+$/g, "").replace(/[.!]+$/, "").trim();
  if (name.length > MAX_NAME) name = name.slice(0, MAX_NAME).replace(/\s+\S*$/, "").trim() || name.slice(0, MAX_NAME);
  return name ? name[0].toUpperCase() + name.slice(1) : "";
}

function cleanDescription(value: unknown): string {
  if (typeof value !== "string") return "";
  let text = value.replace(/\s+/g, " ").trim();
  if (text.length > MAX_DESCRIPTION) text = `${text.slice(0, MAX_DESCRIPTION - 1).replace(/\s+\S*$/, "")}…`;
  return text;
}

/**
 * The model's reply as a suggestion, or null when there's nothing usable in
 * it — no JSON object, or no name. A missing or odd category falls back to
 * "prop"; a condition is only kept when it's one of the four the app knows.
 */
export function parsePhotoSuggestion(raw: string): PhotoSuggestion | null {
  let parsed: unknown;
  const text = stripFences(raw);
  try {
    parsed = JSON.parse(text);
  } catch {
    // A sentence before or after the object: take the object.
    const match = /\{[\s\S]*\}/.exec(text);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const fields = parsed as Record<string, unknown>;

  const name = cleanName(fields.name);
  if (!name) return null;

  const category: ItemCategory =
    typeof fields.category === "string" && fields.category.trim().toLowerCase() === "costume" ? "costume" : "prop";
  const conditionRaw =
    typeof fields.condition === "string" ? fields.condition.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  const condition = (CONDITIONS as string[]).includes(conditionRaw) ? (conditionRaw as ItemCondition) : null;

  return {
    name,
    category,
    description: cleanDescription(fields.description),
    condition,
    tags: cleanTags(fields.tags),
  };
}

/**
 * The tags an item is saved with when its photo was described: the ones
 * generated at save time (from the name as finally written) first, then the
 * photo's, without repeats. Capped a little above either list alone.
 */
export function mergeTags(fromSave: string[], fromPhoto: string[], max = 20): string[] {
  return cleanTags([...fromSave, ...fromPhoto], max);
}
