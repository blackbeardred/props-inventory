import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import {
  DataTable,
  EmptyState,
  Notice,
  PageHeading,
} from "@/components/ui";
import { pluralize, type LocationRow } from "@/lib/inventory";
import type { LocationItem } from "@/components/location-row";
import { LocationTree } from "@/components/location-tree";

export const metadata: Metadata = {
  title: "Locations · Props & Costume Inventory",
};

type LocationListRow = LocationRow & {
  depth: number;
  parentName: string | null;
  itemCount: number;
  ancestorIds: string[];
  childCount: number;
  descendantItemCount: number;
};

/**
 * Flatten the self-referencing `locations` tree into display order:
 * each row carries its nesting `depth` and its parent's name. Rows whose
 * parent is missing (cleared, or hidden by row-level security) fall back
 * to the top level. Guards against cycles.
 */
function toListRows(
  rows: LocationRow[],
  itemCounts: Map<string, number>,
): LocationListRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));

  const ancestry = (row: LocationRow): LocationRow[] => {
    const path: LocationRow[] = [];
    const seen = new Set<string>();
    let current: LocationRow | undefined = row;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      path.unshift(current);
      current = current.parent_location_id
        ? byId.get(current.parent_location_id)
        : undefined;
    }
    return path;
  };

  const childCounts = new Map<string, number>();
  for (const row of rows) {
    if (!row.parent_location_id) continue;
    childCounts.set(
      row.parent_location_id,
      (childCounts.get(row.parent_location_id) ?? 0) + 1
    );
  }

  // Items held anywhere below a location, so a closed room can say what's in
  // it rather than reading as empty.
  const descendantItemCounts = new Map<string, number>();
  for (const row of rows) {
    const own = itemCounts.get(row.id) ?? 0;
    if (own === 0) continue;
    for (const ancestor of ancestry(row).slice(0, -1)) {
      descendantItemCounts.set(
        ancestor.id,
        (descendantItemCounts.get(ancestor.id) ?? 0) + own
      );
    }
  }

  return rows
    .map((row) => {
      const path = ancestry(row);
      const parent = row.parent_location_id
        ? (byId.get(row.parent_location_id) ?? null)
        : null;
      return {
        row: {
          ...row,
          depth: path.length - 1,
          parentName: parent?.name ?? null,
          itemCount: itemCounts.get(row.id) ?? 0,
          ancestorIds: path.slice(0, -1).map((entry) => entry.id),
          childCount: childCounts.get(row.id) ?? 0,
          descendantItemCount: descendantItemCounts.get(row.id) ?? 0,
        } satisfies LocationListRow,
        sortKey: path.map((p) => p.name.toLocaleLowerCase()).join(" / "),
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map((entry) => entry.row);
}

export default async function LocationsPage() {
  if (!supabaseConfigured) {
    return (
      <>
        <PageHeading
          title="Locations"
          intro="Storage rooms, racks, shelves, and bins — nested however your space is organized."
        />
        <Notice title="Connect Supabase to load your locations">
          Copy <code>.env.local.example</code> to <code>.env.local</code> and add
          your project URL and anon key (Day 1, step 3), then reload.
        </Notice>
      </>
    );
  }

  const supabase = await createClient();

  const [locationsResult, itemLocationsResult] = await Promise.all([
    supabase
      .from("locations")
      .select("id, name, description, parent_location_id, created_at")
      .order("name"),
    // Newest first, so a location opens on what was just put in it.
    supabase
      .from("items")
      .select("id, name, location_id, created_at")
      .order("created_at", { ascending: false }),
  ]);

  const itemsByLocation = new Map<string, LocationItem[]>();
  for (const item of (itemLocationsResult.data ?? []) as unknown as {
    id: string;
    name: string;
    location_id: string | null;
    created_at: string;
  }[]) {
    if (!item.location_id) continue;
    const list = itemsByLocation.get(item.location_id);
    const entry = { id: item.id, name: item.name, created_at: item.created_at };
    if (list) {
      list.push(entry);
    } else {
      itemsByLocation.set(item.location_id, [entry]);
    }
  }

  const itemCounts = new Map<string, number>(
    [...itemsByLocation].map(([locationId, items]) => [locationId, items.length])
  );

  const rows = toListRows(
    (locationsResult.data ?? []) as unknown as LocationRow[],
    itemCounts,
  );

  return (
    <>
      <PageHeading
        title="Locations"
        intro={
          rows.length > 0
            ? `${pluralize(rows.length, "location")} across your storage.`
            : "Storage rooms, racks, shelves, and bins — nested however your space is organized."
        }
        action={
          <div className="flex items-center gap-2">
            {rows.length > 0 ? (
              <Link
                href="/locations/labels"
                className="inline-flex min-h-11 items-center justify-center rounded-md md:min-h-0 border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface"
              >
                Print labels
              </Link>
            ) : null}
            <Link
              href="/locations/new"
              className="inline-flex min-h-11 items-center justify-center rounded-md md:min-h-0 bg-accent px-4 py-2 font-body text-sm font-medium text-background transition-colors hover:opacity-90"
            >
              Add location
            </Link>
          </div>
        }
      />

      {locationsResult.error ? (
        <Notice title="Couldn’t load locations">
          {locationsResult.error.message}
        </Notice>
      ) : rows.length === 0 ? (
        <EmptyState title="No locations yet">
          Add your first room, rack, shelf, or bin with the{" "}
          <Link href="/locations/new" className="text-accent hover:underline">
            Add location
          </Link>{" "}
          button above.
        </EmptyState>
      ) : (
        // "Within" and "Added" go on a phone: the indentation already shows
        // what's inside what, and with them the table scrolled sideways and
        // put View and Edit off the edge of the screen.
        <DataTable columns={["Location", "Within", "Items", "Added", ""]} phoneHidden={[1, 3]}>
          <LocationTree
            rows={rows}
            itemsByLocation={Object.fromEntries(itemsByLocation)}
            columnCount={5}
          />
        </DataTable>
      )}
    </>
  );
}
