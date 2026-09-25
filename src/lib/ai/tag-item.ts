/**
 * Search tagging. Asks Claude for a handful of lowercase tags describing an
 * item — what it is, what it's made of, what it's for — which are stored in
 * items.auto_tags and folded into full-text search. They are never shown
 * anywhere in the UI; their whole job is to make a search for "wood" find a
 * wooden chest, a wooden table and a guitar, none of which need the word
 * written anywhere.
 *
 * Tags come from the item's own words (name, category, description) and,
 * when there is one, its photo — in a single call, so the model can see both
 * at once. An item with no photo still gets tagged, which is the main reason
 * this replaced the photo-only tagging it grew out of.
 *
 * This must never break an item save: a missing API key, network failure,
 * API error or unparsable response is swallowed here and treated as "no tags"
 * (an empty array), logged server-side. Saving items works identically with
 * or without ANTHROPIC_API_KEY configured.
 */

import sharp from "sharp";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

// Claude downscales vision input to roughly this size anyway, so sending
// anything larger costs upload time and tokens for no accuracy gain.
const MAX_TAGGING_DIMENSION = 1568;
const TAGGING_JPEG_QUALITY = 82;

const TAGGING_MODEL = "claude-haiku-4-5-20251001";

const MAX_TAGS = 15;
const MAX_TAG_LENGTH = 40;

const SYSTEM_PROMPT = [
  "You are tagging a theatre prop or costume so that staff can find it again by searching an inventory.",
  "",
  "Given the item's name, category, description, and a photo when one is provided, list short lowercase search tags covering:",
  "- what the object is, and the broader kinds of thing it belongs to (a guitar is also an instrument)",
  "- what it is made of, including the obvious materials nobody writes down (a guitar is wood; a cloak is fabric)",
  "- its dominant colours",
  "- its style or period, where that is evident",
  "- what it would plausibly be used for on stage",
  "",
  "Only include something you would confidently expect of this object — guess materials, don't invent details.",
  "Prefer single common words that someone would actually type into a search box.",
  "",
  "Respond with ONLY a JSON array of 5 to 15 lowercase strings. No markdown, no explanation.",
  'Example, for "Acoustic guitar" described as "six string, with hard case":',
  '["guitar", "instrument", "music", "wood", "strings", "acoustic", "brown", "case"]',
].join("\n");

const SUPPORTED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export type TagItemInput = {
  name: string;
  category?: string | null;
  description?: string | null;
  photo?: { bytes: Uint8Array; mediaType: string } | null;
};

function parseTagList(raw: string): string[] {
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

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "string") continue;
    const tag = entry.trim().toLowerCase();
    if (!tag || tag.length > MAX_TAG_LENGTH || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

/**
 * Downscales a photo to a JPEG suitable for tagging, falling back to the
 * original bytes if sharp can't read it — tagging still gets a shot rather
 * than being skipped. Only ever affects the copy sent for tagging, never the
 * file stored in Supabase Storage.
 */
async function prepareForTagging(
  photoBytes: Uint8Array,
  mediaType: string
): Promise<{ base64: string; mediaType: string }> {
  try {
    const resized = await sharp(Buffer.from(photoBytes))
      .rotate() // respect EXIF orientation before resizing
      .resize({
        width: MAX_TAGGING_DIMENSION,
        height: MAX_TAGGING_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: TAGGING_JPEG_QUALITY })
      .toBuffer();
    return { base64: resized.toString("base64"), mediaType: "image/jpeg" };
  } catch (error) {
    console.error(
      "generateTags: couldn't downscale photo before tagging, sending the original",
      error
    );
    return { base64: Buffer.from(photoBytes).toString("base64"), mediaType };
  }
}

function describe(input: TagItemInput): string {
  const lines = [`Name: ${input.name}`];
  if (input.category) lines.push(`Category: ${input.category}`);
  if (input.description?.trim()) {
    lines.push(`Description: ${input.description.trim()}`);
  } else {
    lines.push("Description: (none given)");
  }
  return lines.join("\n");
}

/**
 * Returns lowercase search tags for an item, or [] if tagging isn't
 * configured or fails for any reason.
 */
export async function generateTags(input: TagItemInput): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const name = input.name?.trim();
  if (!name) return [];

  try {
    const content: unknown[] = [];

    if (input.photo && SUPPORTED_MEDIA_TYPES.has(input.photo.mediaType)) {
      const { base64, mediaType } = await prepareForTagging(
        input.photo.bytes,
        input.photo.mediaType
      );
      content.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data: base64 },
      });
    }

    content.push({ type: "text", text: describe(input) });

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model: TAGGING_MODEL,
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      }),
    });

    if (!response.ok) {
      console.error(
        "generateTags: Anthropic API returned",
        response.status,
        await response.text().catch(() => "")
      );
      return [];
    }

    const data = (await response.json()) as {
      content?: { type: string; text?: string }[];
    };
    const textBlock = data.content?.find((block) => block.type === "text");
    if (!textBlock?.text) return [];

    return parseTagList(textBlock.text);
  } catch (error) {
    console.error("generateTags: failed to tag item", error);
    return [];
  }
}
