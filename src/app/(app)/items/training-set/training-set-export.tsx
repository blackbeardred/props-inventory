"use client";

/**
 * Downloads the training set: fetches each photo from storage, then zips
 * them with labels.csv and a README (src/lib/zip.ts, stored, since JPEGs
 * don't compress). The layout was worked out on the server.
 */

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PHOTOS_BUCKET } from "@/lib/supabase/storage";
import { trainingCsv, trainingReadme, type TrainingPlan } from "@/lib/training-set";
import { makeZip, type ZipEntry } from "@/lib/zip";

/** Downloads in flight at once: quick, without flooding a phone's connection. */
const CONCURRENCY = 4;

type Phase =
  | { kind: "idle" }
  | { kind: "downloading"; done: number; total: number }
  | { kind: "done"; files: number; missing: number }
  | { kind: "failed"; message: string };

export function TrainingSetExport({
  theatre,
  confirmedOnly,
  everything,
  perLabel,
}: {
  theatre: string;
  confirmedOnly: TrainingPlan;
  everything: TrainingPlan;
  perLabel: number;
}) {
  const [includeAll, setIncludeAll] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const plan = includeAll ? everything : confirmedOnly;
  const ready = plan.labels.filter((label) => label.files.length >= perLabel).length;
  const confirmed = plan.labels.reduce((total, label) => total + label.confirmed, 0);
  const busy = phase.kind === "downloading";

  async function download() {
    const supabase = createClient();
    const files = plan.files;
    const fetched = new Map<string, Uint8Array>();
    const missing: string[] = [];
    let done = 0;
    let next = 0;
    setPhase({ kind: "downloading", done, total: files.length });

    async function worker() {
      while (next < files.length) {
        const file = files[next++];
        try {
          const { data, error } = await supabase.storage.from(PHOTOS_BUCKET).download(file.storagePath);
          if (error || !data) throw new Error(error?.message ?? "missing");
          fetched.set(file.path, new Uint8Array(await data.arrayBuffer()));
        } catch {
          missing.push(file.storagePath);
        }
        done += 1;
        setPhase({ kind: "downloading", done, total: files.length });
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
      const made = new Date();
      const kept = files.filter((file) => fetched.has(file.path));
      const encoder = new TextEncoder();
      const entries: ZipEntry[] = [
        { name: "README.txt", data: encoder.encode(trainingReadme(plan, { theatre, made, missing })), date: made },
        { name: "labels.csv", data: encoder.encode(trainingCsv(kept)), date: made },
        ...kept.map((file) => ({ name: file.path, data: fetched.get(file.path)!, date: made })),
      ];
      const zip = makeZip(entries);
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `training-set-${made.toISOString().slice(0, 10)}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      // Long enough for the browser to have started saving it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setPhase({ kind: "done", files: kept.length, missing: missing.length });
    } catch (problem) {
      setPhase({
        kind: "failed",
        message: problem instanceof Error ? problem.message : "Couldn’t make the download.",
      });
    }
  }

  return (
    <section data-training-set className="space-y-4 rounded-lg border border-rule bg-surface px-4 py-4">
      <dl className="grid grid-cols-3 gap-3">
        <Stat label="Labels" value={plan.labels.length} />
        <Stat label="Pictures" value={plan.files.length} />
        <Stat label={`Ready (${perLabel}+)`} value={ready} />
      </dl>
      <p className="font-body text-sm text-muted">
        {confirmed} confirmed {confirmed === 1 ? "picture" : "pictures"}, plus each item’s own photo.
        Twins share a label, because a camera can’t tell them apart. Recognition services want
        about {perLabel} pictures per label before they’ll train; every confirmed match gets a
        label closer.
      </p>

      <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 font-body text-sm text-foreground md:min-h-0">
        <input
          type="checkbox"
          checked={includeAll}
          disabled={busy}
          onChange={(event) => setIncludeAll(event.target.checked)}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        Also include items that only have their own photo
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || plan.files.length === 0}
          onClick={() => void download()}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 font-body text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0"
        >
          <span aria-hidden="true" className="hex w-3 bg-honey" />
          {busy ? "Downloading…" : "Download training set (.zip)"}
        </button>
        <p role="status" className="font-body text-sm text-muted">
          {phase.kind === "downloading"
            ? `${phase.done} of ${phase.total} pictures`
            : phase.kind === "done"
              ? `Saved ${phase.files} ${phase.files === 1 ? "picture" : "pictures"}${
                  phase.missing ? `; ${phase.missing} couldn’t be fetched (listed in README.txt)` : ""
                }.`
              : phase.kind === "failed"
                ? phase.message
                : plan.files.length === 0
                  ? "Nothing to download yet."
                  : ""}
        </p>
      </div>

      {plan.labels.length ? (
        <details className="font-body text-sm">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-accent-ink md:min-h-0">
            What’s in it
          </summary>
          <ul data-training-labels className="mt-2 divide-y divide-rule rounded-md border border-rule bg-background">
            {plan.labels.map((label) => (
              <li key={label.label} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-foreground">{label.name}</span>
                  <span className="block font-mono text-[11px] text-muted">
                    {label.label}/{label.itemIds.length > 1 ? ` · ${label.itemIds.length} twins` : ""}
                  </span>
                </span>
                <span
                  className={`shrink-0 font-mono text-xs ${
                    label.files.length >= perLabel ? "text-success-ink" : "text-muted"
                  }`}
                >
                  {label.files.length}/{perLabel}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="font-mono text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-display text-2xl text-foreground">{value}</dd>
    </div>
  );
}
