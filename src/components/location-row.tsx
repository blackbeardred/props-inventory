"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/inventory";

const PREVIEW_COUNT = 5;

export type LocationItem = {
  id: string;
  name: string;
  created_at: string;
};

export type LocationRowData = {
  id: string;
  name: string;
  description: string | null;
  depth: number;
  parentName: string | null;
  created_at: string;
  /** Ids of every location above this one, outermost first. */
  ancestorIds: string[];
  childCount: number;
  /** Items in the boxes inside this one, however deep. */
  descendantItemCount: number;
};

/**
 * A row on the locations list, which can open to show what's actually in
 * that box — newest first, because the thing you just put somewhere is the
 * thing you're most likely looking for. Five at a time, since the point is a
 * glance rather than a full inventory; the whole list is one click away
 * either way.
 *
 * Renders two table rows (the location, and its opened panel), which is why
 * this is a component rather than markup in the page.
 */
export function LocationRow({
  row,
  items,
  columnCount,
  expanded,
  onToggleChildren,
}: {
  row: LocationRowData;
  items: LocationItem[];
  columnCount: number;
  /** Whether this location's contents are showing. Undefined = no children. */
  expanded?: boolean;
  onToggleChildren?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const shown = showAll ? items : items.slice(0, PREVIEW_COUNT);
  const remaining = items.length - shown.length;

  return (
    <>
      <tr className="border-b border-rule align-top">
        <td className="px-3 py-3">
          <div
            className="flex items-start gap-1.5"
            style={{ paddingLeft: `${row.depth * 1.25}rem` }}
          >
            {row.childCount > 0 ? (
              // The focus ring goes on this wrapper rather than on the button:
              // a clip-path clips the element's own outline too, so a focused
              // hexagon would draw a ring and then cut it off. Same reason as
              // the cell button on an item card.
              <span className="mt-[2px] inline-flex shrink-0 rounded-[2px] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
                <button
                  type="button"
                  data-hex-toggle
                  onClick={onToggleChildren}
                  aria-expanded={expanded ?? false}
                  aria-label={`${expanded ? "Hide" : "Show"} what's inside ${row.name}`}
                  // Honey when shut, ink when open — the same two states the
                  // cell button on an item card uses, so the hexagon-shaped
                  // control means one thing wherever it turns up. Open/shut
                  // rides on the colour rather than on the angle, which leaves
                  // the turn free to answer the pointer.
                  //
                  // 90°, not 30°: a hexagon maps onto itself every 60°, so both
                  // land on the same silhouette, and the longer sweep reads as
                  // a turn rather than a twitch.
                  // transition-[rotate,…], not transition-[transform,…]: Tailwind v4
                  // compiles rotate-90 to the standalone `rotate` property, and
                  // a transition on `transform` does not touch it — the turn
                  // was snapping rather than sweeping.
                  className={`hex h-[15px] w-[13px] cursor-pointer border-0 p-0 outline-none transition-[rotate,background-color] duration-200 ease-out hover:rotate-90 focus-visible:rotate-90 ${
                    expanded ? "bg-foreground" : "bg-honey"
                  }`}
                />
              </span>
            ) : (
              // Keeps leaf names aligned with the ones that have a control.
              <span aria-hidden="true" className="mt-0.5 w-[13px] shrink-0" />
            )}
            <div>
            <span className="font-body text-sm text-foreground">
              {row.name}
            </span>
            {row.description ? (
              <p className="mt-0.5 line-clamp-1 font-body text-xs text-muted">
                {row.description}
              </p>
            ) : null}
            {row.childCount > 0 && !expanded ? (
              <p className="mt-0.5 font-body text-xs text-muted">
                {row.childCount} {row.childCount === 1 ? "container" : "containers"} inside
              </p>
            ) : null}
            </div>
          </div>
        </td>
        <td className="px-3 py-3 font-body text-sm text-muted">
          {row.parentName ?? "—"}
        </td>
        <td className="px-3 py-3 font-body text-sm">
          <Link
            href={`/items?location=${row.id}`}
            className="text-muted underline-offset-2 hover:text-foreground hover:underline"
          >
            {items.length}
          </Link>
          {row.descendantItemCount > 0 ? (
            // Otherwise a room reads as empty while holding six full boxes.
            <span className="block font-body text-xs text-muted">
              +{row.descendantItemCount} inside
            </span>
          ) : null}
        </td>
        <td className="px-3 py-3 font-body text-sm text-muted">
          {formatDate(row.created_at)}
        </td>
        <td className="px-3 py-3 text-right font-body text-sm">
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              aria-expanded={open}
              disabled={items.length === 0}
              className="text-accent underline-offset-2 transition-colors hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
            >
              {open ? "Hide" : "View"}
            </button>
            <Link
              href={`/locations/${row.id}/edit`}
              className="text-muted underline-offset-2 hover:text-foreground hover:underline"
            >
              Edit
            </Link>
          </div>
        </td>
      </tr>

      {open ? (
        <tr className="border-b border-rule bg-surface">
          <td colSpan={columnCount} className="px-3 py-3">
            <div style={{ paddingLeft: `${row.depth * 1.25 + 0.5}rem` }}>
              <p className="font-body text-xs uppercase tracking-wide text-muted">
                Most recently added
              </p>

              <ul className="mt-2 space-y-1">
                {shown.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/items/${item.id}/edit`}
                      className="group flex flex-wrap items-baseline gap-x-2 font-body text-sm"
                    >
                      <span className="text-foreground underline-offset-2 group-hover:underline">
                        {item.name}
                      </span>
                      <span className="font-body text-xs text-muted">
                        added {formatDate(item.created_at)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>

              {remaining > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="mt-3 inline-flex items-center justify-center rounded-md border border-rule px-3 py-1.5 font-body text-sm font-medium text-foreground transition-colors hover:bg-background"
                >
                  Show {remaining} more
                </button>
              ) : null}

              {showAll && items.length > PREVIEW_COUNT ? (
                <button
                  type="button"
                  onClick={() => setShowAll(false)}
                  className="mt-3 inline-flex items-center justify-center rounded-md border border-rule px-3 py-1.5 font-body text-sm font-medium text-muted transition-colors hover:text-foreground"
                >
                  Show fewer
                </button>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
