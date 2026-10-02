"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  CONDITION_TONE,
  formatDate,
  formatDateRange,
} from "@/lib/inventory";

export type ItemCellData = {
  id: string;
  name: string;
  category: "prop" | "costume";
  description: string | null;
  quantity: number;
  condition: "new" | "good" | "fair" | "needs_repair" | null;
  createdAt: string;
  locationId: string | null;
  locationName: string | null;
  photoUrl?: string;
  /** The production it's out on, if it is. */
  inUse?: {
    productionId: string;
    productionName: string;
    startDate: string | null;
    endDate: string | null;
    quantityInUse: number;
  };
};

/**
 * One label→value pair, kept tight.
 *
 * Deliberately *not* spread edge to edge: a label at the left margin and its
 * value at the right one makes the reader's eye travel the width of the card
 * for every fact, and at six facts that is slower than reading a sentence.
 * Close together, they read as one unit and three fit where one used to.
 */
function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 font-mono text-[11px] leading-snug text-muted">{label}</dt>
      <dd className="min-w-0 font-body text-[13px] font-semibold leading-snug text-foreground">
        {children}
      </dd>
    </div>
  );
}

/**
 * One item, sealed in its own cell.
 *
 * The collapsed card carries only what you need to find the thing — its name,
 * and quietly beneath it what kind of thing it is and where it lives. Every
 * other fact is behind the hexagon on the left edge, which is a real button
 * rather than a decoration: it is the only hexagon on the card, and pressing
 * it is the only thing it does.
 *
 * The panel opens by animating a grid row from 0fr to 1fr rather than by
 * animating a max-height to a fixed number. Same reveal, but a long
 * description can't be silently guillotined by a magic pixel value that was
 * chosen against six short rows of placeholder text.
 */
export function ItemCell({ item }: { item: ItemCellData }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const condition = item.condition;
  const place = item.locationId ? (item.locationName ?? "Unknown location") : "Unassigned";

  return (
    <li
      // Padded on the left to leave the cell button its own margin, so the
      // hexagon sits half outside the card the way a tab does.
      className="relative rounded-lg border border-rule bg-surface py-3 pl-6 pr-3.5 sm:pl-7"
    >
      {/* The focus ring lives on this wrapper, not on the button. A clip-path
          clips the element's own outline too, so a focused hexagon would draw
          a ring and then cut it off — invisible to exactly the person who
          needs it. The wrapper is unclipped and rings on behalf of its child. */}
      <span
        data-print-hide
        className="absolute -left-[9px] top-4 inline-flex rounded-[2px] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
      >
        <button
          type="button"
          data-cell-button
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
          title={open ? `Hide details for ${item.name}` : `Show details for ${item.name}`}
          // `scale`, not `transform`: Tailwind v4 compiles scale-110 to the
          // standalone scale property, so a transition on transform never
          // animated it.
          className={`hex h-[23px] w-[20px] cursor-pointer border-0 p-0 outline-none transition-[scale,background-color] duration-150 hover:scale-110 active:scale-95 ${
            open ? "bg-foreground" : "bg-honey"
          }`}
        >
          <span className="sr-only">
            {open ? `Hide details for ${item.name}` : `Show details for ${item.name}`}
          </span>
        </button>
      </span>

      <div className="flex items-start gap-3">
        {item.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL from a private bucket
          <img
            src={item.photoUrl}
            alt=""
            loading="lazy"
            className="h-12 w-12 shrink-0 rounded object-cover"
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[17px] font-semibold leading-tight">
            <Link
              href={`/items/${item.id}/edit`}
              className="text-foreground underline-offset-2 hover:underline"
            >
              {item.name}
            </Link>
          </h3>

          {/* Quiet on purpose. This is a caption under the name, not a second
              heading competing with it. */}
          <p className="mt-0.5 font-mono text-[11px] leading-snug tracking-[0.02em] text-muted">
            {CATEGORY_LABELS[item.category] ?? item.category} · {place}
          </p>

          {!open ? (
            <p data-print-hide className="mt-0.5 font-mono text-[10px] leading-snug text-muted/75">
              tap the cell for details
            </p>
          ) : null}
        </div>

        {item.inUse ? (
          <span
            title={`In use in ${item.inUse.productionName}`}
            className="mt-0.5 flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-in-use-ink"
          >
            <span aria-hidden="true" className="hex inline-block h-[9px] w-[8px] bg-in-use" />
            {item.quantity > 1
              ? `${item.inUse.quantityInUse}/${item.quantity} in use`
              : "in use"}
          </span>
        ) : null}
      </div>

      <div
        id={panelId}
        data-cell-panel
        // 0fr → 1fr animates to whatever the content actually is. The inner
        // div owns the overflow, because a grid item can't hide its own.
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          {/* Two content-width columns rather than two halves. Equal halves
              push the right-hand pair out to the middle of the card and
              reintroduce exactly the long eye-travel the tight pairs were
              meant to remove. */}
          <dl className="mt-2.5 grid grid-cols-1 gap-x-10 gap-y-1 border-t border-dashed border-rule pt-2.5 sm:grid-cols-[auto_auto] sm:justify-start">
            {item.inUse ? (
              <Pair label="Production">
                <Link
                  href={`/productions/${item.inUse.productionId}`}
                  className="text-accent-ink underline-offset-2 hover:underline"
                >
                  {item.inUse.productionName}
                </Link>
                <span className="ml-1.5 font-mono text-[11px] font-normal text-muted">
                  {formatDateRange(item.inUse.startDate, item.inUse.endDate)}
                </span>
              </Pair>
            ) : (
              <Pair label="Production">
                <span className="font-normal text-muted">Not pulled for anything</span>
              </Pair>
            )}

            <Pair label="Condition">
              {condition ? (
                <Badge tone={CONDITION_TONE[condition] ?? "muted"}>
                  {CONDITION_LABELS[condition] ?? condition}
                </Badge>
              ) : (
                <span className="font-normal text-muted">Not recorded</span>
              )}
            </Pair>

            <Pair label="Qty">{item.quantity}</Pair>

            <Pair label="Cell">
              {item.locationId ? (
                <Link
                  href={`/items?location=${item.locationId}`}
                  className="text-accent-ink underline-offset-2 hover:underline"
                >
                  {item.locationName ?? "Unknown location"}
                </Link>
              ) : (
                <span className="font-normal text-muted">Unassigned</span>
              )}
            </Pair>

            <Pair label="Added">{formatDate(item.createdAt)}</Pair>

            <Pair label="Category">
              <Badge tone={item.category === "costume" ? "accent" : "neutral"}>
                {CATEGORY_LABELS[item.category] ?? item.category}
              </Badge>
            </Pair>

            {item.description ? (
              <div className="max-w-[80ch] sm:col-span-2">
                <Pair label="Notes">
                  <span className="font-normal">{item.description}</span>
                </Pair>
              </div>
            ) : null}
          </dl>

          <p className="mt-2">
            <Link
              href={`/items/${item.id}/edit`}
              className="font-mono text-[11px] text-accent underline-offset-2 hover:underline"
            >
              Edit this item →
            </Link>
          </p>
        </div>
      </div>
    </li>
  );
}
