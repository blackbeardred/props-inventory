import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { RememberView } from "@/components/remember-view";
import { ITEMS_VIEW_COOKIE } from "@/lib/items-view";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { EmptyState, Notice, PageHeading } from "@/components/ui";
import { pluralize, type ItemRow } from "@/lib/inventory";
import { PHOTOS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/supabase/storage";
import { ItemTile, ViewTab } from "@/components/item-tile";
import { ItemCell, type ItemCellData } from "@/components/item-cell";
import { locationPaths, type LocationNode } from "@/lib/locations";
import { SearchBar } from "../search/search-bar";
import { searchItemsLive } from "../search/actions";

/*
 * Inventory: what used to be three pages — Items, Locations and Search —
 * because they were three ways into the same list.
 *
 * You walk in like folders. The top shows the rooms; open one and its
 * shelves and boxes are tiles at the top, with a breadcrumb back up, and
 * beneath them the items: everything inside this place by default, or only
 * what's loose here. The search box searches inside wherever you are.
 * Adding, editing and labelling locations happens from the place itself,
 * which is where the question comes up.
 *
 * URL: ?place=<id> (where you are), ?only=here (loose items only), ?view=
 * grid|list, and ?q= / ?locations= for a search, so any of it can be
 * bookmarked or sent.
 */

/**
 * The location and everything nested inside it. Choosing a room means the
 * room's boxes too; the old exact-match filter showed only what was loose on
 * the floor. Walked breadth-first with a seen-set, because the column is a
 * nullable self-reference and a cycle isn't impossible.
 */
function withDescendants(rootId: string, nodes: LocationNode[]): string[] {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parent_location_id) continue;
    const list = children.get(node.parent_location_id) ?? [];
    list.push(node.id);
    children.set(node.parent_location_id, list);
  }
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const child of children.get(id) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        queue.push(child);
      }
    }
  }
  return [...seen];
}

