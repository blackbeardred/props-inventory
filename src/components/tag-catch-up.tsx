"use client";

import { useEffect } from "react";
import { tagSomeUntagged } from "@/lib/tag-catch-up-actions";

/**
 * Fills in missing search tags in the background while someone uses the app,
 * a few items at a time, so a search for "wood" finds the mahogany cane even
 * when nobody has ever opened it (see tagSomeUntagged).
 *
 * Once per theatre per visit: it waits a few seconds so it doesn't compete
 * with the page loading, works through what's untagged, and stops for the
 * visit when it's done, when the tagger has nothing to say (no key, spend
 * limit), or after a generous cap, so an enormous import is spread across a
 * few visits rather than one long one.
 */

const START_AFTER_MS = 3000;
const BETWEEN_BATCHES_MS = 400;
const MAX_BATCHES_PER_VISIT = 60;

function key(orgId: string) {
  return `tags-caught-up:${orgId}`;
}

export function TagCatchUp({ orgId }: { orgId: string | null }) {
  useEffect(() => {
    if (!orgId) return;
    try {
      if (sessionStorage.getItem(key(orgId))) return;
    } catch {
      // No session storage: run anyway, it's harmless.
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      for (let batch = 0; batch < MAX_BATCHES_PER_VISIT && !cancelled; batch += 1) {
        let result;
        try {
          result = await tagSomeUntagged();
        } catch {
          break;
        }
        if (result.stalled || result.remaining === 0 || result.tagged === 0) break;
        await new Promise((resolve) => window.setTimeout(resolve, BETWEEN_BATCHES_MS));
      }
      try {
        sessionStorage.setItem(key(orgId), "1");
      } catch {
        // Fine: it'll check again next page load.
      }
    }, START_AFTER_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [orgId]);

  return null;
}
