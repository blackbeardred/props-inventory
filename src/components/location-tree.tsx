"use client";

import { useState } from "react";
import {
  LocationRow,
  type LocationItem,
  type LocationRowData,
} from "@/components/location-row";

/**
 * The locations list as something you drill into. Rooms start closed, so the
 * page opens on the handful of places that exist rather than every bin in
 * the building, and you open a room to see the containers inside it.
 *
 * Expansion lives here rather than on each row because closing a room has to
 * hide everything beneath it, however deep — which no single row can know.
 */
export function LocationTree({
  rows,
  itemsByLocation,
  columnCount,
}: {
  rows: LocationRowData[];
  itemsByLocation: Record<string, LocationItem[]>;
  columnCount: number;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const parents = rows.filter((row) => row.childCount > 0);
  const allOpen = parents.length > 0 && parents.every((row) => expanded.has(row.id));

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // A row shows only when every location above it is open.
  const visible = rows.filter((row) =>
    row.ancestorIds.every((ancestorId) => expanded.has(ancestorId))
  );

  return (
    <>
      {parents.length > 0 ? (
        <tr>
          <td colSpan={columnCount} className="px-3 pb-2 pt-1">
            <button
              type="button"
              onClick={() =>
                setExpanded(allOpen ? new Set() : new Set(parents.map((row) => row.id)))
              }
              className="inline-flex min-h-11 items-center font-body text-xs text-muted underline-offset-2 transition-colors hover:text-foreground hover:underline md:min-h-0"
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          </td>
        </tr>
      ) : null}

      {visible.map((row) => (
        <LocationRow
          key={row.id}
          row={row}
          items={itemsByLocation[row.id] ?? []}
          columnCount={columnCount}
          expanded={row.childCount > 0 ? expanded.has(row.id) : undefined}
          onToggleChildren={() => toggle(row.id)}
        />
      ))}
    </>
  );
}
