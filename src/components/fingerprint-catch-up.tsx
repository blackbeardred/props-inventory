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
 * should start recognizing photos too. That is the moment the question makes
 * sense, and it's what lets a theatre run on phones alone, without a desktop
 * session to do the backfill.
 *
 * Two things keep it out of the way (Nov 2026):
 *
 * - **Never on a page where someone is adding or editing items.** No offer, no
 *   status chip and no background work there: the form is busy reading the
 *   photo, and a dialog over the bottom of it, plus fingerprinting competing
 *   for the phone's CPU, made adding an item feel broken. A photo chosen there
 *   is still due, so the question comes on the page the save leads to.
 * - **The offer can be shrunk** to a small chip, and stays shrunk for the
 *   visit. Tapping the chip opens it again.
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

/** Set for the rest of the visit when someone shrinks the offer to a chip. */
const MINIMIZED_KEY = "fingerprints:offer-minimized";

/**
 * Pages where someone is adding or editing items: a new item, an item's edit
 * page, the spreadsheet importer and the prop-table photo. Nothing from here
 * shows on them, and no background fingerprinting runs while they're open.
 */
const BUSY_PAGES = [
  /^\/items\/new\/?$/,
  /^\/items\/[^/]+\/edit\/?$/,
  /^\/items\/import\/?$/,
  /^\/productions\/[^/]+\/photo\/?$/,
];

export function isBusyPage(pathname: string | null): boolean {
  return pathname !== null && BUSY_PAGES.some((page) => page.test(pathname));
}

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

function wasMinimized(): boolean {
  try {
    return sessionStorage.getItem(MINIMIZED_KEY) === "yes";
  } catch {
    return false;
  }
}

function rememberMinimized(minimized: boolean) {
  try {
    if (minimized) sessionStorage.setItem(MINIMIZED_KEY, "yes");
    else sessionStorage.removeItem(MINIMIZED_KEY);
  } catch {
    // Forgetting means it opens full size on the next page, which is harmless.
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
  // Read inside the lap, which outlives the render it started in: a lap
  // under way when someone opens a form stops between photos.
  const busy = isBusyPage(pathname);
  const onBusyPage = useRef(busy);
  // Declared before the effect that starts laps, so it has run by then.
  useEffect(() => {
    onBusyPage.current = busy;
  }, [busy]);
  // Read straight from storage: nothing shows until a lap finds work, which
  // is after hydration, so the server's "false" never disagrees on screen.
  const [minimized, setMinimized] = useState(() => typeof window !== "undefined" && wasMinimized());

  const lap = useCallback(
    async (force: boolean) => {
      if (!orgId || running.current || isMarkedUnavailable()) return;
      // Leaves "due" set, so the page the save leads to picks it up.
      if (onBusyPage.current) return;

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
          () => unmounted.current || onBusyPage.current
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

  if (state.kind === "quiet" || busy) return null;

  // On a phone everything here sits above the honey + button (quick-actions,
  // 4.75rem up and about 3.5rem tall), which would otherwise cover the
  // offer's buttons. On a computer that button lives in the header.

  if (state.kind === "offer" && minimized) {
    return (
      <button
        type="button"
        data-fingerprint-offer-chip
        data-print-hide
        aria-expanded="false"
        onClick={() => {
          rememberMinimized(false);
          setMinimized(false);
        }}
        className="group fixed bottom-[calc(9rem+env(safe-area-inset-bottom))] right-4 z-40 inline-flex min-h-11 items-center gap-2 rounded-full border border-rule bg-surface/95 px-4 py-2 font-body text-sm text-foreground shadow-sm backdrop-blur transition-colors hover:bg-surface md:bottom-4"
      >
        <span
          aria-hidden="true"
          className="hex inline-block w-3.5 shrink-0 bg-honey transition-[rotate] duration-200 ease-out motion-safe:group-hover:rotate-90 motion-reduce:transition-none"
        />
        Recognize photos{" "}
        <span className="text-muted">· {state.waiting} waiting</span>
      </button>
    );
  }

  if (state.kind === "offer") {
    return (
      <div
        role="dialog"
        data-fingerprint-offer
        aria-labelledby="fingerprint-offer-title"
        data-print-hide
        className="fixed inset-x-4 bottom-[calc(9rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-sm md:bottom-4 rounded-lg border border-rule bg-surface p-4 shadow-lg sm:left-auto sm:right-4 sm:mx-0"
      >
        <div className="flex items-start justify-between gap-3">
          <p id="fingerprint-offer-title" className="font-display text-base text-foreground">
            Recognize photos on this device?
          </p>
          <button
            type="button"
            aria-label="Minimize"
            title="Minimize"
            onClick={() => {
              rememberMinimized(true);
              setMinimized(true);
            }}
            className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
              <path d="M3 8h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        </div>
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
              rememberMinimized(false);
              setMinimized(false);
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
      : `Recognizing ${state.remaining} new ${state.remaining === 1 ? "photo" : "photos"}…`;

  return (
    <p
      aria-live="polite"
      data-print-hide
      className="pointer-events-none fixed bottom-[calc(9rem+env(safe-area-inset-bottom))] right-4 z-40 md:bottom-4 rounded-full border border-rule bg-surface/95 px-3 py-1.5 font-body text-xs text-muted shadow-sm backdrop-blur"
    >
      {label}
    </p>
  );
}
