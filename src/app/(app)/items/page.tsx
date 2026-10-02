import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { EmptyState, Notice, PageHeading } from "@/components/ui";
import { pluralize, type ItemRow } from "@/lib/inventory";
import { PHOTOS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/supabase/storage";
import { ItemTile, ViewTab } from "@/components/item-tile";
import { ItemCell, type ItemCellData } from "@/components/item-cell";

export const metadata: Metadata = {
  title: "Items · Props & Costume Inventory",
};

// `location_id` is a to-one foreign key, so the embed comes back as a single
// object (or null) rather than an array.
type ItemListRow = ItemRow & { locations: { name: string } | null };

// "In use" (Day 12): an item is in use when it has a pull_list_item with
// status 'pulled' for some production. Pull-list rows embed their
// production two hops away (pull_list_items -> pull_lists -> productions),
// each a to-one foreign key, so both embeds come back as single objects.
type ProductionInfo = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
};

type PulledItemRow = {
  item_id: string;
  quantity_needed: number;
  pull_lists: { productions: ProductionInfo | null } | null;
};

// Which production an item's "in use" badge is shown against, and how many
// of it are pulled for that production specifically.
type InUseInfo = {
  production: ProductionInfo;
  quantityInUse: number;
};

/** Earliest start date first (nulls last), so a concurrent pull against two
 * productions at once resolves to a single, deterministic choice. */
function compareByStartDate(a: ProductionInfo, b: ProductionInfo): number {
  if (a.start_date && b.start_date) return a.start_date.localeCompare(b.start_date);
  if (a.start_date) return -1;
  if (b.start_date) return 1;
  return a.id.localeCompare(b.id);
}

/**
 * Builds a map of item id -> the production it's currently pulled for.
 * quantity_needed is summed per item *within a single production* — if the
 * same item is pulled for two productions at once (rare, e.g. overlapping
 * runs sharing a prop), only the earlier-starting production is shown here;
 * the other pull is real but not reflected in this list's "in use" text.
 */
function buildInUseMap(pulledRows: PulledItemRow[]): Map<string, InUseInfo> {
  const byItemAndProduction = new Map<
    string,
    { itemId: string; production: ProductionInfo; quantity: number }
  >();

  for (const row of pulledRows) {
    const production = row.pull_lists?.productions;
    if (!production) continue;
    const key = `${row.item_id}:${production.id}`;
    const existing = byItemAndProduction.get(key);
    if (existing) {
      existing.quantity += row.quantity_needed;
    } else {
      byItemAndProduction.set(key, {
        itemId: row.item_id,
        production,
        quantity: row.quantity_needed,
      });
    }
  }

  const inUseByItem = new Map<string, InUseInfo>();
  for (const group of byItemAndProduction.values()) {
    const current = inUseByItem.get(group.itemId);
    if (!current || compareByStartDate(group.production, current.production) < 0) {
      inUseByItem.set(group.itemId, {
        production: group.production,
        quantityInUse: group.quantity,
      });
    }
  }
  return inUseByItem;
}

// Next generates `PageProps<"/items">` once `next dev` / `next build` has run;
// spelling the shape out here keeps the file type-checkable on its own too.
type ItemsPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

