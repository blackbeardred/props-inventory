"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ItemDetails,
  actionTarget,
  displayName,
  inUseSummary,
  type ItemCellData,
} from "@/components/item-cell";
import { SwipeReveal } from "@/components/swipe-reveal";
import { addToProductionMenu, requestAddToProduction } from "@/components/add-to-production";
import { moveToPlaceMenu, requestMoveToPlace } from "@/components/move-to-place";
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

const PANEL_ID = "item-grid-panel";

/** Which row a tile is in, as the index of that row's last tile. */
function rowEnd(index: number, columns: number, count: number): number {
  return Math.min(count - 1, Math.floor(index / columns) * columns + columns - 1);
}

function columnsOf(list: HTMLElement | null): number {
  if (!list) return 1;
  const tracks = getComputedStyle(list).gridTemplateColumns.split(" ").filter(Boolean).length;
  return Math.max(1, tracks);
}

/**
 * The Inventory page's grid of pictures.
 *
 * Tapping a tile opens its details in a row of their own, straight under the
 * row the tile is in. The tile itself stays exactly where it was, marked as
 * the open one, and so does every other tile: nothing changes column, and
 * nothing slides up to fill a gap. The rows below simply move down to make
 * room. (It used to be the tile that grew to fill a whole row, which on a
 * phone pulled the next tile up into the space it left: a jumpy grid, per the
 * Oct 8 feedback.)
 *
 * One at a time: opening another tile closes the first, so there's only ever
 * one row of details to find.
 */
