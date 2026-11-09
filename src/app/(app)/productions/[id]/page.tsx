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
import { RememberPlace } from "@/components/remember-place";
import { locationPaths, type LocationNode } from "@/lib/locations";
import { PHOTOS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/supabase/storage";
import { createClient } from "@/lib/supabase/server";
import { findPullIssues } from "@/lib/checklist";
import { loadChecklistRows } from "@/lib/checklist-data";
import { supabaseConfigured } from "@/lib/supabase/config";
import {
  PRODUCTION_STATUS_LABELS,
  formatDateRange,
  type ProductionRow,
  type ProductionStatus,
  type PullListItemRow,
  type PullListRow,
} from "@/lib/inventory";
import {
  addCostume,
  addPullListItem,
  createPullList,
  deleteCostume,
  deletePullList,
  moveToCostume,
  removePullListItem,
  renameCostume,
  reuseCostume,
  updatePullListItemQuantity,
  updatePullListItemStatus,
} from "./actions";
import { PullRow, StatusSwitch } from "./pull-row";
import { CostumeRow } from "./costume-row";
import { DismissableDetails } from "@/components/dismissable-details";
import {
  arrangeList,
  costumeSummary,
  suggestPieces,
  suggestionNote,
  type Group,
  type HistoryLine,
  type Suggestion,
} from "@/lib/costumes";

export const metadata: Metadata = {
  title: "Production · Propolis",
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
  /** Its costume (migration 019); missing before 019 is run. */
  group_id?: string | null;
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
  // A costume to show opened (just made, or added to).
  const openGroup = first((await searchParams).open) ?? null;
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
      // Every column, so group_id (migration 019) comes when it's there
      // and the list still loads before.
      .select("*, items(name, category, photo_url, location_id)")
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

  // ── Costumes (migration 019) ──────────────────────────────────────────
  // Every costume in the theater (RLS keeps it to this one), for this
  // production's lists, the "reuse from a past show" choice, and naming the
  // costume a suggestion was worn in. An error means 019 hasn't been run:
  // then there are no costumes, and nothing about them is offered.
  type GroupWithShow = Group & {
    pull_list_id: string;
    pull_lists: { production_id: string; productions: { name: string } | null } | null;
  };
  const { data: groupRows, error: groupsError } = await supabase
    .from("pull_list_groups")
    .select("id, name, position, created_at, pull_list_id, pull_lists(production_id, productions(name))")
    .order("created_at");
  const costumesOn = !groupsError;
  const allGroups = (groupRows ?? []) as unknown as GroupWithShow[];
  const groupsByList = new Map<string, GroupWithShow[]>();
  for (const group of allGroups) {
    if (!pullListIds.includes(group.pull_list_id)) continue;
    groupsByList.set(group.pull_list_id, [...(groupsByList.get(group.pull_list_id) ?? []), group]);
  }
  const groupNames = new Map(allGroups.map((g) => [g.id, g.name]));
  const pastCostumes = allGroups.filter((g) => g.pull_lists && g.pull_lists.production_id !== id);

  // Every pull-list line in the theater, for "often pulled with" from past
  // shows. Lines are small; RLS keeps them to this theater.
  const { data: historyRows } = await supabase
    .from("pull_list_items")
    .select("*, pull_lists(production_id)");
  const history: HistoryLine[] = ((historyRows ?? []) as unknown as (Record<string, unknown> & {
    pull_lists: { production_id: string } | null;
  })[])
    .filter((row) => row.pull_lists)
    .map((row) => ({
      item_id: String(row.item_id),
      pull_list_id: String(row.pull_list_id),
      production_id: row.pull_lists!.production_id,
      group_id: typeof row.group_id === "string" ? row.group_id : null,
      status: String(row.status),
    }));

  // Suggestions per costume, and for the loose things on each list.
  const suggestionsByKey = new Map<string, Suggestion[]>();
  for (const list of lists) {
    const lines = itemsByPullList.get(list.id) ?? [];
    const onList = lines.map((l) => l.item_id);
    const { costumes, loosePieces, props } = arrangeList(lines, groupsByList.get(list.id) ?? []);
    for (const { group, lines: pieces } of costumes) {
      if (!pieces.length) continue;
      suggestionsByKey.set(group.id, suggestPieces(history, {
        seeds: pieces.map((l) => l.item_id), production: id, skip: onList, groupNames,
      }));
    }
    const loose = [...loosePieces, ...props];
    if (loose.length) {
      suggestionsByKey.set(`list-${list.id}`, suggestPieces(history, {
        seeds: loose.map((l) => l.item_id), production: id, skip: onList, groupNames,
      }));
    }
  }
  const suggestedIds = [...new Set([...suggestionsByKey.values()].flat().map((s) => s.item_id))];
  const suggestedNames = new Map<string, string>();
  if (suggestedIds.length) {
    const { data: named } = await supabase.from("items").select("id, name").in("id", suggestedIds);
    for (const item of (named ?? []) as { id: string; name: string }[]) suggestedNames.set(item.id, item.name);
  }

  /** One line of a pull list: the same everywhere it appears. */
  function renderLine(
    pullListItem: PullListItemWithItem,
    extra?: { costumes?: GroupWithShow[]; inCostume?: string }
  ) {
    const photoPath = pullListItem.items?.photo_url;
    const photoUrl = photoPath ? photoUrlByPath.get(photoPath) : undefined;
    const locationId = pullListItem.items?.location_id;
    const where = locationId ? (pathById.get(locationId) ?? "Unknown location") : "Unassigned";
    const notChecked = pullListItem.status === "pulled" && (pullListItem.check_state ?? "open") === "open";
    // A piece of a costume: changing it shouldn't shut the costume.
    const keep = extra?.inCostume ? (pullListItem.group_id ?? undefined) : undefined;
    const keepField = keep ? <input type="hidden" name="keepOpen" value={keep} /> : null;
    return (
      <PullRow
        key={pullListItem.id}
        productionId={typedProduction.id}
        pullListItemId={pullListItem.id}
        status={pullListItem.status}
        name={pullListItem.items?.name ?? "Unknown item"}
        keepOpen={keep}
      >
        {/* What it is and where it lives, as on the checklist. */}
        <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed URL from a private bucket
            <img src={photoUrl} alt="" className="h-11 w-11 shrink-0 rounded object-cover" />
          ) : (
            <div className="h-11 w-11 shrink-0 rounded border border-dashed border-rule" />
          )}
          <div className="min-w-0">
            <p className="truncate font-body text-sm font-medium text-foreground">
              {pullListItem.items?.name ?? "Unknown item"}
            </p>
            <p className="truncate font-mono text-[11px] text-muted">
              {where}
              {/* The checklist's NOT CHECKED, said here too, so the two
                  pages tell the same story. */}
              {notChecked ? (
                <>
                  {" · "}
                  <Link
                    href={`/productions/${typedProduction.id}/checklist`}
                    className="font-body font-medium text-danger-ink hover:underline"
                  >
                    not checked
                  </Link>
                </>
              ) : null}
            </p>
          </div>
        </div>

        {/* Every control in a fixed place, whatever the status: on a phone
            the three statuses get a row of their own and quantity and Remove
            the row below; from md up it's one line. */}
        <div className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 md:flex md:w-auto">
          <form action={updatePullListItemStatus} className="col-span-3 md:order-2">
            <input type="hidden" name="productionId" value={typedProduction.id} />
            {keepField}
            <input type="hidden" name="pullListItemId" value={pullListItem.id} />
            <StatusSwitch status={pullListItem.status} />
          </form>
          <form action={updatePullListItemQuantity} className="md:order-1">
            <input type="hidden" name="productionId" value={typedProduction.id} />
            {keepField}
            <input type="hidden" name="pullListItemId" value={pullListItem.id} />
            <QuantityField
              name="quantityNeeded"
              defaultValue={pullListItem.quantity_needed}
              label={`How many ${pullListItem.items?.name ?? "of this item"}`}
            />
          </form>
          <form action={removePullListItem} className="col-start-3 md:order-3">
            <input type="hidden" name="productionId" value={typedProduction.id} />
            {keepField}
            <input type="hidden" name="pullListItemId" value={pullListItem.id} />
            {/* No "are you sure": the Undo bar puts it straight back. */}
            <DeleteButton>Remove</DeleteButton>
          </form>
        </div>

        {extra?.inCostume ? (
          <form action={moveToCostume} className="w-full" data-take-out>
            <input type="hidden" name="productionId" value={typedProduction.id} />
            <input type="hidden" name="pullListItemId" value={pullListItem.id} />
            <input type="hidden" name="groupId" value="" />
            <button
              type="submit"
              className="-my-2 min-h-11 font-body text-xs text-muted underline-offset-2 hover:text-foreground hover:underline md:min-h-0"
            >
              Take out of {extra.inCostume}
            </button>
          </form>
        ) : extra?.costumes ? (
          // The nudge: a costume piece on its own, when there's a costume
          // on the list it could belong to. Ignoring it is fine.
          <form action={moveToCostume} className="flex w-full flex-wrap items-center gap-2" data-costume-nudge>
            <input type="hidden" name="productionId" value={typedProduction.id} />
            <input type="hidden" name="pullListItemId" value={pullListItem.id} />
            <label className="font-body text-xs text-muted">
              Part of a costume?{" "}
              <select
                name="groupId"
                className="ml-1 min-h-11 rounded-md border border-rule bg-surface px-2 py-1 font-body text-xs text-foreground md:min-h-0"
              >
                {extra.costumes.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton variant="ghost" pendingText="Moving…">Add to it</SubmitButton>
          </form>
        ) : null}
      </PullRow>
    );
  }

  /** "Often pulled with": items from past shows, each with its own Add. */
  function renderSuggestions(key: string, listId: string, groupId: string | null, title: string) {
    const found = (suggestionsByKey.get(key) ?? []).filter((s) => suggestedNames.has(s.item_id));
    if (!found.length) return null;
    return (
      <div className="mt-3 rounded-md bg-surface/60 px-3 py-2.5" data-suggestions>
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{title}</p>
        <ul className="mt-1.5 space-y-1">
          {found.map((s) => (
            <li key={s.item_id}>
              <form action={addPullListItem} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <input type="hidden" name="productionId" value={typedProduction.id} />
                <input type="hidden" name="pullListId" value={listId} />
                <input type="hidden" name="itemId" value={s.item_id} />
                <input type="hidden" name="quantityNeeded" value="1" />
                {groupId ? <input type="hidden" name="groupId" value={groupId} /> : null}
                <span className="font-body text-sm text-foreground">{suggestedNames.get(s.item_id)}</span>
                <span className="font-mono text-[11px] text-muted">
                  {suggestionNote(s)}
                  {s.inUse ? <span className="text-warning-ink"> · pulled for another show</span> : null}
                </span>
                <button
                  type="submit"
                  className="ml-auto min-h-11 rounded-md border border-rule px-3 py-1 font-body text-xs font-medium text-foreground transition-colors hover:bg-background md:min-h-0"
                >
                  Add
                </button>
              </form>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <>
      <RememberPlace id={typedProduction.id} name={typedProduction.name} />
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
            // item's name at the left edge and its buttons 1,000px away. On a
            // phone it runs edge to edge instead (no side borders), so each
            // line — and the swipe that marks it pulled — reaches the sides of
            // the screen rather than stopping at a margin.
            <div
              key={list.id}
              className="-mx-6 mb-8 max-w-3xl border-y border-rule md:mx-0 md:rounded-lg md:border"
            >
              <div className="border-b border-rule px-5 py-3">
                <h2 className="font-display text-lg">{list.name}</h2>
              </div>

              <div className="px-5 py-4">
                {listItems.length === 0 && !(groupsByList.get(list.id) ?? []).length ? (
                  <p className="font-body text-sm text-muted">
                    Nothing on this list yet.
                  </p>
                ) : (() => {
                  const listGroups = groupsByList.get(list.id) ?? [];
                  const { costumes, loosePieces, props } = arrangeList(listItems, listGroups);
                  const heading = "mb-1 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted";
                  return (
                    <div className="space-y-5">
                      {costumes.length || loosePieces.length ? (
                        <section data-section="costumes">
                          <h3 className={heading}>Costumes</h3>
                          <ul className="-mx-5 divide-y divide-rule md:mx-0">
                            {costumes.map(({ group, lines: pieces }) => {
                              const { pieces: count, pulled } = costumeSummary(pieces);
                              return (
                                <CostumeRow
                                  // Keyed on whether it's asked to open, so
                                  // arriving with ?open= opens it even when
                                  // the page kept it shut from before.
                                  key={`${group.id}:${openGroup === group.id ? "open" : ""}`}
                                  id={group.id}
                                  name={group.name}
                                  pieces={count}
                                  pulled={pulled}
                                  defaultOpen={openGroup === group.id}
                                >
                                  {pieces.length ? (
                                    <ul className="divide-y divide-rule">
                                      {pieces.map((piece) => renderLine(piece, { inCostume: group.name }))}
                                    </ul>
                                  ) : (
                                    <p className="px-5 py-2 font-body text-sm text-muted md:px-0">
                                      No pieces yet. Add them below.
                                    </p>
                                  )}
                                  <div className="px-5 md:px-0">
                                    {renderSuggestions(group.id, list.id, group.id, "Pulled with these before")}
                                    {(itemCount ?? 0) > 0 ? (
                                      <form action={addPullListItem} className="mt-3 space-y-3" data-add-piece>
                                        <input type="hidden" name="productionId" value={typedProduction.id} />
                                        <input type="hidden" name="pullListId" value={list.id} />
                                        <input type="hidden" name="groupId" value={group.id} />
                                        <input type="hidden" name="quantityNeeded" value="1" />
                                        <ItemPicker
                                          label={`Add a piece to ${group.name}`}
                                          locations={searchLocations}
                                          alreadyListed={listItems.map((row) => row.item_id)}
                                        />
                                        <SubmitButton variant="ghost" pendingText="Adding…">Add piece</SubmitButton>
                                      </form>
                                    ) : null}
                                    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-rule pt-3">
                                      <form action={renameCostume} className="flex flex-wrap items-center gap-2" data-rename-costume>
                                        <input type="hidden" name="productionId" value={typedProduction.id} />
                                        <input type="hidden" name="groupId" value={group.id} />
                                        <label className="sr-only" htmlFor={`rename-${group.id}`}>Costume name</label>
                                        <input
                                          id={`rename-${group.id}`}
                                          name="name"
                                          defaultValue={group.name}
                                          maxLength={80}
                                          required
                                          className="min-h-11 w-48 rounded-md border border-rule bg-background px-3 py-1.5 font-body text-sm text-foreground outline-none focus:border-accent md:min-h-0"
                                        />
                                        <SubmitButton variant="ghost" pendingText="Saving…">Rename</SubmitButton>
                                      </form>
                                      <DismissableDetails className="relative" data-delete-costume>
                                        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-md border border-rule px-4 py-2 font-body text-sm font-medium text-muted transition-colors hover:border-danger/50 hover:text-danger-ink md:min-h-0 [&::-webkit-details-marker]:hidden">
                                          Delete costume
                                        </summary>
                                        <div className="absolute left-0 z-20 mt-2 w-72 max-w-[calc(100vw-3rem)] rounded-md border border-rule bg-surface p-4 shadow-lg">
                                          <p className="font-body text-sm text-foreground">
                                            Delete {group.name}? You can restore it from Recently deleted for 30 days.
                                          </p>
                                          <div className="mt-3 flex flex-col gap-2">
                                            <form action={deleteCostume}>
                                              <input type="hidden" name="productionId" value={typedProduction.id} />
                                              <input type="hidden" name="groupId" value={group.id} />
                                              <input type="hidden" name="pieces" value="keep" />
                                              <SubmitButton variant="ghost" pendingText="Deleting…">Keep its pieces on the list</SubmitButton>
                                            </form>
                                            {pieces.length ? (
                                              <form action={deleteCostume}>
                                                <input type="hidden" name="productionId" value={typedProduction.id} />
                                                <input type="hidden" name="groupId" value={group.id} />
                                                <input type="hidden" name="pieces" value="remove" />
                                                <SubmitButton variant="ghost" pendingText="Deleting…">Remove its pieces too</SubmitButton>
                                              </form>
                                            ) : null}
                                          </div>
                                        </div>
                                      </DismissableDetails>
                                    </div>
                                  </div>
                                </CostumeRow>
                              );
                            })}
                            {loosePieces.map((piece) =>
                              renderLine(piece, costumes.length ? { costumes: costumes.map((c) => c.group) } : undefined)
                            )}
                          </ul>
                        </section>
                      ) : null}
                      {props.length ? (
                        <section data-section="props">
                          {costumes.length || loosePieces.length ? <h3 className={heading}>Props</h3> : null}
                          <ul className="-mx-5 divide-y divide-rule md:mx-0">
                            {props.map((line) => renderLine(line))}
                          </ul>
                        </section>
                      ) : null}
                      {renderSuggestions(`list-${list.id}`, list.id, null, "Often pulled with these")}
                    </div>
                  );
                })()}

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
                        Add item
                      </SubmitButton>
                    </div>
                  </form>
                ) : (
                  <p className="mt-4 border-t border-rule pt-4 font-body text-sm text-muted">
                    Add some items to your inventory before building a pull
                    list.
                  </p>
                )}

                {/* "Add costume": a costume is put together by character,
                    so it starts from a name ("Margaret") and opens ready for
                    its pieces. Props are added one by one, above. */}
                {costumesOn ? (
                  <div className="mt-4 space-y-3 border-t border-rule pt-4" data-add-costume>
                    <form action={addCostume} className="flex flex-wrap items-end gap-3">
                      <input type="hidden" name="productionId" value={typedProduction.id} />
                      <input type="hidden" name="pullListId" value={list.id} />
                      <label className="block min-w-0 flex-1 basis-48">
                        <span className="mb-1.5 block font-body text-sm text-muted">Costume for</span>
                        <input
                          name="name"
                          placeholder="Character, e.g. Margaret"
                          maxLength={80}
                          required
                          className="min-h-11 w-full rounded-md border border-rule bg-surface px-3 py-2 font-body text-sm text-foreground outline-none transition-colors focus:border-accent md:min-h-0"
                        />
                      </label>
                      <SubmitButton variant="ghost" pendingText="Adding…">Add costume</SubmitButton>
                    </form>
                    {pastCostumes.length ? (
                      <form action={reuseCostume} className="flex flex-wrap items-end gap-3" data-reuse-costume>
                        <input type="hidden" name="productionId" value={typedProduction.id} />
                        <input type="hidden" name="pullListId" value={list.id} />
                        <label className="block min-w-0 flex-1 basis-48">
                          <span className="mb-1.5 block font-body text-sm text-muted">Or reuse one from a past show</span>
                          <select
                            name="sourceGroupId"
                            className="min-h-11 w-full rounded-md border border-rule bg-surface px-3 py-2 font-body text-sm text-foreground md:min-h-0"
                          >
                            {pastCostumes.map((group) => (
                              <option key={group.id} value={group.id}>
                                {group.name} · {group.pull_lists?.productions?.name ?? "a past show"}
                              </option>
                            ))}
                          </select>
                        </label>
                        <SubmitButton variant="ghost" pendingText="Copying…">Reuse it</SubmitButton>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* At the foot of the list, not beside its title: the one
                  button that throws the whole list away shouldn't be the
                  first thing next to its name. */}
              <div className="flex justify-end border-t border-rule px-5 py-3">
                <form action={deletePullList}>
                  <input type="hidden" name="productionId" value={typedProduction.id} />
                  <input type="hidden" name="pullListId" value={list.id} />
                  <DeleteButton
                    confirmMessage={`Delete "${list.name}" and everything on it? You can restore it from Theatre → Recently deleted for 30 days.`}
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
