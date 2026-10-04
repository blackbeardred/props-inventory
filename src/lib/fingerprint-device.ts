/**
 * Whether this device fingerprints photos, and when it should next try.
 *
 * The rule from Day 18 still stands — nothing downloads the recognition model
 * without someone choosing it. What changes is where the choosing can happen.
 * It used to be one page meant for a desktop; now any device can say yes once,
 * at the moment it matters (just after saving a photo, or on the prop-table
 * screen), and from then on fingerprints its own new photos as they are made.
 *
 * Browser only. Every storage access is wrapped: private windows and blocked
 * site data throw, and not being able to remember a choice must never stop
 * anyone saving an item.
 */

import { isModelCached } from "@/lib/embedding";

/** "yes": this device agreed to hold the model. Kept across visits. */
const OPT_IN_KEY = "fingerprints:device-opt-in";

/** Set for the rest of the visit when someone says "not now". */
const DECLINED_KEY = "fingerprints:declined";

/** Something on this device just saved a photo; check without waiting. */
const DUE_KEY = "fingerprints:due";

/** Migration 006 isn't there; stop asking the database for this visit. */
const UNAVAILABLE_KEY = "fingerprints:unavailable";

/** Fired on window when a photo has just been saved, for listeners that are
 *  already mounted and won't see a navigation. */
export const FINGERPRINTS_DUE_EVENT = "fingerprints:due";

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string | null) {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // Can't remember it. The cost is being asked again, which is fine.
  }
}

const local = () => window.localStorage;
const session = () => window.sessionStorage;

export function hasOptedIn(): boolean {
  return read(local, OPT_IN_KEY) === "yes";
}

export function optIn() {
  write(local, OPT_IN_KEY, "yes");
  write(session, DECLINED_KEY, null);
}

export function hasDeclinedThisVisit(): boolean {
  return read(session, DECLINED_KEY) === "yes";
}

export function declineForThisVisit() {
  write(session, DECLINED_KEY, "yes");
}

/**
 * True when fingerprinting here costs no download nobody agreed to: the model
 * is already cached, or someone on this device said yes to fetching it.
 */
export async function deviceMayFingerprint(): Promise<boolean> {
  return hasOptedIn() || (await isModelCached());
}

/**
 * Call when a photo is about to be saved from this device — when one is
 * chosen in a form. Picked up on the next navigation, which is the redirect
 * after the save, by which time the photo exists. Deliberately no event: the
 * item doesn't exist yet, and an offer to download a model arriving while
 * someone is still typing the item's name is an interruption, not a help.
 */
export function markFingerprintsDue() {
  write(session, DUE_KEY, "yes");
}

/** Call when photos have just been saved and nothing is about to navigate. */
export function requestFingerprintsNow() {
  markFingerprintsDue();
  try {
    window.dispatchEvent(new Event(FINGERPRINTS_DUE_EVENT));
  } catch {
    // No window events (very old browser): the next navigation picks it up.
  }
}

export function isDue(): boolean {
  return read(session, DUE_KEY) === "yes";
}

export function clearDue() {
  write(session, DUE_KEY, null);
}

export function isMarkedUnavailable(): boolean {
  return read(session, UNAVAILABLE_KEY) === "yes";
}

export function markUnavailable() {
  write(session, UNAVAILABLE_KEY, "yes");
}
