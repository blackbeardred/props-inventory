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

  const [locationsResult, itemsResult] = await Promise.all([
    supabase.from("locations").select("id, name").order("name"),
    locationId
      ? supabase
          .from("items")
          .select(itemColumns)
          .eq("location_id", locationId)
          .order("name")
      : supabase.from("items").select(itemColumns).order("name"),
  ]);

  const locations = (locationsResult.data ?? []) as unknown as {
    id: string;
    name: string;
  }[];
  const items = (itemsResult.data ?? []) as unknown as ItemListRow[];
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
        <DataTable columns={["Photo", "Item", "Category", "Qty", "Condition", "Location", ""]}>
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
