/**
 * Reading a photo of a prop table or a set into a list of things.
 *
 * Someone points a phone at the table before a show; this turns that into
 * "a brass candlestick, two pewter tankards, a leather-bound book" — names
 * and search words, not item ids. Deciding which of the theatre's actual
 * items those are happens afterwards, by running each one through the
 * inventory's own search, so this works the same whether the company owns
 * fifty things or five thousand.
 *
 * Unlike tagging, a failure here can't be swallowed: someone is standing in
 * a storage room waiting for an answer, and silence would read as the app
 * being broken. Every failure comes back with something to show them.
 */

import sharp from "sharp";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

// Claude downscales vision input to about this size anyway, so anything
// larger is upload time and tokens spent for no extra accuracy.
const MAX_DIMENSION = 1568;
const JPEG_QUALITY = 82;

const VISION_MODEL = "claude-haiku-4-5-20251001";

/** A cluttered prop table is long; beyond this the list stops being reviewable. */
const MAX_OBJECTS = 40;

const SYSTEM_PROMPT = [
  "You are looking at a photograph taken in a theatre — a prop table before a show, a set, a shelf in a storage room.",
  "List the portable things a props or wardrobe person would keep in an inventory.",
  "",
  "Include: hand props, furniture and set dressing that gets struck, costume pieces and accessories, instruments, tableware, weapons, books and papers.",
  "Ignore: people, the floor, walls, curtains, lighting rigs, the building itself, and anything so far out of focus you would be guessing.",
  "",
  "For each distinct kind of object, give:",
  '- "name": what a theatre person would call it, a few words, no invented detail ("pewter tankard", not "antique 18th-century tankard")',
  '- "search": two to four plain words to look it up by, lowercase, most distinctive first ("tankard pewter")',
  '- "quantity": how many of that kind you can actually see, as a whole number',
  '- "box": roughly where it is, as {"x","y","width","height"} in percentages of the image, 0-100, x/y being the top-left corner. Cover the object with a little room to spare. For several of a kind, box them all together.',
  '- "note": only if something is genuinely unclear — "half hidden behind the chair", "could be brass or gold-painted". Leave it out otherwise.',
  "",
  "Group identical things into one entry with a quantity. Keep things that differ separate, even if they are similar.",
  "Do not guess at what is out of frame, and do not pad the list.",
  "",
  'Respond with ONLY a JSON array. No markdown, no commentary. Example:',
  '[{"name":"pewter tankard","search":"tankard pewter","quantity":4,"box":{"x":12,"y":40,"width":26,"height":30}}]',
].join("\n");

const SUPPORTED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

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

/** Downscales to something worth sending, keeping EXIF rotation honest. */
async function prepare(
  bytes: Uint8Array,
  mediaType: string
): Promise<{ base64: string; mediaType: string }> {
  try {
    const resized = await sharp(Buffer.from(bytes))
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    return { base64: resized.toString("base64"), mediaType: "image/jpeg" };
  } catch (error) {
    console.error("seeItems: couldn't downscale the photo, sending as-is", error);
    return { base64: Buffer.from(bytes).toString("base64"), mediaType };
  }
}

/** Lists what's in a photo, or says why it couldn't. */
export async function seeItems(photo: {
  bytes: Uint8Array;
  mediaType: string;
}): Promise<SeeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      reason:
        "Reading photos isn’t set up yet — this needs an ANTHROPIC_API_KEY in the site’s environment variables.",
    };
  }

  if (!SUPPORTED_MEDIA_TYPES.has(photo.mediaType)) {
    return { ok: false, reason: "That file isn’t a photo this can read." };
  }

  try {
    const { base64, mediaType } = await prepare(photo.bytes, photo.mediaType);

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: "What's on this table?" },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error(
        "seeItems: Anthropic API returned",
        response.status,
        await response.text().catch(() => "")
      );
      return {
        ok: false,
        reason:
          response.status === 401
            ? "The site’s Anthropic API key was refused."
            : "Couldn’t read the photo just now — the service that looks at it didn’t answer.",
      };
    }

    const data = (await response.json()) as {
      content?: { type: string; text?: string }[];
    };
    const textBlock = data.content?.find((block) => block.type === "text");
    if (!textBlock?.text) {
      return { ok: false, reason: "Nothing came back from reading that photo." };
    }

    return { ok: true, objects: parseSeenObjects(textBlock.text) };
  } catch (error) {
    console.error("seeItems: failed to read photo", error);
    return { ok: false, reason: "Couldn’t read that photo. Try again in a moment." };
  }
}
