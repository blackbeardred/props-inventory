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
}: {
  row: LocationRowData;
  items: LocationItem[];
  columnCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const shown = showAll ? items : items.slice(0, PREVIEW_COUNT);
  const remaining = items.length - shown.length;

  return (
    <>
      <tr className="border-b border-rule align-top">
        <td className="px-3 py-3">
          <div style={{ paddingLeft: `${row.depth * 1.25}rem` }}>
            <span className="font-body text-sm text-foreground">
              {row.depth > 0 ? <span className="text-muted">└ </span> : null}
              {row.name}
            </span>
            {row.description ? (
              <p className="mt-0.5 line-clamp-1 font-body text-xs text-muted">
                {row.description}
              </p>
            ) : null}
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
