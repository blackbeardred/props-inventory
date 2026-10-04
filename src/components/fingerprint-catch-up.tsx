"use client";

/**
 * Keeping fingerprints up to date without anyone having to remember to.
 *
 * New items, replaced photos and imported spreadsheets all leave items with no
 * current fingerprint, and a backfill page you have to remember exists is a
 * backfill that stops being run. So this catches up in the background while
 * someone is using the app normally — and, when this device has just saved a
 * photo, straight away rather than on its next lap.
 *
 * The rule that makes it safe to run unasked: **it never downloads a model
 * nobody agreed to.** On a device that already holds it, or one where
 * somebody once said yes, fingerprinting costs a second of CPU. On a device
 * that has neither, it does nothing in the background — but having just saved
 * a photo from that device, it asks, once per visit, whether this device
 * should start recognising photos too. That is the moment the question makes
 * sense, and it's what lets a theatre run on phones alone, without a desktop
 * session to do the backfill.
 *
 * Deliberately not a service worker or anything clever: it is a component that
 * does a little work when a page is open, and stops when it isn't.
 */

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadEmbedder, type LoadProgress } from "@/lib/embedding";
import {
  FINGERPRINTS_DUE_EVENT,
  clearDue,
  declineForThisVisit,
  deviceMayFingerprint,
  hasDeclinedThisVisit,
  isDue,
  isMarkedUnavailable,
  markUnavailable,
  optIn,
} from "@/lib/fingerprint-device";
import {
  isMissingFingerprintSchema,
  runFingerprints,
  takeFingerprintTally,
} from "@/lib/fingerprints";

/**
 * How many to do per lap. Not a technical limit — a politeness one. The CPU
 * is the user's, and they are trying to read a page, so a hundred imported
 * photos spread over several laps rather than holding one page hostage.
 */
const PER_LAP = 25;

/** Long enough that moving between pages doesn't re-query the inventory every
 *  time, short enough that an item added on another device gets picked up. */
const RECHECK_AFTER_MS = 3 * 60 * 1000;

const LAST_CHECK_KEY = "fingerprints:last-check";

type State =
  | { kind: "quiet" }
  | { kind: "offer"; waiting: number }
  | { kind: "loading"; progress: LoadProgress | null }
  | { kind: "working"; remaining: number };

function checkedRecently(): boolean {
  try {
    const last = Number(sessionStorage.getItem(LAST_CHECK_KEY) ?? 0);
    return Date.now() - last < RECHECK_AFTER_MS;
  } catch {
    return false;
  }
}

function noteChecked() {
  try {
    sessionStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  } catch {
    // Checking every page view is wasteful but harmless.
  }
}

