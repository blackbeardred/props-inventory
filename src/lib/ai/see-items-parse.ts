// Reading the model's reply about a photo into objects.
//
// Kept apart from the API call so it can be tested without a key — and
// without loading sharp, whose native binary belongs to whichever platform
// installed it.

/** A cluttered prop table is long; beyond this the list stops being reviewable. */
const MAX_OBJECTS = 40;

export type SeenBox = { x: number; y: number; width: number; height: number };

export type SeenObject = {
  name: string;
  search: string;
  quantity: number;
  box: SeenBox | null;
  note: string | null;
};

export type SeeResult =
  | { ok: true; objects: SeenObject[] }
  | { ok: false; reason: string };

const MAX_NAME = 80;
const MAX_SEARCH = 60;
const MAX_NOTE = 160;

function clampPercent(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(100, Math.max(0, number));
}

function readBox(raw: unknown): SeenBox | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;

  const x = clampPercent(source.x);
  const y = clampPercent(source.y);
  const width = clampPercent(source.width);
  const height = clampPercent(source.height);
  if (x === null || y === null || width === null || height === null) return null;
  if (width <= 0 || height <= 0) return null;

  // A box running off the edge is the model being approximate, not wrong;
  // trim it rather than dropping a usable crop.
  return {
    x,
    y,
    width: Math.min(width, 100 - x),
    height: Math.min(height, 100 - y),
  };
}

/**
 * Turns the model's reply into objects, dropping anything malformed rather
 * than trusting it. Exported so the shapes it has to survive can be tested
 * without calling the API.
 */
export function parseSeenObjects(raw: string): SeenObject[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const objects: SeenObject[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const source = entry as Record<string, unknown>;

    const name = typeof source.name === "string" ? source.name.trim().slice(0, MAX_NAME) : "";
    if (!name) continue;

    const search =
      typeof source.search === "string" && source.search.trim()
        ? source.search.trim().toLowerCase().slice(0, MAX_SEARCH)
        : name.toLowerCase().slice(0, MAX_SEARCH);

    const quantityRaw = Number(source.quantity);
    const quantity =
      Number.isFinite(quantityRaw) && quantityRaw >= 1
        ? Math.min(999, Math.floor(quantityRaw))
        : 1;

    const note =
      typeof source.note === "string" && source.note.trim()
        ? source.note.trim().slice(0, MAX_NOTE)
        : null;

    objects.push({ name, search, quantity, box: readBox(source.box), note });
    if (objects.length >= MAX_OBJECTS) break;
  }
  return objects;
}
