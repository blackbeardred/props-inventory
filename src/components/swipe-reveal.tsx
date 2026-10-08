"use client";

import { usePullTargetLabel } from "@/components/add-to-production";

/**
 * The strip an item card uncovers as it's swiped left: where letting go will
 * send it. Named when a production is remembered ("Add to Noises Off!"), so
 * a swipe never goes somewhere the thumb couldn't see; "Add to a production…"
 * when letting go will ask.
 *
 * Swiped right instead, it uncovers "Add to room…" on the left, with where
 * the item is now underneath, in honey so the two directions never look
 * alike.
 *
 * Only drawn while the card is moving — at rest the card covers it anyway.
 */
export function SwipeReveal({
  armed,
  armedRight = false,
  offset,
  place,
  rounded = true,
}: {
  armed: boolean;
  /** Far enough right that letting go opens "Add to room…". */
  armedRight?: boolean;
  offset: number;
  /** Where the item is kept now, for the rightward strip: null when it isn't
   *  filed anywhere. */
  place?: string | null;
  /** False inside a bordered list, where the rows are square. */
  rounded?: boolean;
}) {
  const label = usePullTargetLabel();
  if (offset > 0) {
    return <RoomReveal armed={armedRight} gap={offset} place={place ?? null} rounded={rounded} />;
  }
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

function RoomReveal({
  armed,
  gap,
  place,
  rounded,
}: {
  armed: boolean;
  gap: number;
  place: string | null;
  rounded: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      data-swipe-reveal-room
      className={`absolute inset-0 flex items-center justify-start overflow-hidden pl-3 transition-colors ${
        rounded ? "rounded-lg" : ""
      } ${armed ? "bg-honey text-foreground" : "bg-honey/25 text-foreground"}`}
    >
      <span
        className="flex min-w-0 flex-col items-start gap-0.5 overflow-hidden text-left"
        style={{ width: Math.max(0, gap - 18) }}
      >
        <span className="flex max-w-full items-center gap-1.5 whitespace-nowrap font-mono text-[11px] leading-none">
          <span
            className={`hex w-2.5 shrink-0 transition-[rotate,background-color] duration-150 ${
              armed ? "rotate-90 bg-foreground" : "bg-honey"
            }`}
          />
          <span className="min-w-0 truncate">{place ? `Now in ${place}` : "Not filed yet"}</span>
        </span>
        <span className="max-w-full truncate font-body text-sm font-medium leading-tight">
          Add to room…
        </span>
      </span>
    </div>
  );
}
