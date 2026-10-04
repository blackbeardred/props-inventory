"use client";

/**
 * The backfill: giving every item that has a photo a visual fingerprint.
 *
 * Meant to be run once, from a desktop, after which new photos are the only
 * thing left to do. It is a page rather than a background job because the work
 * happens in this browser — there is no server to hand it to — and because a
 * person watching a bar move is a person who can tell that something stalled.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Notice } from "@/components/ui";
import type { LoadProgress } from "@/lib/embedding";
import {
  runFingerprints,
  takeFingerprintTally,
  type FingerprintFailure,
  type FingerprintTally,
  type RunProgress,
} from "@/lib/fingerprints";
import { optIn } from "@/lib/fingerprint-device";

type Phase = "counting" | "ready" | "running" | "finished" | "failed";

export function FingerprintRunner({ orgId }: { orgId: string }) {
  const [phase, setPhase] = useState<Phase>("counting");
  const [tally, setTally] = useState<FingerprintTally | null>(null);
  const [load, setLoad] = useState<LoadProgress | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [failures, setFailures] = useState<FingerprintFailure[]>([]);
  const [error, setError] = useState<string | null>(null);

  // A ref rather than state: the run loop reads it between items, and state
  // captured in a closure would still say false long after the click.
  const stopping = useRef(false);

  const count = useCallback(async () => {
    setPhase("counting");
    setError(null);
    try {
      setTally(await takeFingerprintTally());
      setPhase("ready");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Couldn't read the inventory.");
      setPhase("failed");
    }
  }, []);

  useEffect(() => {
    void count();
  }, [count]);

  async function start() {
    if (!tally) return;
    // Having run the backfill here, this device keeps up with new photos too.
    optIn();
    stopping.current = false;
    setFailures([]);
    setPhase("running");

    const result = await runFingerprints(
      orgId,
      tally.outstanding,
      setProgress,
      setLoad,
      () => stopping.current
    );

    setFailures(result.failures);
    setPhase("finished");
    void count();
  }

  if (phase === "counting") {
    return <p className="font-body text-sm text-foreground/70">Checking what needs doing…</p>;
  }

  if (phase === "failed") {
    return (
      <Notice title="Couldn't check the inventory">
        <p className="font-body text-sm">{error}</p>
        <button type="button" onClick={() => void count()} className="mt-2 text-accent hover:underline">
          Try again
        </button>
      </Notice>
    );
  }

  const outstanding = tally?.outstanding.length ?? 0;

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-3 gap-4">
        <Stat label="Items with a photo" value={tally?.withPhotos ?? 0} />
        <Stat label="Already fingerprinted" value={tally?.current ?? 0} />
        <Stat label="Still to do" value={outstanding} />
      </dl>

      {phase !== "running" && outstanding === 0 ? (
        <Notice title="Everything with a photo is fingerprinted">
          <p className="font-body text-sm">
            New photos are fingerprinted as they&rsquo;re added. Come back here if you ever change a
            lot of them at once.
          </p>
        </Notice>
      ) : null}

      {phase === "ready" && outstanding > 0 ? (
        <div className="rounded-lg border border-foreground/15 px-4 py-3">
          <p className="font-body text-sm text-foreground">
            The first run downloads the vision model — about 40MB, once per device, then cached by
            the browser. Best done here on a desktop rather than on a phone in a storage room.
            Leave this tab open while it works.
          </p>
          <button
            type="button"
            onClick={() => void start()}
            className="mt-3 rounded-md bg-accent px-4 py-2 font-body text-sm font-semibold text-white"
          >
            Fingerprint {outstanding} {outstanding === 1 ? "item" : "items"}
          </button>
        </div>
      ) : null}

      {phase === "running" ? (
        <div className="rounded-lg border border-foreground/15 px-4 py-3">
          {load && load.percent !== null ? (
            <>
              <p className="font-body text-sm text-foreground">{load.message}</p>
              <Bar percent={load.percent} />
            </>
          ) : null}

          {progress ? (
            <>
              <p className="font-body text-sm text-foreground">
                {progress.done} of {progress.total} done
                {progress.failed > 0 ? `, ${progress.failed} couldn’t be read` : ""}
                {progress.current ? ` — ${progress.current}` : ""}
              </p>
              <Bar percent={progress.total === 0 ? 0 : (progress.done / progress.total) * 100} />
            </>
          ) : (
            <p className="font-body text-sm text-foreground">{load?.message ?? "Starting…"}</p>
          )}

          <button
            type="button"
            onClick={() => {
              stopping.current = true;
            }}
            className="mt-3 font-body text-sm text-accent hover:underline"
          >
            Stop after this one
          </button>
        </div>
      ) : null}

      {phase === "finished" ? (
        <Notice title={`Fingerprinted ${progress?.done ?? 0}`}>
          <p className="font-body text-sm">
            {failures.length === 0
              ? "Every photo was read."
              : `${failures.length} couldn’t be read, listed below. The rest are done.`}
          </p>
        </Notice>
      ) : null}

      {failures.length > 0 ? (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3">
          <p className="font-body text-sm font-semibold text-danger-ink">
            Couldn&rsquo;t be fingerprinted
          </p>
          <ul className="mt-2 space-y-1">
            {failures.map((failure) => (
              <li key={failure.name} className="font-body text-sm text-foreground">
                {failure.name} — {failure.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-foreground/15 px-4 py-3">
      <dt className="font-body text-xs uppercase tracking-wide text-foreground/60">{label}</dt>
      <dd className="mt-1 font-body text-2xl font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function Bar({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-foreground/10">
      <div className="h-full bg-accent transition-[width]" style={{ width: `${clamped}%` }} />
    </div>
  );
}
