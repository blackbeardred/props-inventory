"use client";

import { usePullTargetLabel } from "@/components/add-to-production";

/**
 * The strip an item card uncovers as it's swiped left: where letting go will
 * send it. Named when a production is remembered ("Add to Noises Off!"), so
 * a swipe never goes somewhere the thumb couldn't see; "Add to a production…"
 * when letting go will ask.
 *
 * Only drawn while the card is moving — at rest the card covers it anyway.
 */
export function SwipeReveal({
  armed,
  offset,
  rounded = true,
}: {
  armed: boolean;
  offset: number;
  /** False inside a bordered list, where the rows are square. */
  rounded?: boolean;
}) {
  const label = usePullTargetLabel();
  // Negative: the card moves left, uncovering the strip's right-hand end.
  const gap = -offset;
  if (gap <= 0) return null;

  return (
    <div
      aria-hidden="true"
      data-swipe-reveal
      className={`absolute inset-0 flex items-center justify-end overflow-hidden pr-3 transition-colors ${
        rounded ? "rounded-lg" : ""
      } ${
        armed ? "bg-accent text-background" : "bg-accent/20 text-accent-ink"
      }`}
    >
      {/* As wide as the gap the card has opened, so it reads as it's
          uncovered instead of being cut off by the card. */}
      <span
        className="flex min-w-0 flex-col items-end gap-0.5 overflow-hidden text-right"
        style={{ width: Math.max(0, gap - 18) }}
      >
        <span className="flex items-center gap-1.5 font-mono text-[11px] leading-none">
          <span
            className={`hex w-2.5 shrink-0 transition-[rotate,background-color] duration-150 ${
              armed ? "rotate-90 bg-background" : "bg-honey"
            }`}
          />
          {label ? "Add to" : "Add to a"}
        </span>
        <span className="max-w-full truncate font-body text-sm font-medium leading-tight">
          {label || "production…"}
        </span>
      </span>
    </div>
  );
}
