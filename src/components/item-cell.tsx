"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { SwipeReveal } from "@/components/swipe-reveal";
import { addToProductionMenu, requestAddToProduction } from "@/components/add-to-production";
import { useContextMenu } from "@/components/context-menu";
import { useSwipeLeft } from "@/lib/use-swipe";
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
 * rather than a decoration: it is what a keyboard or a screen reader uses,
 * and it shows open or shut.
 *
 * A tap anywhere on the card does the same. It used to be the hexagon alone,
 * under a caption saying "tap the cell for details" — and people read "cell"
 * as the card, tapped it, and got nothing. On a phone the hexagon is a 22px
 * target and the card is the whole width of the screen.
 *
 * The panel opens by animating a grid row from 0fr to 1fr rather than by
 * animating a max-height to a fixed number. Same reveal, but a long
 * description can't be silently guillotined by a magic pixel value that was
 * chosen against six short rows of placeholder text.
 */
export function ItemCell({ item }: { item: ItemCellData }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  // On a phone, a swipe to the left puts it on a production's pull list.
  const swipe = useSwipeLeft(() => requestAddToProduction({ id: item.id, name: item.name }));
  // …and on a computer, a right-click offers the same.
  const context = useContextMenu(item.name, () =>
    addToProductionMenu({ id: item.id, name: item.name })
  );

  const place = item.locationId ? (item.locationName ?? "Unknown location") : "Unassigned";

  return (
    <li className="relative">
      <SwipeReveal armed={swipe.armed} offset={swipe.offset} />
      {context.menu}
      <div
        {...swipe.handlers}
        onContextMenu={context.onContextMenu}
        // Padded on the left to leave the cell button its own margin, so the
        // hexagon sits half outside the card the way a tab does.
        className="relative cursor-pointer rounded-lg border border-rule bg-surface py-3 pl-6 pr-3.5 sm:pl-7"
        style={swipe.style}
        onClick={(event) => {
          // Links, buttons and fields inside the card keep their own meaning,
          // a drag to select text isn't a tap, and nor is a swipe.
          const target = event.target as Element;
          if (target.closest("a, button, input, select, textarea, label")) return;
          if (window.getSelection()?.toString()) return;
          if (swipe.justSwiped()) return;
          setOpen((current) => !current);
        }}
      >
        {/* The focus ring lives on this wrapper, not on the button. A clip-path
            clips the element's own outline too, so a focused hexagon would draw
            a ring and then cut it off — invisible to exactly the person who
            needs it. The wrapper is unclipped and rings on behalf of its child. */}
        <span
          data-print-hide
          className="absolute -left-[10px] top-4 inline-flex rounded-[2px] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
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
            className={`hex w-[22px] cursor-pointer border-0 p-0 outline-none transition-[scale,background-color] duration-150 hover:scale-110 active:scale-95 ${
              open ? "bg-foreground" : "bg-honey"
            }`}
          >
            <span className="sr-only">
              {open ? `Hide details for ${item.name}` : `Show details for ${item.name}`}
            </span>
          </button>
        </span>

        {/* On a phone, opening the card grows the photo to the card's full
            width and the name and everything else drop beneath it — at 48px a
            prop is a smudge, and the picture is how you know it's the right
            one. Only the width animates: the box is square in both states, so
            its height follows, and flex-wrap moves the text below once the
            photo needs the whole row. From md up it grows to a 192px square
            with the name beside it, which is big enough to tell two brass
            candlesticks apart without crowding the columns of cells. */}
        <div className="flex flex-wrap items-start gap-x-3 gap-y-3">
          {item.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed URL from a private bucket
            <img
              src={item.photoUrl}
              alt={open ? item.name : ""}
              loading="lazy"
              data-cell-photo
              className={`aspect-square shrink-0 rounded object-cover transition-[width,border-radius] duration-300 ease-out motion-reduce:transition-none ${
                open ? "w-full rounded-lg md:w-48" : "w-12"
              }`}
            />
          ) : null}

          <div className="min-w-[9rem] flex-1">
            {/* Plain text, not a link to the edit page: the name is the
                biggest thing on the card, so it's what gets tapped, and a tap
                should open the card rather than leave the list. Editing is
                one line down, inside it. */}
            <h3 className="font-display text-[17px] font-semibold leading-tight text-foreground">
              {item.name}
            </h3>

            {/* Quiet on purpose. This is a caption under the name, not a second
                heading competing with it. */}
            <p className="mt-0.5 font-mono text-[11px] leading-snug tracking-[0.02em] text-muted">
              {CATEGORY_LABELS[item.category] ?? item.category} · {place}
            </p>

            {!open ? (
              <p data-print-hide className="mt-0.5 font-mono text-[10px] leading-snug text-muted/75">
                tap for details
              </p>
            ) : null}
          </div>

          {item.inUse ? (
            <span
              title={`In use in ${item.inUse.productionName}`}
              className="mt-0.5 flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-in-use-ink"
            >
              <span aria-hidden="true" className="hex inline-block w-[9px] bg-in-use" />
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
            <ItemDetails item={item} />
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * Everything about an item past its name: the facts under an opened list
 * cell, and the same under an opened grid tile. One component so the two
 * views can't drift apart.
 */
export function ItemDetails({ item }: { item: ItemCellData }) {
  const condition = item.condition;
  return (
    <>
      {/* Two content-width columns rather than two halves. Equal halves
          push the right-hand pair out to the middle of the card and
          reintroduce exactly the long eye-travel the tight pairs were
          meant to remove. */}
      <dl className="mt-2.5 grid grid-cols-1 gap-x-10 gap-y-1 border-t border-dashed border-rule pt-2.5 sm:grid-cols-[auto_auto] sm:justify-start">
        {item.inUse ? (
          <Pair label="Production">
            <Link
              href={`/productions/${item.inUse.productionId}`}
              className="-my-3.5 inline-block py-3.5 text-accent-ink underline-offset-2 hover:underline"
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

        <Pair label="Kept in">
          {item.locationId ? (
            <Link
              href={`/inventory?place=${item.locationId}`}
              // The padding widens what a thumb can hit without moving
              // the line; the negative margin gives the space back.
              className="-my-3.5 inline-block py-3.5 text-accent-ink underline-offset-2 hover:underline"
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

      <p className="mt-2 flex flex-wrap gap-x-5">
        <Link
          href={`/items/${item.id}/edit`}
          className="inline-flex min-h-11 items-center font-mono text-[11px] text-accent underline-offset-2 hover:underline"
        >
          Edit this item →
        </Link>
        {/* What a left swipe does on a phone, as a button for everyone
            else — and for anyone who didn't know about the swipe. */}
        <button
          type="button"
          onClick={() => requestAddToProduction({ id: item.id, name: item.name })}
          className="inline-flex min-h-11 cursor-pointer items-center font-mono text-[11px] text-accent underline-offset-2 hover:underline"
        >
          Add to a production →
        </button>
      </p>
    </>
  );
}
