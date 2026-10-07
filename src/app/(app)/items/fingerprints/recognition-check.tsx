"use client";

/**
 * "How well does it recognise?": the recognition check.
 *
 * Every confirmed picture is a photo with a known answer. Holding each one
 * out and asking which item the rest of the collection says it is gives a
 * real accuracy figure for this theatre's own props (src/lib/
 * recognition-check.ts). The quick check uses the fingerprints already
 * stored. The comparison downloads the photos and reads each one two ways,
 * plain and averaged over three framings (src/lib/robust-embedding.ts), so a
 * change to how photos are read is judged on evidence.
 */

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PHOTOS_BUCKET } from "@/lib/supabase/storage";
import { embedImage, loadEmbedder, type LoadProgress } from "@/lib/embedding";
import { embedImageRobust } from "@/lib/robust-embedding";
import { optIn } from "@/lib/fingerprint-device";
import { normalise, runCheck, share, type CheckSummary } from "@/lib/recognition-check";
import { loadCheckData, type CheckData } from "@/lib/recognition-data";

/** The comparison downloads and reads every photo twice: capped, so it ends. */
const COMPARE_LIMIT = 40;

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; data: CheckData; summary: CheckSummary }
  | { kind: "failed"; message: string };

type Comparison =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number; load: LoadProgress | null }
  | { kind: "done"; plain: CheckSummary; robust: CheckSummary }
  | { kind: "failed"; message: string };

