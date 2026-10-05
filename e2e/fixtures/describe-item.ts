// Fixture build only: stands in for "@/lib/ai/describe-item", so filling in
// a new item from its photo needs no Anthropic API call. Any real photo is
// "a white cup" (the user's own example); a tiny file (under 200 bytes) is
// one the reader couldn't make out.
export * from "../../src/lib/ai/describe-item-parse";
import type { DescribeResult } from "../../src/lib/ai/describe-item";

export type { DescribeResult } from "../../src/lib/ai/describe-item";

export async function describeItemPhoto(photo: { bytes: Uint8Array; mediaType: string }): Promise<DescribeResult> {
  await new Promise((r) => setTimeout(r, 400));
  if (photo.bytes.length < 200) return { ok: false, reason: "failed" };
  return {
    ok: true,
    suggestion: {
      name: "White cup",
      category: "prop",
      description: "Plain white ceramic cup with a curved handle, no markings.",
      condition: null,
      tags: ["cup", "mug", "ceramic", "white", "drink", "tableware", "kitchen"],
    },
  };
}