export function FingerprintCatchUp({ orgId }: { orgId: string | null }) {
  const pathname = usePathname();
  const [state, setState] = useState<State>({ kind: "quiet" });
  // One lap at a time. React runs effects twice in development, and a
  // navigation can arrive mid-lap; without this the same items get
  // fingerprinted twice.
  const running = useRef(false);
  const unmounted = useRef(false);

  const lap = useCallback(
    async (force: boolean) => {
      if (!orgId || running.current || isMarkedUnavailable()) return;

      const due = isDue();
      if (!force && !due && checkedRecently()) return;

      running.current = true;
      try {
        const allowed = force || (await deviceMayFingerprint());

        // Without a yes, nothing runs. Only a photo saved from *this* device
        // earns the question — never a page view — and "not now" holds for
        // the rest of the visit.
        if (!allowed) {
          if (!due || hasDeclinedThisVisit()) return;
          clearDue();
          const tally = await takeFingerprintTally();
          if (tally.outstanding.length > 0 && !unmounted.current) {
            setState({ kind: "offer", waiting: tally.outstanding.length });
          }
          return;
        }

        clearDue();
        noteChecked();

        const tally = await takeFingerprintTally();
        if (unmounted.current || tally.outstanding.length === 0) return;

        // Newest first: the photo someone just saved is the one they may be
        // about to look for, not whatever sorts first alphabetically.
        const batch = [...tally.outstanding]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, PER_LAP);

        setState({ kind: "loading", progress: null });
        await loadEmbedder((progress) => {
          if (!unmounted.current) setState({ kind: "loading", progress });
        });

        setState({ kind: "working", remaining: batch.length });
        await runFingerprints(
          orgId,
          batch,
          (progress) => {
            if (!unmounted.current) {
              setState({
                kind: "working",
                remaining: batch.length - progress.done - progress.failed,
              });
            }
          },
          undefined,
          () => unmounted.current
        );
      } catch (problem) {
        // A background helper has no business putting an error in front of
        // someone. Migration 006 not having been run is the one failure worth
        // remembering, so it isn't retried on every page for the whole visit.
        if (isMissingFingerprintSchema(problem)) markUnavailable();
      } finally {
        running.current = false;
        if (!unmounted.current) {
          setState((current) => (current.kind === "offer" ? current : { kind: "quiet" }));
        }
      }
    },
    [orgId]
  );

  // On every navigation — including the redirect after saving an item, which
  // in the App Router doesn't remount this layout — once the page is idle, so
  // this never competes with rendering what the person actually came for.
  useEffect(() => {
    const idle =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback(() => void lap(false), { timeout: 4000 })
        : window.setTimeout(() => void lap(false), 2000);

    return () => {
      if (typeof cancelIdleCallback === "function" && typeof idle === "number") {
        cancelIdleCallback(idle);
      } else {
        clearTimeout(idle as number);
      }
    };
  }, [lap, pathname]);

  // Photos saved without a navigation — the prop-table screen, the importer.
  useEffect(() => {
    const onDue = () => void lap(false);
    window.addEventListener(FINGERPRINTS_DUE_EVENT, onDue);
    return () => window.removeEventListener(FINGERPRINTS_DUE_EVENT, onDue);
  }, [lap]);

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  if (state.kind === "quiet") return null;

  if (state.kind === "offer") {
    return (
      <div
        role="dialog"
        aria-labelledby="fingerprint-offer-title"
        data-print-hide
        className="fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-sm md:bottom-4 rounded-lg border border-rule bg-surface p-4 shadow-lg sm:left-auto sm:right-4 sm:mx-0"
      >
        <p id="fingerprint-offer-title" className="font-display text-base text-foreground">
          Recognise photos on this device?
        </p>
        <p className="mt-1 font-body text-sm text-muted">
          {state.waiting === 1 ? "One photo is" : `${state.waiting} photos are`} waiting to be
          fingerprinted, so they can be found by what they look like. That needs the recognition
          model on this device — a one-time download, best done on Wi-Fi.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              optIn();
              setState({ kind: "quiet" });
              void lap(true);
            }}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 py-2 font-body text-sm font-medium text-background transition-colors hover:opacity-90"
          >
            Download and start
          </button>
          <button
            type="button"
            onClick={() => {
              declineForThisVisit();
              setState({ kind: "quiet" });
            }}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-background"
          >
            Not now
          </button>
        </div>
      </div>
    );
  }

  // Silent unless it's actually doing something. A person who notices this is
  // a person who wondered why the fan came on, and the answer should be here
  // rather than nowhere.
  const label =
    state.kind === "loading"
      ? state.progress?.percent !== null && state.progress?.percent !== undefined
        ? `Downloading the recognition model… ${state.progress.percent}%`
        : "Getting the recognition model ready…"
      : `Recognising ${state.remaining} new ${state.remaining === 1 ? "photo" : "photos"}…`;

  return (
    <p
      aria-live="polite"
      data-print-hide
      className="pointer-events-none fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-40 md:bottom-4 rounded-full border border-rule bg-surface/95 px-3 py-1.5 font-body text-xs text-muted shadow-sm backdrop-blur"
    >
      {label}
    </p>
  );
}