export function RecognitionCheck() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [comparison, setComparison] = useState<Comparison>({ kind: "idle" });

  async function check() {
    setPhase({ kind: "loading" });
    setComparison({ kind: "idle" });
    try {
      const data = await loadCheckData();
      setPhase({ kind: "done", data, summary: runCheck(data.trials, data.pictures, data.twinsOf) });
    } catch (problem) {
      setPhase({ kind: "failed", message: problem instanceof Error ? problem.message : "Couldn’t read the fingerprints." });
    }
  }

  async function compare(data: CheckData) {
    const trials = data.trials.slice(0, COMPARE_LIMIT);
    setComparison({ kind: "running", done: 0, total: trials.length, load: null });
    try {
      optIn();
      await loadEmbedder((load) => setComparison({ kind: "running", done: 0, total: trials.length, load }));
      const supabase = createClient();
      const plain: typeof trials = [];
      const robust: typeof trials = [];
      for (const [index, trial] of trials.entries()) {
        const { data: photo } = await supabase.storage.from(PHOTOS_BUCKET).download(trial.photoPath);
        if (photo) {
          plain.push({ ...trial, vector: normalise(await embedImage(photo)) });
          robust.push({ ...trial, vector: normalise(await embedImageRobust(photo)) });
        }
        setComparison({ kind: "running", done: index + 1, total: trials.length, load: null });
      }
      setComparison({
        kind: "done",
        plain: runCheck(plain, data.pictures, data.twinsOf),
        robust: runCheck(robust, data.pictures, data.twinsOf),
      });
    } catch (problem) {
      setComparison({ kind: "failed", message: problem instanceof Error ? problem.message : "The comparison stopped." });
    }
  }

  const name = (data: CheckData, id: string | null) => (id ? (data.names.get(id) ?? "an item") : "nothing");

  return (
    <section data-recognition-check className="mt-10 max-w-2xl border-t border-rule pt-6">
      <h2 className="font-display text-lg text-foreground">How well does it recognise?</h2>
      <p className="mt-1 font-body text-sm text-muted">
        Every photo someone confirmed with “That’s it” or a ticked prop-table match is a test with
        a known answer. This holds each one out and checks whether the right item comes back
        first.
      </p>

      <button
        type="button"
        onClick={() => void check()}
        disabled={phase.kind === "loading"}
        className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface disabled:opacity-50 md:min-h-0"
      >
        <span aria-hidden="true" className="hex w-3 bg-honey" />
        {phase.kind === "loading" ? "Checking…" : phase.kind === "done" ? "Check again" : "Run the check"}
      </button>

      {phase.kind === "failed" ? <p className="mt-3 font-body text-sm text-danger-ink">{phase.message}</p> : null}

      {phase.kind === "done" ? (
        <div className="mt-4 space-y-3" role="status">
          {phase.summary.scored === 0 ? (
            <p className="font-body text-sm text-foreground">
              Nothing to test yet. Confirm a few matches first: tap “That’s it” on{" "}
              <Link href="/items/lookalike" className="text-accent-ink hover:underline">
                Find by photo
              </Link>{" "}
              for props that already have a photo.
            </p>
          ) : (
            <dl data-check-scores className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Score label="Right item first" value={share(phase.summary.first, phase.summary.scored)} />
              <Score label="In the top three" value={share(phase.summary.topThree, phase.summary.scored)} />
            </dl>
          )}
          {phase.summary.unscorable ? (
            <p className="font-body text-xs text-muted">
              {phase.summary.unscorable} more {phase.summary.unscorable === 1 ? "photo is" : "photos are"} the
              only picture of {phase.summary.unscorable === 1 ? "its item" : "their items"}, so there was
              nothing to find {phase.summary.unscorable === 1 ? "it" : "them"} by.
            </p>
          ) : null}
          {phase.data.unfingerprinted ? (
            <p className="font-body text-sm text-foreground">
              {phase.data.unfingerprinted} {phase.data.unfingerprinted === 1 ? "item has" : "items have"} a photo
              but no fingerprint, so {phase.data.unfingerprinted === 1 ? "it" : "they"} can’t be found by photo at
              all. Fingerprinting {phase.data.unfingerprinted === 1 ? "it" : "them"} above is the quickest win.
            </p>
          ) : null}

          {phase.summary.results.some((result) => result.rank !== null && result.rank > 1) ? (
            <div>
              <p className="font-body text-sm font-semibold text-foreground">Missed</p>
              <ul data-check-misses className="mt-1 divide-y divide-rule rounded-md border border-rule bg-surface">
                {phase.summary.results
                  .filter((result) => result.rank !== null && result.rank > 1)
                  .map((result) => (
                    <li key={result.key} className="px-3 py-2 font-body text-sm">
                      A photo of{" "}
                      <Link href={`/items/${result.itemId}/edit`} className="text-accent-ink hover:underline">
                        {name(phase.data, result.itemId)}
                      </Link>{" "}
                      found <span className="font-medium">{name(phase.data, result.topItemId)}</span> first. The
                      right one came {ordinal(result.rank ?? 0)}.
                    </li>
                  ))}
              </ul>
              <p className="mt-1 font-body text-xs text-muted">
                A clearer photo of a missed item (the object filling the frame, plain background)
                usually fixes it. So does confirming another photo of it.
              </p>
            </div>
          ) : null}

          {phase.summary.scored > 0 ? (
            <div className="rounded-md border border-rule bg-background px-3 py-3">
              <p className="font-body text-sm text-foreground">
                Find by photo now reads each photo three ways (as is, whole frame, mirrored) and
                averages them. Compare that with a single reading on your own photos:
              </p>
              <button
                type="button"
                onClick={() => void compare(phase.data)}
                disabled={comparison.kind === "running"}
                className="mt-2 inline-flex min-h-11 items-center justify-center rounded-md border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface disabled:opacity-50 md:min-h-0"
              >
                {comparison.kind === "running" ? "Comparing…" : "Compare the two readings"}
              </button>
              {comparison.kind === "running" ? (
                <p className="mt-2 font-body text-xs text-muted">
                  {comparison.load?.message ?? `${comparison.done} of ${comparison.total} photos`}
                </p>
              ) : comparison.kind === "failed" ? (
                <p className="mt-2 font-body text-sm text-danger-ink">{comparison.message}</p>
              ) : comparison.kind === "done" ? (
                <dl data-check-compare className="mt-3 grid grid-cols-2 gap-3">
                  <Score label="One reading: first" value={share(comparison.plain.first, comparison.plain.scored)} />
                  <Score label="Three readings: first" value={share(comparison.robust.first, comparison.robust.scored)} />
                  <Score label="One reading: top three" value={share(comparison.plain.topThree, comparison.plain.scored)} />
                  <Score label="Three readings: top three" value={share(comparison.robust.topThree, comparison.robust.scored)} />
                </dl>
              ) : null}
              {phase.data.trials.length > COMPARE_LIMIT ? (
                <p className="mt-2 font-body text-xs text-muted">Compares the first {COMPARE_LIMIT} photos.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Score({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-body text-base font-medium text-foreground">{value}</dd>
    </div>
  );
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}