/** Keeps the location filter and the chosen view from clobbering each other. */
function itemsHref({
  locationId,
  view,
}: {
  locationId?: string;
  view?: "list" | "grid";
}): string {
  const params = new URLSearchParams();
  if (locationId) params.set("location", locationId);
  if (view === "grid") params.set("view", "grid");
  const query = params.toString();
  return query ? `/items?${query}` : "/items";
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ItemsPage({ searchParams }: ItemsPageProps) {
  const params = await searchParams;
  const locationId = first(params.location);
  // Set by the CSV import on its way back here.
  const importedCount = Number.parseInt(first(params.imported) ?? "", 10);
  const skippedCount = Number.parseInt(first(params.skipped) ?? "", 10);
  const locationsCreated = Number.parseInt(first(params.locations) ?? "", 10);
  const unmatchedLocations = Number.parseInt(first(params.unmatched) ?? "", 10);
  const photosFetched = Number.parseInt(first(params.photos) ?? "", 10);
  const photosFailed = Number.parseInt(first(params.photosFailed) ?? "", 10);

  if (!supabaseConfigured) {
    return (
      <>
        <PageHeading
          title="Items"
          intro="Every prop and costume, with the shelf it lives on."
        />
        <Notice title="Connect Supabase to load your items">
          Copy <code>.env.local.example</code> to <code>.env.local</code> and add
          your project URL and anon key (Day 1, step 3), then reload.
        </Notice>
      </>
    );
  }

  const supabase = await createClient();

  const itemColumns =
    "id, name, category, description, photo_url, quantity, condition, location_id, created_at, locations(name)";

  const [locationsResult, itemsResult, pulledResult] = await Promise.all([
    supabase.from("locations").select("id, name").order("name"),
    locationId
      ? supabase
          .from("items")
          .select(itemColumns)
          .eq("location_id", locationId)
          .order("name")
      : supabase.from("items").select(itemColumns).order("name"),
    // "In use" (Day 12) — every currently-pulled pull-list row, with its
    // production. RLS on pull_list_items already scopes this to the
    // caller's org, same as the items/locations queries above.
    supabase
      .from("pull_list_items")
      .select("item_id, quantity_needed, pull_lists(productions(id, name, start_date, end_date))")
      .eq("status", "pulled"),
  ]);

  const locations = (locationsResult.data ?? []) as unknown as {
    id: string;
    name: string;
  }[];
  const items = (itemsResult.data ?? []) as unknown as ItemListRow[];
  const inUseByItem = buildInUseMap(
    (pulledResult.data ?? []) as unknown as PulledItemRow[]
  );
  // The chosen view rides in the URL rather than in the browser's storage, so
  // a link to "the shelf, as pictures" is a link someone can send.
  const view = first(params.view) === "grid" ? "grid" : "list";

  const activeLocation = locationId
    ? (locations.find((l) => l.id === locationId) ?? null)
    : null;
  const unknownLocation = Boolean(locationId) && !activeLocation;

  // Photos are stored in a private bucket, so render them via short-lived
  // signed URLs rather than a public link (Day 4).
  const photoPaths = items
    .map((item) => item.photo_url)
    .filter((path): path is string => Boolean(path));
  const photoUrlByPath = new Map<string, string>();
  if (photoPaths.length > 0) {
    const { data: signedUrls } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .createSignedUrls(photoPaths, SIGNED_URL_TTL_SECONDS);
    for (const entry of signedUrls ?? []) {
      if (entry.signedUrl && !entry.error) {
        photoUrlByPath.set(entry.path ?? "", entry.signedUrl);
      }
    }
  }

  return (
    <>
      <PageHeading
        title="Items"
        intro={
          activeLocation
            ? `${pluralize(items.length, "item")} in ${activeLocation.name}.`
            : items.length > 0
              ? `${pluralize(items.length, "item")} across every location.`
              : "Every prop and costume, with the shelf it lives on."
        }
        action={
          <div className="flex items-center gap-2">
            <a
              href={locationId ? `/items/export?location=${locationId}` : "/items/export"}
              className="inline-flex items-center justify-center rounded-md border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface"
            >
              Export
            </a>
            <Link
              href="/items/import"
              className="inline-flex items-center justify-center rounded-md border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface"
            >
              Import spreadsheet
            </Link>
            <Link
              href="/items/new"
              className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 font-body text-sm font-medium text-background transition-colors hover:opacity-90"
            >
              Add item
            </Link>
          </div>
        }
      />

      {Number.isFinite(importedCount) && importedCount > 0 ? (
        <div className="mb-6">
          <Notice
            title={`Imported ${importedCount.toLocaleString()} item${importedCount === 1 ? "" : "s"}`}
          >
            {[
              Number.isFinite(locationsCreated) && locationsCreated > 0
                ? `Created ${locationsCreated} new location${locationsCreated === 1 ? "" : "s"}.`
                : null,
              Number.isFinite(unmatchedLocations) && unmatchedLocations > 0
                ? `${unmatchedLocations} item${unmatchedLocations === 1 ? " came" : "s came"} in unassigned, because the location named in the file doesn’t exist.`
                : null,
              Number.isFinite(skippedCount) && skippedCount > 0
                ? `Skipped ${skippedCount} row${skippedCount === 1 ? "" : "s"} that couldn’t be read.`
                : null,
              Number.isFinite(photosFetched) && photosFetched > 0
                ? `Fetched ${photosFetched} photo${photosFetched === 1 ? "" : "s"}.`
                : null,
              Number.isFinite(photosFailed) && photosFailed > 0
                ? `${photosFailed} photo link${photosFailed === 1 ? " couldn’t" : "s couldn’t"} be fetched — those items came in without a picture.`
                : null,
            ]
              .filter(Boolean)
              .join(" ") || "Everything in the file came through."}
          </Notice>
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        {locations.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip href={itemsHref({ view })} active={!locationId}>
              All items
            </FilterChip>
            {locations.map((location) => (
              <FilterChip
                key={location.id}
                href={itemsHref({ locationId: location.id, view })}
                active={location.id === locationId}
              >
                {location.name}
              </FilterChip>
            ))}
          </div>
        ) : (
          <span />
        )}

        {items.length > 0 ? (
          <div className="flex items-center gap-1 rounded-md border border-rule p-0.5">
            <ViewTab href={itemsHref({ locationId })} active={view === "list"}>
              List
            </ViewTab>
            <ViewTab href={itemsHref({ locationId, view: "grid" })} active={view === "grid"}>
              Grid
            </ViewTab>
          </div>
        ) : null}
      </div>

      {itemsResult.error ? (
        <Notice title="Couldn’t load items">{itemsResult.error.message}</Notice>
      ) : unknownLocation ? (
        <Notice title="That location isn’t in your inventory">
          It may have been removed.{" "}
          <Link className="text-accent hover:underline" href="/items">
            Show all items
          </Link>
          .
        </Notice>
      ) : items.length === 0 ? (
        <EmptyState
          title={activeLocation ? `Nothing stored in ${activeLocation.name}` : "No items yet"}
        >
          {activeLocation ? (
            "Assign items to this location and they’ll appear here."
          ) : (
            <>
              Add your first prop or costume with the{" "}
              <Link href="/items/new" className="text-accent hover:underline">
                Add item
              </Link>{" "}
              button above.
            </>
          )}
        </EmptyState>
      ) : view === "grid" ? (
        /* Pictures first. Names in a props store are approximate — "the small
           urn", "the good candlestick" — so a wall of photographs is often
           the faster way to find a thing than a column of text. */
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {items.map((item) => (
            <ItemTile
              key={item.id}
              href={`/items/${item.id}/edit`}
              name={item.name}
              photoUrl={item.photo_url ? photoUrlByPath.get(item.photo_url) : undefined}
              locationName={item.location_id ? (item.locations?.name ?? "Unknown location") : null}
              quantity={item.quantity}
              inUseIn={inUseByItem.get(item.id)?.production.name}
            />
          ))}
        </ul>
      ) : (
        /* One cell per item, at every width.
           This replaced an eight-column table (desktop) plus a separate card
           list (phone) that had to be kept saying the same thing twice. A
           cell says the two things you need to find a prop — what it is and
           where it lives — and keeps the other six behind its hexagon, which
           is both the brand's motif and the honest shape of the problem: a
           props store is a few hundred things you scan past and one you open. */
        <ul className="space-y-2.5">
          {items.map((item) => (
            <ItemCell key={item.id} item={toCellData(item, inUseByItem.get(item.id), photoUrlByPath)} />
          ))}
        </ul>
      )}
    </>
  );
}

/** The list row as the cell wants it: no Supabase embeds, no signed-URL map. */
function toCellData(
  item: ItemListRow,
  inUse: InUseInfo | undefined,
  photoUrlByPath: Map<string, string>,
): ItemCellData {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    description: item.description,
    quantity: item.quantity,
    condition: item.condition,
    createdAt: item.created_at,
    locationId: item.location_id,
    locationName: item.locations?.name ?? null,
    photoUrl: item.photo_url ? photoUrlByPath.get(item.photo_url) : undefined,
    inUse: inUse
      ? {
          productionId: inUse.production.id,
          productionName: inUse.production.name,
          startDate: inUse.production.start_date,
          endDate: inUse.production.end_date,
          quantityInUse: inUse.quantityInUse,
        }
      : undefined,
  };
}

function FilterChip({
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
      className={`rounded-full border px-3 py-1 font-body text-xs transition-colors ${
        active
          ? "border-accent/40 text-accent"
          : "border-rule text-muted hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}
