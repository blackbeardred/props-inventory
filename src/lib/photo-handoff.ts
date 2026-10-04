/**
 * Handing a photo from the floating hexagon menu to the page that uses it.
 *
 * The menu takes the picture, then navigates — to the add-item form or a
 * production's prop-table screen — and that page picks the photo up. A
 * client-side navigation keeps this module alive, so a plain variable is
 * enough: no storage quota to blow on a 4MB phone photo, nothing left lying
 * around if the page is reloaded or abandoned.
 *
 * One photo, taken once. Whoever takes it first gets it; reading it clears it,
 * so a later visit to the same page doesn't silently reuse an old picture.
 */

let pending: { file: File; at: number } | null = null;

/** Older than this and it's not the photo the person just took. */
const FRESH_FOR_MS = 2 * 60 * 1000;

export function handOffPhoto(file: File): void {
  pending = { file, at: Date.now() };
}

export function takeHandedOffPhoto(): File | null {
  const taken = pending;
  pending = null;
  if (!taken || Date.now() - taken.at > FRESH_FOR_MS) return null;
  return taken.file;
}
