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
import { refineTags } from "@/lib/ai/tag-words";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

// Claude downscales vision input to roughly this size anyway, so sending
// anything larger costs upload time and tokens for no accuracy gain.
const MAX_TAGGING_DIMENSION = 1568;
const TAGGING_JPEG_QUALITY = 82;

const TAGGING_MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = [
  "You are tagging a theatre prop or costume so that staff can find it again by searching an inventory.",
  "The tags are never shown to anyone; they only decide what a search matches. Someone looking for",
  "\"wood\", \"red\" or \"fabric\" must find this item if it is wooden, red or made of fabric, even",
  "though nobody wrote that down.",
  "",
  "Look at the photo when there is one; it is the best evidence of materials and colours. Use the name",
  "and description too.",
  "",
  "Answer with ONLY a JSON object, no markdown, in exactly this shape:",
  '{"what": [...], "materials": [...], "colours": [...], "style": [...], "uses": [...]}',
  "",
  "- what: what the object is, and the broader kinds of thing it belongs to (a rapier is also a sword and a weapon).",
  "- materials: EVERY material it is visibly or very probably made of, each as the specific material AND its",
  "  everyday family: wood, metal, fabric, leather, glass, ceramic, plastic, paper, stone, rubber, rope.",
  "  Mahogany is wood; brass is metal; velvet is fabric; porcelain is ceramic. Include the parts: a cane",
  "  with a brass collar is wood and metal; an umbrella is fabric, metal and wood if its handle is wooden.",
  "  Never leave this empty: make your best guess.",
  "- colours: EVERY clearly visible colour, in plain words (red, blue, green, yellow, orange, purple, pink,",
  "  brown, black, white, grey, gold, silver), plus any more precise shade worth searching (navy, cream, rust).",
  "  Never leave this empty.",
  "- style: period or style where evident (victorian, elizabethan, medieval, 1950s, art deco, rustic, ornate).",
  "- uses: what it would plausibly be used for or stand in for on stage.",
  "",
  "Lowercase single words where possible. Don't use words that would match every item in a theatre,",
  "like \"prop\", \"stage\" or \"theatrical\".",
  "",
  'Example, for "Walking cane" with a photo of a glossy reddish-brown stick with a brass band:',
  '{"what": ["cane", "walking stick", "stick", "accessory"], "materials": ["mahogany", "wood", "brass", "metal"], "colours": ["brown", "red", "gold"], "style": ["victorian", "gentleman"], "uses": ["costume", "character", "elderly"]}',
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

/**
 * The model's answer as a flat list: the structured object this prompt asks
 * for ({what, materials, colours, style, uses}), or a plain array, which
 * older prompts gave. Anything else is no tags.
 */
export function parseTagAnswer(raw: string): string[] {
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
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
  if (Array.isArray(parsed)) return strings(parsed);
  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    // Materials and colours first: they're what this is for.
    return [...strings(o.what), ...strings(o.materials), ...strings(o.colours ?? o.colors), ...strings(o.style), ...strings(o.uses)];
  }
  return [];
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
        max_tokens: 400,
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

    // Tidied, and the everyday word added for any material or colour the
    // answer, the name or the description mentions (tag-words.ts).
    return refineTags(parseTagAnswer(textBlock.text), `${name} ${input.description ?? ""}`);
  } catch (error) {
    console.error("generateTags: failed to tag item", error);
    return [];
  }
}
