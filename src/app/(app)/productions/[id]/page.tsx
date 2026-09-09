import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Badge,
  EmptyState,
  Notice,
  PageHeading,
  SelectField,
  TextField,
} from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { DeleteButton } from "@/components/delete-button";
import { createClient } from "@/lib/supabase/server";
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
  items: { name: string; category: string } | null;
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

  const supabase = await createClient();

  const [{ data: production }, { data: pullLists }, { data: orgItems }] =
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
      supabase.from("items").select("id, name").order("name"),
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
  const items = (orgItems ?? []) as unknown as { id: string; name: string }[];

  const pullListIds = lists.map((list) => list.id);
  let itemsByPullList = new Map<string, PullListItemWithItem[]>();
  if (pullListIds.length > 0) {
    const { data: pullListItems } = await supabase
      .from("pull_list_items")
      .select(
        "id, pull_list_id, item_id, quantity_needed, status, created_at, items(name, category)"
      )
      .in("pull_list_id", pullListIds)
      .order("created_at");

    const rows = (pullListItems ?? []) as unknown as PullListItemWithItem[];
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
          <Link
            href={`/productions/${typedProduction.id}/edit`}
            className="inline-flex items-center justify-center rounded-md border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface"
          >
            Edit production
          </Link>
        }
      />

      {error ? (
        <div className="mb-6">
          <Notice title="That didn’t go through">{error}</Notice>
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
            <div
              key={list.id}
              className="mb-8 rounded-lg border border-rule"
            >
              <div className="flex items-center justify-between border-b border-rule px-5 py-3">
                <h2 className="font-display text-lg">{list.name}</h2>
                <form action={deletePullList}>
                  <input type="hidden" name="productionId" value={typedProduction.id} />
                  <input type="hidden" name="pullListId" value={list.id} />
                  <DeleteButton
                    confirmMessage={`Delete "${list.name}" and everything on it? This can’t be undone.`}
                  >
                    Delete list
                  </DeleteButton>
                </form>
              </div>

              <div className="px-5 py-4">
                {listItems.length === 0 ? (
                  <p className="font-body text-sm text-muted">
                    Nothing on this list yet.
                  </p>
                ) : (
                  <ul className="divide-y divide-rule">
                    {listItems.map((pullListItem) => (
                      <li
                        key={pullListItem.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-body text-sm text-foreground">
                            {pullListItem.items?.name ?? "Unknown item"}
                          </span>
                          <form
                            action={updatePullListItemQuantity}
                            className="flex items-center gap-1"
                          >
                            <input type="hidden" name="productionId" value={typedProduction.id} />
                            <input type="hidden" name="pullListItemId" value={pullListItem.id} />
                            <span className="font-body text-xs text-muted">×</span>
                            <input
                              type="number"
                              name="quantityNeeded"
                              min={1}
                              defaultValue={pullListItem.quantity_needed}
                              className="w-14 rounded-md border border-rule bg-surface px-2 py-1 font-body text-xs text-foreground outline-none transition-colors focus:border-accent"
                            />
                            <SubmitButton variant="ghost" pendingText="…">
                              Save
                            </SubmitButton>
                          </form>
                        </div>
                        <div className="flex items-center gap-3">
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
                    ))}
                  </ul>
                )}

                {items.length > 0 ? (
                  <form
                    action={addPullListItem}
                    className="mt-4 flex flex-wrap items-end gap-3 border-t border-rule pt-4"
                  >
                    <input type="hidden" name="productionId" value={typedProduction.id} />
                    <input type="hidden" name="pullListId" value={list.id} />
                    <div className="w-56">
                      <SelectField label="Item" name="itemId" defaultValue="">
                        <option value="" disabled>
                          Choose an item
                        </option>
                        {items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </SelectField>
                    </div>
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
                  </form>
                ) : (
                  <p className="mt-4 border-t border-rule pt-4 font-body text-sm text-muted">
                    Add some items to your inventory before building a pull
                    list.
                  </p>
                )}
              </div>
            </div>
          );
        })
      )}

      <form
        action={createPullList}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-rule px-5 py-4"
      >
        <input type="hidden" name="productionId" value={typedProduction.id} />
        <div className="w-64">
          <TextField label="New pull list name" name="name" defaultValue="Pull List" />
        </div>
        <SubmitButton pendingText="Creating…">New pull list</SubmitButton>
      </form>
    </>
  );
}
