// Fixture build only: stands in for "@/lib/ai/see-items", so the prop-table
// photo screen reads the same four things from any photo without calling the
// Anthropic API. Everything but seeItems is the real module's own.
export * from "../../src/lib/ai/see-items";
import type { SeeResult } from "../../src/lib/ai/see-items";

export async function seeItems(photo: { bytes: Uint8Array; mediaType: string }): Promise<SeeResult> {
  void photo;
  return {
    ok: true,
    objects: [
      { name: "brass candlestick", search: "brass candlestick", quantity: 1, box: { x: 5, y: 10, width: 20, height: 35 }, note: null },
      { name: "goblet", search: "goblet", quantity: 1, box: { x: 30, y: 10, width: 20, height: 35 }, note: null },
      { name: "pewter tankard", search: "pewter tankard", quantity: 1, box: { x: 55, y: 10, width: 20, height: 35 }, note: null },
      { name: "wooden chair", search: "wooden chair", quantity: 1, box: { x: 5, y: 55, width: 30, height: 40 }, note: null },
    ],
  };
}
