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
import { formatDate, pluralize, type LocationRow } from "@/lib/inventory";

export const metadata: Metadata = {
  title: "Locations · Props & Costume Inventory",
};

type LocationListRow = LocationRow & {
  depth: number;
  parentName: string | null;
  itemCount: number;
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
    supabase.from("items").select("location_id"),
  ]);

  const itemCounts = new Map<string, number>();
  for (const item of (itemLocationsResult.data ?? []) as unknown as {
    location_id: string | null;
  }[]) {
    if (item.location_id) {
      itemCounts.set(
        item.location_id,
        (itemCounts.get(item.location_id) ?? 0) + 1,
      );
    }
  }

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
          <Link
            href="/locations/new"
            className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 font-body text-sm font-medium text-background transition-colors hover:opacity-90"
          >
            Add location
          </Link>
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
        <DataTable columns={["Location", "Within", "Items", "Added", ""]}>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-rule align-top">
              <td className="px-3 py-3">
                <div style={{ paddingLeft: `${row.depth * 1.25}rem` }}>
                  <span className="font-body text-sm text-foreground">
                    {row.depth > 0 ? (
                      <span className="text-muted">└ </span>
                    ) : null}
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
                  {row.itemCount}
                </Link>
              </td>
              <td className="px-3 py-3 font-body text-sm text-muted">
                {formatDate(row.created_at)}
              </td>
              <td className="px-3 py-3 font-body text-sm text-right">
                <Link
                  href={`/locations/${row.id}/edit`}
                  className="text-muted underline-offset-2 hover:text-foreground hover:underline"
                >
                  Edit
                </Link>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
