// Fixture build only: stands in for "@/lib/ai/tag-item". Silent, like a
// site with no API key, unless the test asked for tagging=1: then an item's
// tags are its name's words plus "tagged", and a mahogany one is wood.
export type { TagItemInput } from "../../src/lib/ai/tag-item";
import type { TagItemInput } from "../../src/lib/ai/tag-item";

export async function generateTags(input: TagItemInput): Promise<string[]> {
  const flags = (globalThis as unknown as { __fixtureFlags?: Set<string> }).__fixtureFlags;
  if (!flags?.has("tagging")) return [];
  const words = `${input.name} ${input.description ?? ""}`.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);
  const tags = new Set([...words.slice(0, 6), "tagged"]);
  if (/mahogany|oak|pine|wooden/.test(`${input.name} ${input.description ?? ""}`.toLowerCase())) tags.add("wood");
  if (input.photo) tags.add("photographed");
  return [...tags];
}
