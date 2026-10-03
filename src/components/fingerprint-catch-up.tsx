"use client";

/**
 * Keeping fingerprints up to date without anyone having to remember to.
 *
 * New items, replaced photos and imported spreadsheets all leave items with no
 * current fingerprint, and a backfill page you have to remember exists is a
 * backfill that stops being run. So this quietly catches up in the background
 * while someone is using the app normally.
 *
 * The rule that makes it safe to run unasked: **only when the model is already
 * cached in this browser**. Fingerprinting then costs a second of CPU and no
 * network at all. On a device that has never done it, this does nothing —
 * because the alternative is a phone in a storage room silently pulling 40MB
 * because somebody added a hat. Those items wait for a desktop, which is where
 * the backfill page is meant to be run anyway.
 *
 * Deliberately not a service worker or anything clever: it is a component that
 * does a little work when a page is open, and stops when it isn't.
 */

import { useEffect, useRef, useState } from "react";
import { isModelCached } from "@/lib/embedding";
import { runFingerprints, takeFingerprintTally } from "@/lib/fingerprints";

/**
 * How many to do per page view. Not a technical limit — a politeness one. The
 * CPU is the user's, and they are trying to read a page, so a hundred imported
 * photos spread over several visits rather than holding one page hostage.
 */
const PER_VISIT = 25;

/** Long enough that moving between pages doesn't re-query the inventory every
 *  time, short enough that an item added a minute ago gets picked up. */
const RECHECK_AFTER_MS = 3 * 60 * 1000;

const LAST_CHECK_KEY = "fingerprints:last-check";

export function FingerprintCatchUp({ orgId }: { orgId: string | null }) {
  const [working, setWorking] = useState(0);
  // React runs effects twice in development; without this the same items get
  // fingerprinted twice on every page load while developing.
  const started = useRef(false);

  useEffect(() => {
    // The layout redirects before rendering this without an organization,
    // but the type allows null and a crash in a background task is a bad way
    // to find that out.
    if (!orgId || started.current) return;
    started.current = true;

    let cancelled = false;

    async function catchUp() {
      if (!(await isModelCached())) return;

      try {
        const last = Number(sessionStorage.getItem(LAST_CHECK_KEY) ?? 0);
        if (Date.now() - last < RECHECK_AFTER_MS) return;
        sessionStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
      } catch {
        // Storage can be blocked. Checking every page view is wasteful but
        // harmless, so carry on rather than refusing to work.
      }

      const tally = await takeFingerprintTally();
      if (cancelled || tally.outstanding.length === 0) return;

      const batch = tally.outstanding.slice(0, PER_VISIT);
      setWorking(batch.length);

      await runFingerprints(
        orgId!,
        batch,
        (progress) => setWorking(batch.length - progress.done - progress.failed),
        undefined,
        () => cancelled
      );

      if (!cancelled) setWorking(0);
    }

    // Waits for the page to be idle, so this never competes with rendering
    // what the person actually came for.
    const idle =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback(() => void catchUp(), { timeout: 4000 })
        : window.setTimeout(() => void catchUp(), 2000);

    return () => {
      cancelled = true;
      if (typeof cancelIdleCallback === "function" && typeof idle === "number") {
        cancelIdleCallback(idle);
      } else {
        clearTimeout(idle as number);
      }
    };
    // orgId is fixed for the life of the layout; switching organizations
    // remounts it.
  }, [orgId]);

  // Silent unless it's actually doing something. A person who notices this is
  // a person who wondered why the fan came on, and the answer should be here
  // rather than nowhere.
  if (working === 0) return null;

  return (
    <p
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 rounded-full border border-rule bg-surface/95 px-3 py-1.5 font-body text-xs text-muted shadow-sm backdrop-blur"
    >
      Recognising {working} new {working === 1 ? "photo" : "photos"}…
    </p>
  );
}
