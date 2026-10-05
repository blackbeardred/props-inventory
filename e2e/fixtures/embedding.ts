// Fixture build only: stands in for "@/lib/embedding". The real loader
// downloads a 40MB model from huggingface.co, which a test run neither can
// nor should, so the three functions that touch the model are replaced and
// everything else is the real module's own (the model is a dynamic import
// there, so nothing heavy comes along). A test can set
// window.__modelCached = true to act as a device that already holds it.
export * from "../../src/lib/embedding";
import type { LoadProgress } from "../../src/lib/embedding";

const w = () => globalThis as unknown as { __modelCached?: boolean; __loads?: number };

export async function isModelCached(): Promise<boolean> {
  return Boolean(w().__modelCached);
}

export async function loadEmbedder(onProgress?: (progress: LoadProgress) => void) {
  if (!w().__modelCached) {
    for (const percent of [0, 30, 65, 100]) {
      onProgress?.({ message: "Downloading", percent });
      await new Promise((r) => setTimeout(r, 250));
    }
    w().__modelCached = true;
  }
  w().__loads = (w().__loads ?? 0) + 1;
  return {};
}

export async function embedImage(
  blob: Blob,
  onProgress?: (progress: LoadProgress) => void
): Promise<number[]> {
  await loadEmbedder(onProgress);
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error("bad blob");
  // A unit vector, so the real checks on a fingerprint pass.
  return [1, ...new Array(511).fill(0)];
}
