/**
 * Reading a photo several ways and averaging, so one framing doesn't decide
 * the match.
 *
 * CLIP sees a 224px square: the vision processor shrinks the photo and cuts a
 * square from its middle, so anything near the edges of a tall or wide photo
 * is thrown away, and the model has a mild preference for which way things
 * face. This reads three versions of the same photo (as the processor would,
 * the whole frame padded to a square so nothing is cut off, and mirrored)
 * and averages the three fingerprints. It's the standard "test-time
 * augmentation" trick: a steadier answer for three times the arithmetic.
 *
 * The recognition check (/items/fingerprints) measures plain against this on
 * the theatre's own confirmed photos, so whether it helps is a number, not a
 * claim.
 *
 * Browser only. Kept apart from @/lib/embedding so the browser tests' stand-in
 * for that module covers this too.
 */

import { embedImage, l2Normalize, type LoadProgress } from "@/lib/embedding";

type Variant = "padded" | "mirrored";

async function redraw(photo: Blob, variant: Variant): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(photo);
    const { width, height } = bitmap;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return null;
    if (variant === "padded") {
      // The whole frame on a square, padded with the photo's own average
      // tone so the padding reads as background rather than a black bar.
      const side = Math.max(width, height);
      canvas.width = side;
      canvas.height = side;
      context.filter = "blur(40px)";
      context.drawImage(bitmap, 0, 0, side, side);
      context.filter = "none";
      context.drawImage(bitmap, (side - width) / 2, (side - height) / 2);
    } else {
      canvas.width = width;
      canvas.height = height;
      context.translate(width, 0);
      context.scale(-1, 1);
      context.drawImage(bitmap, 0, 0);
    }
    bitmap.close();
    return await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.9));
  } catch {
    return null;
  }
}

/**
 * The photo's fingerprint, averaged over three readings of it. Falls back to
 * the plain reading when the browser can't redraw the photo.
 */
export async function embedImageRobust(
  photo: Blob,
  onProgress?: (progress: LoadProgress) => void
): Promise<number[]> {
  const plain = await embedImage(photo, onProgress);
  const readings = [plain];
  for (const variant of ["padded", "mirrored"] as const) {
    const redrawn = await redraw(photo, variant);
    if (!redrawn) continue;
    try {
      readings.push(await embedImage(redrawn));
    } catch {
      // One reading fewer, not a failed search.
    }
  }
  if (readings.length === 1) return plain;
  const sum = new Array<number>(plain.length).fill(0);
  for (const reading of readings) for (let i = 0; i < sum.length; i += 1) sum[i] += reading[i];
  return l2Normalize(sum);
}
