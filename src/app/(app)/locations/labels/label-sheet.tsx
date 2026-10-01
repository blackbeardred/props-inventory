"use client";

import { useState } from "react";
import { QrCode } from "@/components/qr-code";
import type { QrSymbol } from "@/lib/qr-svg";

export type LabelData = {
  id: string;
  /** "Shakespeare box" */
  name: string;
  /** "Props Room A / Shelf 3" — where this box lives, without its own name. */
  within: string;
  itemCount: number;
  /** Whether anything is stored inside this location. */
  hasChildren: boolean;
  url: string;
  symbol: QrSymbol;
};

/**
 * Two sizes, because a shoebox end and a rack shelf are not the same surface.
 * The measurements are in millimetres so they mean the same thing on paper as
 * on screen — a label that comes out of the printer at the wrong size is
 * useless, and a label measured in pixels is a label measured in nothing.
 */
const SIZES = {
  standard: {
    label: "Standard",
    width: "63.5mm",
    height: "44.5mm",
    name: "text-sm",
  },
  large: {
    label: "Large",
    width: "96mm",
    height: "66mm",
    name: "text-lg",
  },
} as const;

type SizeKey = keyof typeof SIZES;

export function LabelSheet({ labels }: { labels: LabelData[] }) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(labels.map((l) => l.id)));
  const [size, setSize] = useState<SizeKey>("standard");

  const measurements = SIZES[size];
  const count = chosen.size;

  function toggle(id: string) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <div
        data-print-hide
        className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-rule bg-surface px-4 py-3"
      >
        <p className="font-body text-sm text-muted">
          {count === 0
            ? "Nothing chosen — tick a label to print it."
            : `${count} label${count === 1 ? "" : "s"} will print.`}
        </p>

        <div className="flex items-center gap-2 font-body text-sm">
          <button
            type="button"
            onClick={() => setChosen(new Set(labels.map((l) => l.id)))}
            className="rounded px-2 py-1 text-muted hover:text-foreground hover:underline"
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setChosen(new Set())}
            className="rounded px-2 py-1 text-muted hover:text-foreground hover:underline"
          >
            None
          </button>
          {/* The usual job: you have relabelled the boxes, not the rooms. */}
          <button
            type="button"
            onClick={() =>
              setChosen(new Set(labels.filter((l) => !l.hasChildren).map((l) => l.id)))
            }
            className="rounded px-2 py-1 text-muted hover:text-foreground hover:underline"
          >
            Only boxes
          </button>
        </div>

        <div className="flex items-center gap-1 font-body text-sm">
          {(Object.keys(SIZES) as SizeKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSize(key)}
              aria-pressed={size === key}
              className={`rounded-md px-2.5 py-1 ${
                size === key
                  ? "bg-accent text-background"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {SIZES[key].label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => window.print()}
          disabled={count === 0}
          className="ml-auto inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 font-body text-sm font-medium text-background transition-colors hover:opacity-90 disabled:opacity-40"
        >
          Print
        </button>
      </div>

      {/* As wide as A4 leaves once the page margin is taken off, so what you
          see here is what comes out of the printer — three across, and the
          same labels on the same rows. */}
      <div className="flex w-[194mm] max-w-full flex-wrap">
        {labels.map((label) => {
          const picked = chosen.has(label.id);
          return (
            <div
              key={label.id}
              data-label
              // Leaning on the app's existing print rule: anything marked this
              // way is gone from the paper, so an unticked label just isn't
              // printed, and the ones that are printed keep their own places.
              {...(picked ? {} : { "data-print-hide": "" })}
              style={{ width: measurements.width, height: measurements.height }}
              className={`relative flex flex-col overflow-hidden border border-dashed border-rule bg-white p-2.5 ${
                picked ? "" : "opacity-40"
              }`}
            >
              <label
                data-print-hide
                className="absolute right-1.5 top-1.5 cursor-pointer p-1"
                title={picked ? "Don’t print this one" : "Print this one"}
              >
                <input
                  type="checkbox"
                  checked={picked}
                  onChange={() => toggle(label.id)}
                  aria-label={`Print a label for ${label.name}`}
                  className="h-4 w-4 accent-accent"
                />
              </label>

              {/* The name gets the full width and two lines: it is what someone
                  reads from across the room, and a box called "Shakespe…" is
                  not labelled. */}
              <p
                className={`line-clamp-2 pr-6 font-display leading-tight text-black ${measurements.name}`}
              >
                {label.name}
              </p>

              <div className="mt-1.5 flex min-h-0 flex-1 items-end gap-2.5">
                {/* Sized off the space left over rather than fixed, so a
                    two-line name shrinks the code instead of cropping it —
                    a cropped QR still looks like a QR and simply never scans. */}
                <QrCode
                  symbol={label.symbol}
                  label={`Scan for the contents of ${label.name}`}
                  className="h-full w-auto shrink-0"
                />

                <div className="min-w-0 flex-1 pb-0.5">
                  {label.within ? (
                    <p className="line-clamp-3 font-body text-[0.65rem] leading-snug text-neutral-600">
                      {label.within}
                    </p>
                  ) : null}
                  {/* The count and nothing else: at this width anything longer
                      wraps into a ragged second line, and the QR beside it
                      already says what to do. */}
                  <p className="mt-1 font-body text-[0.6rem] leading-snug text-neutral-500">
                    {label.itemCount === 0
                      ? "Nothing listed yet"
                      : `${label.itemCount} item${label.itemCount === 1 ? "" : "s"}`}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
