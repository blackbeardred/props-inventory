"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { flushSync } from "react-dom";
import { ItemDetails, type ItemCellData } from "@/components/item-cell";
import { SwipeReveal } from "@/components/swipe-reveal";
import { addToProductionMenu, requestAddToProduction } from "@/components/add-to-production";
import { useContextMenu } from "@/components/context-menu";
import { useSwipeLeft } from "@/lib/use-swipe";
import { CATEGORY_LABELS } from "@/lib/inventory";

/** One half of the list/grid switch on the items page. */
export function ViewTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`inline-flex min-h-10 items-center rounded px-4 font-body text-sm transition-colors ${
        active
          ? "bg-accent font-medium text-background"
          : "text-muted hover:bg-surface hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}

/** Above this many tiles the morph is skipped: the browser snapshots every
 *  named tile, and a few hundred of them would stutter on a phone. */
const MORPH_LIMIT = 120;

/**
 * One item as a picture, which opens the way a list cell does.
 *
 * Names in a props store are approximate — "the small urn", "the good
 * candlestick" — so a wall of photographs is often the faster way to find
 * something than a column of text. Tapping a tile used to leave for the edit
 * page; now it opens in place, like the list: the tile takes the whole row,
 * its photo grows (full width on a phone, a large square beside the facts
 * from tablet up), and the same details the list shows sit under the name,
 * Edit included. The grid packs densely, so the tiles that were beside it
 * close the gap rather than leave a hole.
 *
 * Where the browser has view transitions the change is animated — the tile
 * grows into its row and the others slide to their new places. Elsewhere,
 * and with reduced motion, it simply opens.
 */
export function ItemTile({ item }: { item: ItemCellData }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const ref = useRef<HTMLLIElement>(null);
  // On a phone, a swipe to the left puts it on a production's pull list.
  const swipe = useSwipeLeft(() => requestAddToProduction({ id: item.id, name: item.name }));
  // …and on a computer, a right-click offers the same.
  const context = useContextMenu(item.name, () =>
    addToProductionMenu({ id: item.id, name: item.name })
  );

  const place = item.locationId ? (item.locationName ?? "Unknown location") : "Unassigned";

  function toggle() {
    const next = !open;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const apply = () => flushSync(() => setOpen(next));

    // Once it's open, make sure it's on screen: dense packing can move
    // it up a row, and opening near the bottom pushes it below the fold.
    // After the morph, not during it — a scroll inside the transition slides
    // the whole page snapshot along with it.
    const reveal = () => {
      const tile = ref.current;
      if (!next || !tile) return;
      const box = tile.getBoundingClientRect();
      // As little scrolling as gets the top of it — the photo and the name,
      // or as much of a tall one as fits — clear of the tab bar.
      const shown = Math.min(box.height, window.innerHeight - 160);
      const delta =
        box.top < 0 ? box.top - 16 : Math.max(0, box.top + shown - (window.innerHeight - 80));
      if (delta !== 0) window.scrollBy({ top: delta, behavior: reduce ? "auto" : "smooth" });
    };

    const list = ref.current?.parentElement;
    if (
      !reduce &&
      list &&
      list.children.length <= MORPH_LIMIT &&
      typeof document.startViewTransition === "function"
    ) {
      const tile = ref.current!;
      list.dataset.morphing = "";
      tile.dataset.morphSelf = "";
      document.documentElement.dataset.morphing = "";
      document
        .startViewTransition(apply)
        .finished.finally(() => {
          delete list.dataset.morphing;
          delete tile.dataset.morphSelf;
          delete document.documentElement.dataset.morphing;
          reveal();
        });
    } else {
      apply();
      reveal();
    }
  }

  return (
    <li
      ref={ref}
      data-item-tile
      data-open={open ? "" : undefined}
      // Named only while a morph runs (see globals.css): the name is what
      // lets the browser match this tile's old box to its new one. The tile
      // being opened or shut lends the name to its photo instead.
      style={{ "--vt": `tile-${item.id}` } as CSSProperties}
      // Clipped, so a tile swiped left slides under its own edge rather
      // than over the tile beside it.
      className={`relative overflow-hidden rounded-lg ${open ? "col-span-full" : "h-full"}`}
    >
      <SwipeReveal armed={swipe.armed} offset={swipe.offset} />
      {context.menu}
      <div
        {...swipe.handlers}
        onContextMenu={context.onContextMenu}
        style={swipe.style}
        className={`relative cursor-pointer overflow-hidden rounded-lg border border-rule bg-surface transition-colors hover:border-accent-soft ${
          open ? "sm:flex sm:items-start" : "flex h-full flex-col"
        }`}
        onClick={(event) => {
          // Links and buttons inside keep their own meaning, a drag to
          // select text isn't a tap, and nor is a swipe.
          if ((event.target as Element).closest("a, button")) return;
          if (window.getSelection()?.toString()) return;
          if (swipe.justSwiped()) return;
          toggle();
        }}
      >
        {item.photoUrl || !open ? (
          <div
            data-tile-photo
            className={`relative aspect-square shrink-0 bg-background ${
              open ? "w-full sm:w-72 lg:w-80" : "w-full"
            }`}
          >
            {item.photoUrl ? (
              // Absolutely placed, not h-full: in a flex column the box's
              // automatic minimum height is its content's, so a tall photo (a
              // violin, a hat stand) used to push the square taller — and the
              // grid then stretched every tile in that row to match.
              // eslint-disable-next-line @next/next/no-img-element -- signed URL from a private bucket
              <img
                src={item.photoUrl}
                alt={open ? item.name : ""}
                className="absolute inset-0 h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center px-2 text-center font-body text-xs text-muted">
                No photo
              </span>
            )}

            {item.quantity > 1 ? (
              <span className="absolute right-1.5 top-1.5 rounded bg-surface/90 px-1.5 py-0.5 font-body text-xs text-foreground">
                ×{item.quantity}
              </span>
            ) : null}

            {item.inUse ? (
              <span
                title={`In use in ${item.inUse.productionName}`}
                className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-surface/90 px-1.5 py-0.5 font-body text-xs text-foreground"
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-[7px] w-[7px] rounded-full bg-in-use"
                />
                In use
              </span>
            ) : null}
          </div>
        ) : null}

        <div className={open ? "min-w-0 flex-1 px-4 pb-1 pt-3.5" : "p-2.5"}>
          <div className="flex items-start gap-2">
            {/* The real control, for a keyboard or a screen reader; a tap
                anywhere on the tile does the same. Ringed on an unclipped
                wrapper because a clip-path clips the element's own outline. */}
            <span
              data-print-hide
              className={`inline-flex shrink-0 rounded-[2px] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                open ? "mt-1.5" : "mt-[3px]"
              }`}
            >
              <button
                type="button"
                data-tile-button
                data-hex-toggle
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                onClick={toggle}
                title={open ? `Hide details for ${item.name}` : `Show details for ${item.name}`}
                className={`hex w-3.5 cursor-pointer border-0 p-0 outline-none transition-[rotate,background-color] duration-200 ${
                  open ? "rotate-90 bg-foreground" : "bg-honey"
                }`}
              >
                <span className="sr-only">
                  {open ? `Hide details for ${item.name}` : `Show details for ${item.name}`}
                </span>
              </button>
            </span>

            <div className="min-w-0">
              <h3
                className={
                  open
                    ? "font-display text-xl font-semibold leading-tight text-foreground"
                    : "line-clamp-2 font-body text-sm font-medium text-foreground"
                }
              >
                {item.name}
              </h3>
              {open ? (
                <p className="mt-0.5 font-mono text-[11px] leading-snug tracking-[0.02em] text-muted">
                  {CATEGORY_LABELS[item.category] ?? item.category} · {place}
                </p>
              ) : (
                <p className="mt-1 line-clamp-1 font-body text-xs text-muted">
                  {item.locationId ? place : "Unassigned"}
                </p>
              )}
            </div>
          </div>

          {open ? (
            <div id={panelId}>
              <ItemDetails item={item} />
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
