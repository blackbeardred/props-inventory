/**
 * Fills in a new item from its photo: a name ("White cup"), whether it's a
 * prop or a costume, a line of description, its condition when that's
 * obvious, and the hidden search tags — in one call to Claude.
 *
 * It only ever suggests. The add-item form puts the suggestions into empty
 * fields, where the person adding the item sees and can change every one
 * before saving; nothing is written to the database from here.
 *
 * Like tagging (./tag-item.ts), it must never get in the way: no API key, a
 * network failure, an API error or a reply it can't read all come back as
 * "couldn't", and the form simply stays as it was.
 */

import sharp from "sharp";
import { parsePhotoSuggestion, type PhotoSuggestion } from "@/lib/ai/describe-item-parse";

export type { PhotoSuggestion } from "@/lib/ai/describe-item-parse";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";
const MODEL = "claude-haiku-4-5-20251001";

// Claude downscales vision input to about this anyway; sending more costs
// upload time and tokens for nothing. The suggestion only needs to see what
// the thing is, so this is a little smaller than tagging uses.
const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 80;

const SUPPORTED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const SYSTEM_PROMPT = [
  "You are helping a theatre's props and costume department catalogue a new item from a photo of it.",
  "Look at the main object in the photo (the most prominent one, if there are several) and respond with ONLY a JSON object, no markdown:",
  '{"name": "...", "category": "prop" | "costume", "description": "...", "condition": null | "new" | "good" | "fair" | "needs_repair", "tags": ["..."]}',
  "",
  "- name: what a stage manager would write on a shelf label. 1 to 4 plain words, sentence case, with the colour or material first when that tells it apart from others of its kind: \"White cup\", \"Brass candlestick\", \"Red velvet cloak\". No brand names unless clearly printed on it.",
  "- category: \"costume\" for anything worn (clothing, hats, shoes, wigs, jewellery, masks); everything else is \"prop\".",
  "- description: one short sentence of what is visible that would help tell it apart: material, colour, size cues, markings, damage. Don't guess its history or value.",
  "- condition: only if the photo makes it obvious (visible damage means \"needs_repair\"; still in packaging means \"new\"). Otherwise null.",
  "- tags: 5 to 15 lowercase search words: what it is and the broader kinds of thing it belongs to, what it's made of (including the obvious materials nobody writes down), its dominant colours, its style or period where evident, and what it would be used for on stage. Single common words someone would type into a search box.",
  "",
  'Example, for a photo of a plain white mug: {"name": "White cup", "category": "prop", "description": "Plain white ceramic cup with a curved handle, no markings.", "condition": null, "tags": ["cup", "mug", "ceramic", "white", "drink", "tableware", "kitchen"]}',
].join("\n");

export type DescribeResult =
  | { ok: true; suggestion: PhotoSuggestion }
  | { ok: false; reason: "off" | "unsupported" | "failed" };

async function prepare(bytes: Uint8Array, mediaType: string): Promise<{ base64: string; mediaType: string }> {
  try {
    const resized = await sharp(Buffer.from(bytes))
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    return { base64: resized.toString("base64"), mediaType: "image/jpeg" };
  } catch (error) {
    console.error("describeItemPhoto: couldn't downscale the photo, sending as-is", error);
    return { base64: Buffer.from(bytes).toString("base64"), mediaType };
  }
}

/** Suggestions for a new item from its photo, or why there are none. */
export async function describeItemPhoto(photo: { bytes: Uint8Array; mediaType: string }): Promise<DescribeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "off" };
  if (!SUPPORTED_MEDIA_TYPES.has(photo.mediaType)) return { ok: false, reason: "unsupported" };

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
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: "Catalogue this item." },
            ],
          },
        ],
      }),
    });
    if (!response.ok) {
      console.error("describeItemPhoto: Anthropic API returned", response.status, await response.text().catch(() => ""));
      return { ok: false, reason: "failed" };
    }
    const data = (await response.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((block) => block.type === "text")?.text;
    const suggestion = text ? parsePhotoSuggestion(text) : null;
    return suggestion ? { ok: true, suggestion } : { ok: false, reason: "failed" };
  } catch (error) {
    console.error("describeItemPhoto: failed", error);
    return { ok: false, reason: "failed" };
  }
}
