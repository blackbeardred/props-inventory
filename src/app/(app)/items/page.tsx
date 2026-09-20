import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import {
  Badge,
  DataTable,
  EmptyState,
  Notice,
  PageHeading,
} from "@/components/ui";
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  formatDateRange,
  pluralize,
  type ItemRow,
} from "@/lib/inventory";
import { PHOTOS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/supabase/storage";

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

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ItemsPage({ searchParams }: ItemsPageProps) {
  const locationId = first((await searchParams).location);

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
          <Link
            href="/items/new"
            className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 font-body text-sm font-medium text-background transition-colors hover:opacity-90"
          >
            Add item
          </Link>
        }
      />

      {locations.length > 0 ? (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <FilterChip href="/items" active={!locationId}>
            All items
          </FilterChip>
          {locations.map((location) => (
            <FilterChip
              key={location.id}
              href={`/items?location=${location.id}`}
              active={location.id === locationId}
            >
              {location.name}
            </FilterChip>
          ))}
        </div>
      ) : null}

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
      ) : (
        <DataTable columns={["Photo", "Item", "Category", "Qty", "In use", "Condition", "Location", ""]}>
          {items.map((item) => {
            const photoUrl = item.photo_url
              ? photoUrlByPath.get(item.photo_url)
              : undefined;
            return (
              <tr key={item.id} className="border-b border-rule align-top">
                <td className="px-3 py-3">
                  {photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived and per-request, not worth Next/Image's remote-pattern config for a Day 4 thumbnail.
                    <img
                      src={photoUrl}
                      alt=""
                      className="h-10 w-10 rounded object-cover"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded border border-dashed border-rule" />
                  )}
                </td>
                <td className="px-3 py-3">
                  <span className="font-body text-sm text-foreground">
                    {item.name}
                  </span>
                  {item.description ? (
                    <p className="mt-0.5 line-clamp-1 font-body text-xs text-muted">
                      {item.description}
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  <Badge tone={item.category === "costume" ? "accent" : "neutral"}>
                    {CATEGORY_LABELS[item.category] ?? item.category}
                  </Badge>
                </td>
                <td className="px-3 py-3 font-body text-sm text-muted">
                  {item.quantity}
                </td>
                <td className="px-3 py-3 font-body text-sm">
                  <InUseCell item={item} inUse={inUseByItem.get(item.id)} />
                </td>
                <td className="px-3 py-3">
                  {item.condition ? (
                    <Badge tone={item.condition === "needs_repair" ? "accent" : "muted"}>
                      {CONDITION_LABELS[item.condition] ?? item.condition}
                    </Badge>
                  ) : (
                    <span className="font-body text-sm text-muted">—</span>
                  )}
                </td>
                <td className="px-3 py-3 font-body text-sm">
                  {item.location_id ? (
                    <Link
                      href={`/items?location=${item.location_id}`}
                      className="text-muted underline-offset-2 hover:text-foreground hover:underline"
                    >
                      {item.locations?.name ?? "Unknown location"}
                    </Link>
                  ) : (
                    <span className="text-muted">Unassigned</span>
                  )}
                </td>
                <td className="px-3 py-3 font-body text-sm text-right">
                  <Link
                    href={`/items/${item.id}/edit`}
                    className="text-muted underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </>
  );
}

/**
 * "In use" cell (Day 12). Quiet dash when the item isn't currently pulled
 * for anything. Otherwise: a bare quantity-1 item just says it's in use
 * (saying "1/1 in use" would be noise), while an item with more than one on
 * hand shows the fraction pulled vs. total, so staff can tell at a glance
 * whether every copy is out or just some of them.
 */
function InUseCell({
  item,
  inUse,
}: {
  item: ItemRow;
  inUse: InUseInfo | undefined;
}) {
  if (!inUse) {
    return <span className="text-muted">—</span>;
  }

  const { production, quantityInUse } = inUse;

  return (
    <span className="text-foreground">
      {item.quantity > 1 ? `${quantityInUse}/${item.quantity} in use in ` : "In use in "}
      <Link
        href={`/productions/${production.id}`}
        className="text-accent hover:underline"
      >
        {production.name}
      </Link>{" "}
      <span className="text-muted">
        from {formatDateRange(production.start_date, production.end_date)}
      </span>
    </span>
  );
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
