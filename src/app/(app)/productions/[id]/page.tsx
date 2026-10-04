import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Badge,
  EmptyState,
  Notice,
  PageHeading,
  TextField,
} from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ItemPicker } from "@/components/item-picker";
import { DeleteButton } from "@/components/delete-button";
import { QuantityField } from "@/components/quantity-field";
import { locationPaths, type LocationNode } from "@/lib/locations";
import { PHOTOS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/supabase/storage";
import { createClient } from "@/lib/supabase/server";
import { findPullIssues } from "@/lib/checklist";
import { loadChecklistRows } from "@/lib/checklist-data";
import { supabaseConfigured } from "@/lib/supabase/config";
import {
  NEXT_PULL_LIST_ITEM_ACTION_LABEL,
  NEXT_PULL_LIST_ITEM_STATUS,
  PRODUCTION_STATUS_LABELS,
  PULL_LIST_ITEM_STATUS_LABELS,
  formatDateRange,
  type ProductionRow,
  type ProductionStatus,
  type PullListItemRow,
  type PullListRow,
} from "@/lib/inventory";
import {
  addPullListItem,
  createPullList,
  deletePullList,
  removePullListItem,
  updatePullListItemQuantity,
  updatePullListItemStatus,
} from "./actions";

export const metadata: Metadata = {
  title: "Production · Props & Costume Inventory",
};

const STATUS_TONE: Record<ProductionStatus, "neutral" | "muted" | "accent"> = {
  planning: "neutral",
  in_run: "accent",
  closed: "muted",
};

type ProductionDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

type PullListItemWithItem = PullListItemRow & {
  check_state?: "open" | "checked" | "cleared" | null;
  items: {
    name: string;
    category: string;
    photo_url: string | null;
    location_id: string | null;
  } | null;
};

export default async function ProductionDetailPage({
  params,
  searchParams,
}: ProductionDetailPageProps) {
  if (!supabaseConfigured) {
    redirect("/productions");
  }

  const { id } = await params;
  const error = first((await searchParams).error);
  const marked = Number(first((await searchParams).marked) ?? "");

  const supabase = await createClient();

  const [
    { data: production },
    { data: pullLists },
    { count: itemCount },
    { data: locationRows },
  ] =
    await Promise.all([
      supabase
        .from("productions")
        .select("id, name, status, start_date, end_date, created_at")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("pull_lists")
        .select("id, production_id, name, created_at")
        .eq("production_id", id)
        .order("created_at"),
      // Only whether there is anything to add: the picker searches for itself
      // rather than being handed every item in the inventory.
      supabase.from("items").select("id", { count: "exact", head: true }),
      // Locations, so the picker can offer them as chips the way the search
      // page does.
      supabase.from("locations").select("id, name, parent_location_id").order("name"),
    ]);

  if (!production) {
    return (
      <>
        <PageHeading title="Production not found" />
        <Notice title="This production isn’t available">
          It may have been deleted, or you may not have access to it.
        </Notice>
      </>
    );
  }

  const typedProduction = production as unknown as ProductionRow;
  const lists = (pullLists ?? []) as unknown as PullListRow[];

  const searchLocations = (locationRows ?? []) as unknown as LocationNode[];
  const pathById = locationPaths(searchLocations);

  const pullListIds = lists.map((list) => list.id);

  // The same rule the pull-issues page uses, so the badge and the page can't
  // disagree with each other.
  const { rows: checklistRows, locations: checklistLocations } = await loadChecklistRows(
    supabase,
    pullListIds
  );
  const issueCount = findPullIssues(checklistRows, checklistLocations).length;
  let itemsByPullList = new Map<string, PullListItemWithItem[]>();
  const photoUrlByPath = new Map<string, string>();
  if (pullListIds.length > 0) {
    const { data: pullListItems } = await supabase
      .from("pull_list_items")
      .select(
        "id, pull_list_id, item_id, quantity_needed, status, check_state, created_at, items(name, category, photo_url, location_id)"
      )
      .in("pull_list_id", pullListIds)
      .order("created_at");

    const rows = (pullListItems ?? []) as unknown as PullListItemWithItem[];

    // Each row's photo, signed in one request. The photo and where it lives
    // are the two things you need when pulling, and the row had neither.
    const paths = [
      ...new Set(
        rows.map((row) => row.items?.photo_url).filter((path): path is string => Boolean(path))
      ),
    ];
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
      for (const entry of signed ?? []) {
        if (entry.path && entry.signedUrl) photoUrlByPath.set(entry.path, entry.signedUrl);
      }
    }

    itemsByPullList = new Map();
    for (const row of rows) {
      const list = itemsByPullList.get(row.pull_list_id) ?? [];
      list.push(row);
      itemsByPullList.set(row.pull_list_id, list);
    }
  }

  return (
    <>
      <PageHeading
        title={typedProduction.name}
        intro={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[typedProduction.status] ?? "neutral"}>
              {PRODUCTION_STATUS_LABELS[typedProduction.status] ??
                typedProduction.status}
            </Badge>
            <span className="text-muted">
              {formatDateRange(
                typedProduction.start_date,
                typedProduction.end_date
              )}
            </span>
          </span>
        }
        action={
          <span className="flex flex-wrap gap-2">
            <Link
              href={`/productions/${typedProduction.id}/issues`}
              className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 font-body text-sm font-medium transition-colors ${
                issueCount > 0
                  ? "bg-danger/15 text-danger-ink hover:bg-danger/25"
                  : "border border-rule text-foreground hover:bg-surface"
              }`}
            >
              Pull issues
              {issueCount > 0 ? (
                <span className="rounded-full bg-danger-ink px-1.5 font-body text-xs text-background">
                  {issueCount}
                </span>
              ) : null}
            </Link>
            <Link
              href={`/productions/${typedProduction.id}/checklist`}
              className="inline-flex min-h-11 items-center justify-center rounded-md md:min-h-0 border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface"
            >
              Checklist
            </Link>
            <Link
              href={`/productions/${typedProduction.id}/photo`}
              className="inline-flex min-h-11 items-center justify-center rounded-md md:min-h-0 bg-accent px-4 py-2 font-body text-sm font-medium text-background transition-colors hover:opacity-90"
            >
              Mark from a photo
            </Link>
            <Link
              href={`/productions/${typedProduction.id}/edit`}
              className="inline-flex min-h-11 items-center justify-center rounded-md md:min-h-0 border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface"
            >
              Edit production
            </Link>
          </span>
        }
      />

      {error ? (
        <div className="mb-6">
          <Notice title="That didn’t go through">{error}</Notice>
        </div>
      ) : null}

      {Number.isFinite(marked) && marked > 0 ? (
        <div className="mb-6">
          <Notice title="Marked from your photo">
            {marked} item{marked === 1 ? "" : "s"} added to this production’s
            pull list.
          </Notice>
        </div>
      ) : null}

      {lists.length === 0 ? (
        <div className="mb-8">
          <EmptyState title="No pull lists yet">
            Start one below to begin pulling props and costumes for this
            production.
          </EmptyState>
        </div>
      ) : (
        lists.map((list) => {
          const listItems = itemsByPullList.get(list.id) ?? [];
          return (
            // Capped at a reading width: full-width on a desktop put each
            // item's name at the left edge and its buttons 1,000px away.
            <div
              key={list.id}
              className="mb-8 max-w-3xl rounded-lg border border-rule"
            >
              <div className="border-b border-rule px-5 py-3">
                <h2 className="font-display text-lg">{list.name}</h2>
              </div>

              <div className="px-5 py-4">
                {listItems.length === 0 ? (
                  <p className="font-body text-sm text-muted">
                    Nothing on this list yet.
                  </p>
                ) : (
                  <ul className="divide-y divide-rule">
                    {listItems.map((pullListItem) => {
                      const photoPath = pullListItem.items?.photo_url;
                      const photoUrl = photoPath ? photoUrlByPath.get(photoPath) : undefined;
                      const locationId = pullListItem.items?.location_id;
                      const where = locationId
                        ? (pathById.get(locationId) ?? "Unknown location")
                        : "Unassigned";
                      const notChecked =
                        pullListItem.status === "pulled" &&
                        (pullListItem.check_state ?? "open") === "open";
                      return (
                        <li
                          key={pullListItem.id}
                          className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
                        >
                          {/* What it is and where it lives, as on the checklist. */}
                          <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
                            {photoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- signed URL from a private bucket
                              <img
                                src={photoUrl}
                                alt=""
                                className="h-11 w-11 shrink-0 rounded object-cover"
                              />
                            ) : (
                              <div className="h-11 w-11 shrink-0 rounded border border-dashed border-rule" />
                            )}
                            <div className="min-w-0">
                              <p className="truncate font-body text-sm font-medium text-foreground">
                                {pullListItem.items?.name ?? "Unknown item"}
                              </p>
                              <p className="truncate font-mono text-[11px] text-muted">{where}</p>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <form action={updatePullListItemQuantity}>
                              <input type="hidden" name="productionId" value={typedProduction.id} />
                              <input type="hidden" name="pullListItemId" value={pullListItem.id} />
                              <QuantityField
                                name="quantityNeeded"
                                defaultValue={pullListItem.quantity_needed}
                                label={`How many ${pullListItem.items?.name ?? "of this item"}`}
                              />
                            </form>
                            <Badge
                              tone={
                                pullListItem.status === "pulled"
                                  ? "accent"
                                  : pullListItem.status === "returned"
                                    ? "muted"
                                    : "neutral"
                              }
                            >
                              {PULL_LIST_ITEM_STATUS_LABELS[pullListItem.status]}
                            </Badge>
                            {/* The checklist's NOT CHECKED, said here too, so the
                                two pages tell the same story: out of storage,
                                but nobody has confirmed it on the walk round. */}
                            {notChecked ? (
                              <Link
                                href={`/productions/${typedProduction.id}/checklist`}
                                className="inline-flex min-h-11 items-center font-body text-xs font-medium text-danger-ink hover:underline md:min-h-0"
                              >
                                not checked
                              </Link>
                            ) : null}
                            <form action={updatePullListItemStatus}>
                              <input type="hidden" name="productionId" value={typedProduction.id} />
                              <input type="hidden" name="pullListItemId" value={pullListItem.id} />
                              <input
                                type="hidden"
                                name="newStatus"
                                value={NEXT_PULL_LIST_ITEM_STATUS[pullListItem.status]}
                              />
                              <SubmitButton variant="ghost" pendingText="Saving…">
                                {NEXT_PULL_LIST_ITEM_ACTION_LABEL[pullListItem.status]}
                              </SubmitButton>
                            </form>
                            <form action={removePullListItem}>
                              <input type="hidden" name="productionId" value={typedProduction.id} />
                              <input type="hidden" name="pullListItemId" value={pullListItem.id} />
                              <DeleteButton
                                confirmMessage={`Remove "${pullListItem.items?.name ?? "this item"}" from the list?`}
                              >
                                Remove
                              </DeleteButton>
                            </form>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {(itemCount ?? 0) > 0 ? (
                  <form
                    action={addPullListItem}
                    className="mt-4 space-y-3 border-t border-rule pt-4"
                  >
                    <input type="hidden" name="productionId" value={typedProduction.id} />
                    <input type="hidden" name="pullListId" value={list.id} />
                    <div className="w-full">
                      <ItemPicker
                        locations={searchLocations}
                        alreadyListed={listItems.map((row) => row.item_id)}
                      />
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="w-24">
                        <TextField
                          label="Qty"
                          name="quantityNeeded"
                          type="number"
                          defaultValue="1"
                        />
                      </div>
                      <SubmitButton variant="ghost" pendingText="Adding…">
                        Add to list
                      </SubmitButton>
                    </div>
                  </form>
                ) : (
                  <p className="mt-4 border-t border-rule pt-4 font-body text-sm text-muted">
                    Add some items to your inventory before building a pull
                    list.
                  </p>
                )}
              </div>

              {/* At the foot of the list, not beside its title: the one
                  button that throws the whole list away shouldn't be the
                  first thing next to its name. */}
              <div className="flex justify-end border-t border-rule px-5 py-3">
                <form action={deletePullList}>
                  <input type="hidden" name="productionId" value={typedProduction.id} />
                  <input type="hidden" name="pullListId" value={list.id} />
                  <DeleteButton
                    confirmMessage={`Delete "${list.name}" and everything on it? This can’t be undone.`}
                  >
                    Delete this list
                  </DeleteButton>
                </form>
              </div>
            </div>
          );
        })
      )}

      <form
        action={createPullList}
        className="flex max-w-3xl flex-wrap items-end gap-3 rounded-lg border border-dashed border-rule px-5 py-4"
      >
        <input type="hidden" name="productionId" value={typedProduction.id} />
        <div className="w-full sm:w-64">
          <TextField label="New pull list name" name="name" defaultValue="Pull List" />
        </div>
        <SubmitButton pendingText="Creating…">New pull list</SubmitButton>
      </form>
    </>
  );
}
