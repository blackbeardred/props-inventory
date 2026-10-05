"use server";

import { createClient } from "@/lib/supabase/server";

export type PullTarget = {
  productionId: string;
  productionName: string;
  /** Null when the production has no pull list yet: the first add makes one. */
  pullListId: string | null;
  /** What the bar and the swipe say: the production, plus the list's name
   *  when the production has more than one. */
  label: string;
};

export type AddResult =
  | { ok: true; added: true; pullListItemId: string; target: PullTarget }
  | { ok: true; added: false; target: PullTarget }
  | { ok: false; message: string };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The productions something can be added to, as the swipe's picker lists them:
 * one entry per production, or one per pull list when a production has
 * several. Newest show first; the picker moves the one this phone had open
 * last to the top.
 */
export async function listPullTargets(): Promise<
  { ok: true; targets: PullTarget[] } | { ok: false; message: string }
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("productions")
    .select("id, name, start_date, created_at, pull_lists(id, name, created_at)")
    .order("start_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) return { ok: false, message: "Couldn’t load your productions." };

  type Row = {
    id: string;
    name: string;
    pull_lists: { id: string; name: string; created_at: string }[] | null;
  };
  const targets: PullTarget[] = [];
  for (const production of (data ?? []) as Row[]) {
    const lists = [...(production.pull_lists ?? [])].sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    );
    if (lists.length <= 1) {
      targets.push({
        productionId: production.id,
        productionName: production.name,
        pullListId: lists[0]?.id ?? null,
        label: production.name,
      });
    } else {
      for (const list of lists) {
        targets.push({
          productionId: production.id,
          productionName: production.name,
          pullListId: list.id,
          label: `${production.name} · ${list.name}`,
        });
      }
    }
  }
  return { ok: true, targets };
}

/**
 * Puts one of an item on a production's pull list, from a swipe.
 *
 * Returns rather than redirects: the person is still on the inventory, mid-
 * walk, and the bar at the bottom says what happened. Something already on
 * that list isn't added twice — the bar says it's already there, and the
 * quantity is left for the production page, where it can be seen.
 *
 * A production with no pull list gets one, named the way the production page
 * names a new one. Row-level security scopes every query here to the active
 * theatre, so an id from another theatre simply isn't found.
 */
export async function addToPullList(itemId: string, target: PullTarget): Promise<AddResult> {
  if (!ID.test(itemId) || !ID.test(target.productionId)) {
    return { ok: false, message: "That item or production wasn’t recognised." };
  }
  if (target.pullListId !== null && !ID.test(target.pullListId)) {
    return { ok: false, message: "That pull list wasn’t recognised." };
  }

  const supabase = await createClient();

  // Re-read the list rather than trusting the phone's memory of it: it may
  // have been deleted since, or the production given a list since.
  let pullListId = target.pullListId;
  if (pullListId) {
    const { data } = await supabase
      .from("pull_lists")
      .select("id")
      .eq("id", pullListId)
      .eq("production_id", target.productionId)
      .maybeSingle();
    if (!data) pullListId = null;
  }
  if (!pullListId) {
    const { data: existing } = await supabase
      .from("pull_lists")
      .select("id")
      .eq("production_id", target.productionId)
      .order("created_at", { ascending: true })
      .limit(1);
    pullListId = (existing as { id: string }[] | null)?.[0]?.id ?? null;
  }
  if (!pullListId) {
    const { data: production } = await supabase
      .from("productions")
      .select("id")
      .eq("id", target.productionId)
      .maybeSingle();
    if (!production) {
      return { ok: false, message: "That production isn’t there any more. Choose another." };
    }
    const { data: created, error } = await supabase
      .from("pull_lists")
      .insert({ production_id: target.productionId, name: "Pull List" })
      .select("id")
      .single();
    if (error || !created) return { ok: false, message: "Couldn’t start a pull list for it." };
    pullListId = (created as { id: string }).id;
  }

  const settled: PullTarget = { ...target, pullListId };

  const { data: already } = await supabase
    .from("pull_list_items")
    .select("id")
    .eq("pull_list_id", pullListId)
    .eq("item_id", itemId)
    .limit(1);
  if ((already as { id: string }[] | null)?.length) {
    return { ok: true, added: false, target: settled };
  }

  const { data: row, error } = await supabase
    .from("pull_list_items")
    .insert({ pull_list_id: pullListId, item_id: itemId, quantity_needed: 1 })
    .select("id")
    .single();
  if (error || !row) return { ok: false, message: "Couldn’t add it. Check the connection and try again." };

  // No revalidatePath: it would make the inventory page refetch itself on
  // every swipe, and the production page is rendered fresh on each visit
  // anyway.
  return { ok: true, added: true, pullListItemId: (row as { id: string }).id, target: settled };
}

/** Takes back an add, from the bar's Undo. Only ever the row the add made. */
export async function undoAddToPullList(pullListItemId: string): Promise<{ ok: boolean }> {
  if (!ID.test(pullListItemId)) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.from("pull_list_items").delete().eq("id", pullListItemId);
  return { ok: !error };
}
