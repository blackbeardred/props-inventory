/**
 * Auto-tagging (Day 9): after a photo is uploaded, this asks Claude to look
 * at it and guess a handful of lowercase tags (material, color, style) that
 * get stored in items.auto_tags and folded into full-text search — never
 * shown in the items list or search results, only affecting what a text
 * search matches (e.g. searching "wood" surfaces a wooden globe even though
 * "wood" never appears in its name or description).
 *
 * This must never break an item save: any missing key, network failure, API
 * error, or unparsable response is swallowed here and treated as "no tags
 * detected" (an empty array), with the failure logged server-side. Photo
 * uploads should keep working exactly the same with or without an
 * ANTHROPIC_API_KEY configured.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

// Fastest/cheapest current vision-capable model — plenty for short tag lists.
const TAGGING_MODEL = "claude-haiku-4-5-20251001";

const TAGGING_PROMPT =
  "You are tagging a photo of a theatre prop or costume for inventory search. " +
  "Look closely and list short, lowercase tags (one or two words each) covering: " +
  "materials it appears to be made of (e.g. wood, metal, plastic, fabric, glass, leather), " +
  "dominant colors, and any notable style or type descriptors. " +
  "Respond with ONLY a JSON array of 3 to 10 strings, nothing else — no markdown, no explanation. " +
  'Example response: ["wood", "brown", "spherical", "antique-style"]';

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 40;

/** Anthropic's Messages API accepts these image media types. */
const SUPPORTED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function parseTagList(raw: string): string[] {
  // The prompt asks for bare JSON, but strip a stray ```json fence just in
  // case the model wraps its answer in one anyway.
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

  if (!Array.isArray(parsed)) {
    return [];
  }

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
 * Analyzes a photo and returns lowercase tags, or [] if tagging isn't
 * configured or fails for any reason. `mediaType` should be the file's
 * content type (e.g. "image/jpeg").
 */
export async function tagPhoto(
  photoBytes: Uint8Array,
  mediaType: string
): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return [];
  }

  if (!SUPPORTED_MEDIA_TYPES.has(mediaType)) {
    return [];
  }

  try {
    const base64 = Buffer.from(photoBytes).toString("base64");

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model: TAGGING_MODEL,
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: base64 },
              },
              { type: "text", text: TAGGING_PROMPT },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error(
        "tagPhoto: Anthropic API returned",
        response.status,
        await response.text().catch(() => "")
      );
      return [];
    }

    const data = (await response.json()) as {
      content?: { type: string; text?: string }[];
    };
    const textBlock = data.content?.find((block) => block.type === "text");
    if (!textBlock?.text) {
      return [];
    }

    return parseTagList(textBlock.text);
  } catch (error) {
    console.error("tagPhoto: failed to tag photo", error);
    return [];
  }
}