export function ItemGrid({ items }: { items: ItemCellData[] }) {
  const listRef = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLLIElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [columns, setColumns] = useState(2);
  // The id the details have finished opening for: one frame behind openId,
  // so a newly opened row starts shut and slides open.
  const [shownId, setShownId] = useState<string | null>(null);
  const shown = openId !== null && shownId === openId;

  const openIndex = openId ? items.findIndex((item) => item.id === openId) : -1;
  const open = openIndex >= 0 ? items[openIndex] : null;

  // The column count is whatever the CSS made it at this width, read back
  // rather than duplicated here, and kept current as the window changes.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const read = () => setColumns(columnsOf(list));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  // The row slides open; with reduced motion it's simply there.
  useLayoutEffect(() => {
    if (!openId) return;
    // Two frames: the first paints it shut, the second lets it open.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setShownId(openId));
    });
    return () => cancelAnimationFrame(frame);
  }, [openId]);

  // Once it's open, make sure the details can be seen: as little scrolling
  // as gets the top of them clear of the tab bar, and none if they already
  // are.
  useEffect(() => {
    if (!openId || !shown) return;
    const timer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const box = panel.getBoundingClientRect();
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const visible = Math.min(box.height, window.innerHeight - 200);
      const delta = Math.max(0, box.top + visible - (window.innerHeight - 90));
      if (delta > 0) window.scrollBy({ top: delta, behavior: reduce ? "auto" : "smooth" });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [openId, shown]);

  // Escape closes it, and hands focus back to the tile it came from.
  useEffect(() => {
    if (!openId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const id = openId;
      setOpenId(null);
      listRef.current
        ?.querySelector<HTMLButtonElement>(`[data-item-tile][data-id="${CSS.escape(id)}"] [data-tile-button]`)
        ?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  const toggle = useCallback((id: string) => {
    // Read the columns at the moment of the tap, so the details land under
    // the right row even if the window changed since the last measurement.
    setColumns(columnsOf(listRef.current));
    setOpenId((current) => (current === id ? null : id));
  }, []);

  const end = open ? rowEnd(openIndex, columns, items.length) : -1;
  const column = open ? openIndex % columns : 0;

  return (
    <ul
      ref={listRef}
      data-item-grid
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
    >
      {items.map((item, index) => (
        <ItemGridEntry
          key={item.id}
          item={item}
          isOpen={item.id === openId}
          onToggle={toggle}
          panel={
            index === end && open ? (
              <li ref={panelRef} id={PANEL_ID} data-tile-panel className="col-span-full">
                <TilePanel
                  item={open}
                  shown={shown}
                  notchAt={((column + 0.5) / columns) * 100}
                  onClose={() => toggle(open.id)}
                />
              </li>
            ) : null
          }
        />
      ))}
    </ul>
  );
}

function ItemGridEntry({
  item,
  isOpen,
  onToggle,
  panel,
}: {
  item: ItemCellData;
  isOpen: boolean;
  onToggle: (id: string) => void;
  panel: ReactNode;
}) {
  return (
    <>
      <ItemTile item={item} open={isOpen} onToggle={() => onToggle(item.id)} />
      {panel}
    </>
  );
}

/**
 * One item as a picture. Tapping it opens its details beneath its row (see
 * ItemGrid); the tile itself never moves or changes size.
 */
export function ItemTile({
  item,
  open,
  onToggle,
}: {
  item: ItemCellData;
  open: boolean;
  onToggle: () => void;
}) {
  const name = displayName(item);
  const target = actionTarget(item);
  const inUse = inUseSummary(item);
  // On a phone, a swipe to the left puts it on a production's pull list.
  const swipe = useSwipeLeft(() => requestAddToProduction({ id: target.id, name: target.name }), {
    // …and a swipe to the right files it somewhere.
    onCommitRight: () => requestMoveToPlace(target),
  });
  // …and on a computer, a right-click offers the same.
  const context = useContextMenu(name, () => [
    ...addToProductionMenu({ id: target.id, name: target.name }),
    ...moveToPlaceMenu(target),
  ]);

  return (
    <li
      data-item-tile
      data-id={item.id}
      data-copies={item.copies ? item.copies.length : undefined}
      data-open={open ? "" : undefined}
      // Clipped, so a tile swiped sideways slides under its own edge rather
      // than over the tile beside it.
      className="relative h-full overflow-hidden rounded-lg"
    >
      <SwipeReveal
        armed={swipe.armed}
        armedRight={swipe.armedRight}
        offset={swipe.offset}
        place={target.locationId ? (target.locationName ?? "a place") : null}
      />
      {context.menu}
      <div
        {...swipe.handlers}
        onContextMenu={context.onContextMenu}
        style={swipe.style}
        className={`relative flex h-full cursor-pointer flex-col overflow-hidden rounded-lg border bg-surface transition-colors ${
          open ? "border-foreground" : "border-rule hover:border-accent-soft"
        }`}
        onClick={(event) => {
          // Links and buttons inside keep their own meaning, a drag to
          // select text isn't a tap, and nor is a swipe.
          if ((event.target as Element).closest("a, button")) return;
          if (window.getSelection()?.toString()) return;
          if (swipe.justSwiped()) return;
          onToggle();
        }}
      >
        <div data-tile-photo className="relative aspect-square w-full shrink-0 bg-background">
          {item.photoUrl ? (
            // Absolutely placed, not h-full: in a flex column the box's
            // automatic minimum height is its content's, so a tall photo (a
            // violin, a hat stand) used to push the square taller — and the
            // grid then stretched every tile in that row to match.
            // eslint-disable-next-line @next/next/no-img-element -- signed URL from a private bucket
            <img
              src={item.photoUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center px-2 text-center font-body text-xs text-muted">
              No photo
            </span>
          )}

          {/* A stack of copies says how many in its name instead. */}
          {item.quantity > 1 && !item.copies ? (
            <span className="absolute right-1.5 top-1.5 rounded bg-surface/90 px-1.5 py-0.5 font-body text-xs text-foreground">
              ×{item.quantity}
            </span>
          ) : null}

          {inUse ? (
            <span
              title={`In use in ${inUse.production}`}
              className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-surface/90 px-1.5 py-0.5 font-body text-xs text-foreground"
            >
              <span aria-hidden="true" className="inline-block h-[7px] w-[7px] rounded-full bg-in-use" />
              {inUse.of > 1 && item.copies ? `${inUse.out}/${inUse.of} in use` : "In use"}
            </span>
          ) : null}
        </div>

        <div className="p-2.5">
          <div className="flex items-start gap-2">
            {/* The real control, for a keyboard or a screen reader; a tap
                anywhere on the tile does the same. Ringed on an unclipped
                wrapper because a clip-path clips the element's own outline. */}
            <span
              data-print-hide
              className="mt-[3px] inline-flex shrink-0 rounded-[2px] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
            >
              <button
                type="button"
                data-tile-button
                data-hex-toggle
                aria-expanded={open}
                aria-controls={open ? PANEL_ID : undefined}
                onClick={onToggle}
                title={open ? `Hide details for ${name}` : `Show details for ${name}`}
                className={`hex w-3.5 cursor-pointer border-0 p-0 outline-none transition-[rotate,background-color] duration-200 ${
                  open ? "rotate-90 bg-foreground" : "bg-honey"
                }`}
              >
                <span className="sr-only">
                  {open ? `Hide details for ${name}` : `Show details for ${name}`}
                </span>
              </button>
            </span>

            <div className="min-w-0">
              <h3 className="line-clamp-2 font-body text-sm font-medium text-foreground">{name}</h3>
              <p className="mt-1 line-clamp-1 font-body text-xs text-muted">
                {item.locationId ? (item.locationName ?? "Unknown location") : "Unassigned"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * The opened tile's details, in a row of their own under its row: the photo
 * large (full width on a phone, a 320px square beside the facts from a tablet
 * up), the name, and the same details the list shows. A small notch points up
 * at the tile they belong to.
 */
function TilePanel({
  item,
  shown,
  notchAt,
  onClose,
}: {
  item: ItemCellData;
  shown: boolean;
  /** Where the tile is, as a percentage across the grid. */
  notchAt: number;
  onClose: () => void;
}) {
  const name = displayName(item);
  const place = item.locationId ? (item.locationName ?? "Unknown location") : "Unassigned";
  return (
    <div
      // 0fr → 1fr, the same reveal the list cells use: it grows to whatever
      // the details are, rather than to a guessed height.
      className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
      style={{ gridTemplateRows: shown ? "1fr" : "0fr" }}
    >
      <div className="overflow-hidden">
        <div className="relative pt-2">
          <span
            aria-hidden="true"
            data-tile-notch
            className="absolute top-0 h-2.5 w-4 -translate-x-1/2 bg-foreground [clip-path:polygon(50%_0,100%_100%,0_100%)]"
            style={{ left: `${notchAt}%` }}
          />
          <div className="relative overflow-hidden rounded-lg border border-foreground bg-surface sm:flex sm:items-start">
            {item.photoUrl ? (
              <div data-tile-photo className="relative aspect-square w-full shrink-0 bg-background sm:w-72 lg:w-80">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed URL from a private bucket */}
                <img src={item.photoUrl} alt={name} className="absolute inset-0 h-full w-full object-cover" />
              </div>
            ) : null}
            <div className="min-w-0 flex-1 px-4 pb-1 pt-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-display text-xl font-semibold leading-tight text-foreground">{name}</h3>
                  <p className="mt-0.5 font-mono text-[11px] leading-snug tracking-[0.02em] text-muted">
                    {CATEGORY_LABELS[item.category] ?? item.category} · {place}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="-mr-2 -mt-1.5 inline-flex min-h-11 shrink-0 items-center px-2 font-mono text-[11px] text-muted hover:text-foreground md:min-h-8"
                >
                  Close
                </button>
              </div>
              <ItemDetails item={item} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