export const metadata: Metadata = {
  title: "Inventory · Props & Costume Inventory",
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

type InventoryPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Builds an /inventory link, keeping only what's asked for. */
function inventoryHref({
  place,
  only,
  view,
}: {
  place?: string | null;
  only?: boolean;
  view?: "list" | "grid";
}): string {
  const params = new URLSearchParams();
  if (place) params.set("place", place);
  if (only) params.set("only", "here");
  if (view) params.set("view", view);
  const query = params.toString();
  return query ? `/inventory?${query}` : "/inventory";
}

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface md:min-h-0";
/** A breadcrumb step: thumb-sized on a phone, plain text from tablet up. */
const CRUMB =
  "inline-flex min-h-11 items-center text-accent-ink hover:underline md:min-h-0";
/** The same button, but only from tablet width up: on a phone the hexagon
 *  menu and the desk are where these jobs get done. */
const DESK_BUTTON = BUTTON.replace("inline-flex", "hidden md:inline-flex");
const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 py-2 font-body text-sm font-medium text-background transition-colors hover:opacity-90 md:min-h-0";

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const params = await searchParams;
  // ?location= is what the old Items page used; still honoured so old links work.
  const placeId = first(params.place) ?? first(params.location) ?? null;
  const onlyHere = first(params.only) === "here";
  const initialText = first(params.q)?.trim() ?? "";
  const chipIds = (first(params.locations) ?? "").split(",").filter(Boolean);

  // Set by the spreadsheet import on its way back here.
  const importedCount = Number.parseInt(first(params.imported) ?? "", 10);
  const skippedCount = Number.parseInt(first(params.skipped) ?? "", 10);
  const locationsCreated = Number.parseInt(first(params.newPlaces) ?? "", 10);
  const unmatchedLocations = Number.parseInt(first(params.unmatched) ?? "", 10);
  const photosFetched = Number.parseInt(first(params.photos) ?? "", 10);
  const photosFailed = Number.parseInt(first(params.photosFailed) ?? "", 10);

  if (!supabaseConfigured) {
    return (
      <>
        <PageHeading title="Inventory" intro="Every prop and costume, and where it lives." />
        <Notice title="Connect Supabase to load your inventory">
          Copy <code>.env.local.example</code> to <code>.env.local</code> and add
          your project URL and anon key, then reload.
        </Notice>
      </>
    );
  }

  const supabase = await createClient();

  const itemColumns =
    "id, name, category, description, photo_url, quantity, condition, location_id, created_at, locations(name)";

  const [locationsResult, placementResult] = await Promise.all([
    supabase.from("locations").select("id, name, parent_location_id").order("name"),
    // Just where every item is, for the counts on the tiles.
    supabase.from("items").select("location_id"),
  ]);
  const locations = (locationsResult.data ?? []) as unknown as LocationNode[];
  const pathById = locationPaths(locations);
  const byId = new Map(locations.map((location) => [location.id, location]));
  const place = placeId ? (byId.get(placeId) ?? null) : null;
  const unknownPlace = Boolean(placeId) && !place;

  // The trail from the top down to here, for the breadcrumb. Guarded against
  // a cycle the same way the tree builder is.
  const trail: LocationNode[] = [];
  {
    const seen = new Set<string>();
    let cursor = place;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      trail.unshift(cursor);
      cursor = cursor.parent_location_id ? (byId.get(cursor.parent_location_id) ?? null) : null;
    }
  }

  // The places one level down from here, each with how much is inside it.
  const placements = ((placementResult.data ?? []) as { location_id: string | null }[]).map(
    (row) => row.location_id
  );
  const children = locations.filter((location) =>
    place ? location.parent_location_id === place.id : !location.parent_location_id || !byId.has(location.parent_location_id)
  );
  const tiles = children.map((child) => {
    const inside = new Set(withDescendants(child.id, locations));
    return {
      id: child.id,
      name: child.name,
      itemCount: placements.filter((id) => id !== null && inside.has(id)).length,
      placeCount: inside.size - 1,
    };
  });

  const everywhereIds = place ? withDescendants(place.id, locations) : null;
  const looseCount = placements.filter((id) => (place ? id === place.id : id === null)).length;
  const insideCount = everywhereIds
    ? placements.filter((id) => id !== null && everywhereIds.includes(id)).length
    : placements.length;

  let itemsQuery = supabase.from("items").select(itemColumns).order("name");
  if (onlyHere) {
    itemsQuery = place ? itemsQuery.eq("location_id", place.id) : itemsQuery.is("location_id", null);
  } else if (everywhereIds) {
    itemsQuery = itemsQuery.in("location_id", everywhereIds);
  }

  const hasSearch = Boolean(initialText) || chipIds.length > 0;
  const [itemsResult, pulledResult, initialSearch] = await Promise.all([
    itemsQuery,
    // "In use" (Day 12) — every currently-pulled pull-list row, with its
    // production. RLS on pull_list_items already scopes this to the
    // caller's org, same as the items/locations queries above.
    supabase
      .from("pull_list_items")
      .select("item_id, quantity_needed, pull_lists(productions(id, name, start_date, end_date))")
      .eq("status", "pulled"),
    // A search in the URL runs on the server, so a shared or bookmarked
    // search shows its results at once.
    hasSearch
      ? searchItemsLive(initialText, chipIds.length > 0 ? chipIds : place ? [place.id] : [])
      : Promise.resolve({ items: [], error: null }),
  ]);

  const items = (itemsResult.data ?? []) as unknown as ItemListRow[];
  const inUseByItem = buildInUseMap((pulledResult.data ?? []) as unknown as PulledItemRow[]);

  // The chosen view rides in the URL, so a link to "the shelf, as pictures"
  // is a link someone can send. With no view in the URL it's whichever this
  // browser used last, from a cookie so the server renders it first time.
  const viewParam = first(params.view);
  const rememberedView = (await cookies()).get(ITEMS_VIEW_COOKIE)?.value;
  const view =
    viewParam === "grid" || viewParam === "list"
      ? viewParam
      : rememberedView === "grid"
        ? "grid"
        : "list";

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

  const here = place?.id ?? null;

  // The last tile in the row: add a place right where you're standing.
  const addTile = (
    <li className="w-40 shrink-0 snap-start md:w-auto">
      <Link
        href={here ? `/locations/new?parent=${here}` : "/locations/new"}
        className="flex min-h-16 items-center gap-2 rounded-lg border border-dashed border-rule px-3 py-2.5 font-body text-sm text-accent-ink transition-colors hover:border-accent-soft hover:bg-surface"
      >
        <span aria-hidden="true">+</span>
        {here ? "Add a shelf or box" : "Add a room"}
      </Link>
    </li>
  );

  const browse = (
    <div className="space-y-6">
      {/* The places one level down: tiles you walk into. A row that scrolls
          sideways on a phone, so thirteen rooms don't push the first item
          off the screen; a wrapping grid from md up. */}
      {tiles.length > 0 ? (
        <section aria-label={place ? `Inside ${place.name}` : "Rooms"}>
          <ul aria-label="Places in here" className="-mx-6 flex snap-x scroll-px-6 gap-2.5 overflow-x-auto px-6 pb-1 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 lg:grid-cols-4 xl:grid-cols-5">
            {tiles.map((tile) => (
              <li key={tile.id} className="w-40 shrink-0 snap-start md:w-auto">
                <Link
                  href={inventoryHref({ place: tile.id, view: viewParam ? view : undefined })}
                  className="group flex min-h-16 items-start gap-2.5 rounded-lg border border-rule bg-surface px-3 py-2.5 transition-colors hover:border-accent-soft"
                >
                  <span
                    aria-hidden="true"
                    data-hex-toggle
                    className="hex mt-1 w-4 shrink-0 bg-honey transition-[rotate] duration-200 group-hover:rotate-90"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-body text-sm font-medium text-foreground">
                      {tile.name}
                    </span>
                    <span className="block font-mono text-[11px] text-muted">
                      {pluralize(tile.itemCount, "item")}
                      {tile.placeCount > 0 ? ` · ${tile.placeCount} inside` : ""}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
            {addTile}
          </ul>
        </section>
      ) : (
        <ul className="flex">{addTile}</ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Everything inside this place, or only what's loose in it — the
            first is what you want when looking for something, the second
            when tidying a shelf. */}
        <div className="flex items-center gap-1 rounded-md border border-rule p-0.5" role="group" aria-label="Which items">
          <ViewTab href={inventoryHref({ place: here, view: viewParam ? view : undefined })} active={!onlyHere}>
            All {insideCount}
          </ViewTab>
          <ViewTab href={inventoryHref({ place: here, only: true, view: viewParam ? view : undefined })} active={onlyHere}>
            {place ? `Loose here ${looseCount}` : `Not filed ${looseCount}`}
          </ViewTab>
        </div>

        {items.length > 0 ? (
          <div className="flex items-center gap-1 rounded-md border border-rule p-0.5">
            <RememberView view={view} />
            <ViewTab href={inventoryHref({ place: here, only: onlyHere, view: "list" })} active={view === "list"}>
              List
            </ViewTab>
            <ViewTab href={inventoryHref({ place: here, only: onlyHere, view: "grid" })} active={view === "grid"}>
              Grid
            </ViewTab>
          </div>
        ) : null}
      </div>

      {itemsResult.error ? (
        <Notice title="Couldn’t load items">{itemsResult.error.message}</Notice>
      ) : items.length === 0 ? (
        <EmptyState
          title={
            onlyHere
              ? place
                ? `Nothing loose in ${place.name}`
                : "Everything is filed somewhere"
              : place
                ? `Nothing stored in ${place.name} yet`
                : "No items yet"
          }
        >
          {onlyHere && tiles.length > 0
            ? "Whatever is here is in the places above."
            : (
              <>
                Add one with the{" "}
                <Link href={here ? `/items/new?location=${here}` : "/items/new"} className="text-accent hover:underline">
                  Add item
                </Link>{" "}
                button.
              </>
            )}
        </EmptyState>
      ) : view === "grid" ? (
        /* Pictures first. Names in a props store are approximate — "the small
           urn", "the good candlestick" — so a wall of photographs is often
           the faster way to find a thing than a column of text. Dense, so
           an opened tile taking a whole row doesn't leave a hole in the row
           it came from: the tiles after it close the gap. */
        <ul className="grid grid-flow-row-dense grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {items.map((item) => (
            <ItemTile
              key={item.id}
              item={toCellData(item, inUseByItem.get(item.id), photoUrlByPath, pathById)}
            />
          ))}
        </ul>
      ) : (
        /* One cell per item; columns from lg up (see Day 22). The column gap
           is wide enough for the hexagon, which sits half outside its card. */
        <ul className="grid items-start gap-x-6 gap-y-2.5 lg:grid-cols-2 2xl:grid-cols-3">
          {items.map((item) => (
            <ItemCell
              key={item.id}
              item={toCellData(item, inUseByItem.get(item.id), photoUrlByPath, pathById)}
            />
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <>
      <PageHeading
        title={place ? place.name : "Inventory"}
        intro={
          // The breadcrumb: where you are, and every step back up.
          place ? (
            <nav aria-label="Where you are" className="flex flex-wrap items-center gap-x-1.5">
              <Link href={inventoryHref({})} className={CRUMB}>
                Inventory
              </Link>
              {trail.slice(0, -1).map((step) => (
                <span key={step.id} className="flex items-center gap-1.5">
                  <span aria-hidden="true">›</span>
                  <Link href={inventoryHref({ place: step.id })} className={CRUMB}>
                    {step.name}
                  </Link>
                </span>
              ))}
              <span aria-hidden="true">›</span>
              <span aria-current="page">{place.name}</span>
              <span aria-hidden="true" className="text-rule">·</span>
              <Link href={`/locations/${place.id}/edit`} className={CRUMB}>
                Edit
              </Link>
            </nav>
          ) : (
            `${pluralize(placements.length, "item")} across ${pluralize(locations.length, "place")}.`
          )
        }
        action={
          // Labels, export and import are desk jobs — a printer, a
          // spreadsheet — so on a phone only Add item stays up here (the
          // hexagon menu has it too); from md up they're all in a row.
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/locations/labels" className={DESK_BUTTON}>
              Print labels
            </Link>
            <a
              href={here ? `/items/export?location=${here}` : "/items/export"}
              className={DESK_BUTTON}
            >
              Export
            </a>
            <Link href="/items/import" className={DESK_BUTTON}>
              Import spreadsheet
            </Link>
            <Link href={here ? `/items/new?location=${here}` : "/items/new"} className={PRIMARY}>
              {place ? "Add item here" : "Add item"}
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

      {unknownPlace ? (
        <div className="mb-6">
          <Notice title="That place isn’t in your inventory">
            It may have been removed.{" "}
            <Link className="text-accent hover:underline" href="/inventory">
              Back to everything
            </Link>
            .
          </Notice>
        </div>
      ) : null}

      <SearchBar
        locations={locations.map((location) => ({
          id: location.id,
          name: pathById.get(location.id) ?? location.name,
        }))}
        initialText={initialText}
        initialChips={locations
          .filter((location) => chipIds.includes(location.id))
          .map((location) => ({ id: location.id, name: location.name }))}
        initialItems={initialSearch.items}
        initialError={initialSearch.error}
        scope={place ? { id: place.id, name: place.name } : null}
        browse={browse}
      />
    </>
  );
}

/** The list row as the cell wants it: no Supabase embeds, no signed-URL map. */
function toCellData(
  item: ItemListRow,
  inUse: InUseInfo | undefined,
  photoUrlByPath: Map<string, string>,
  pathById: Map<string, string>,
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
    locationName: item.location_id
      ? (pathById.get(item.location_id) ?? item.locations?.name ?? null)
      : null,
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
