"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserAndProfile } from "@/lib/auth";
import { PHOTOS_BUCKET } from "@/lib/supabase/storage";
import { generateTags } from "@/lib/ai/tag-item";

/**
 * Tags a few of the open theatre's untagged items (see TagCatchUp).
 *
 * Search tags ("mahogany" is wood, a guitar is an instrument) are written when
 * an item is saved through its form. Items that arrive any other way never
 * get them: a spreadsheet import (a few hundred model calls would make it
 * crawl), the sample theatre a test link starts with, anything added straight
 * to the database. Until someone happened to edit one, a search for "wood"
 * walked straight past it.
 *
 * A handful per call, so each call is quick and the page that's asking stays
 * responsive; the caller keeps asking while there are more. Only items with no
 * tags at all are touched, and only if they still have none when the answer
 * comes back, so a save made in the meantime wins.
 */

const BATCH = 4;

type TaggableItem = { id: string; name: string; category: string; description: string | null; photo_url: string | null };
type Client = Awaited<ReturnType<typeof createClient>>;

/** Tags for one item, from its words and its photo when it has one. */
async function tagsFor(supabase: Client, item: TaggableItem): Promise<string[]> {
  let photo: { bytes: Uint8Array; mediaType: string } | null = null;
  if (item.photo_url) {
    try {
      const { data: blob } = await supabase.storage.from(PHOTOS_BUCKET).download(item.photo_url);
      if (blob) photo = { bytes: new Uint8Array(await blob.arrayBuffer()), mediaType: blob.type || "image/jpeg" };
    } catch {
      // Tag from the words alone.
    }
  }
  return generateTags({ name: item.name, category: item.category, description: item.description, photo });
}

export type TagCatchUpResult = {
  tagged: number;
  remaining: number;
  /** The tagger answered with nothing (no API key, the spend limit, an outage):
   *  stop for now rather than ask again for every item. */
  stalled: boolean;
};

export async function tagSomeUntagged(): Promise<TagCatchUpResult> {
  const { user, profile } = await getUserAndProfile();
  if (!user || !profile?.active_org_id) return { tagged: 0, remaining: 0, stalled: true };
  const orgId = profile.active_org_id;
  const supabase = await createClient();

  const { data: items, error } = await supabase
    .from("items")
    .select("id, name, category, description, photo_url")
    .eq("org_id", orgId)
    .eq("auto_tags", "{}")
    .order("created_at")
    .limit(BATCH);
  if (error || !items) return { tagged: 0, remaining: 0, stalled: true };

  let tagged = 0;
  let stalled = false;
  for (const item of items as TaggableItem[]) {
    const tags = await tagsFor(supabase, item);
    if (tags.length === 0) {
      stalled = true;
      break;
    }
    const { error: updateError } = await supabase
      .from("items")
      .update({ auto_tags: tags })
      .eq("id", item.id)
      .eq("auto_tags", "{}");
    if (!updateError) tagged += 1;
  }

  const { count } = await supabase
    .from("items")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("auto_tags", "{}");

  return { tagged, remaining: count ?? 0, stalled };
}

/**
 * Every item in the open theatre, for "Refresh all search tags" on the Theatre
 * page: re-tagging what's already tagged, after the tagging itself improves.
 * Owners only, since every item is a model call.
 */
export async function listItemsToRetag(): Promise<{ ids: string[] } | { error: string }> {
  const { user, profile } = await getUserAndProfile();
  if (!user || !profile?.active_org_id) return { error: "Sign in first." };
  if (profile.role !== "owner" || user.is_anonymous) return { error: "Only an owner can refresh every item’s tags." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("items")
    .select("id")
    .eq("org_id", profile.active_org_id)
    .order("created_at");
  if (error) return { error: error.message };
  return { ids: (data ?? []).map((row: { id: string }) => row.id) };
}

/** Re-tags up to a few of those items. Stops at the first that gets nothing back. */
export async function retagItems(ids: string[]): Promise<{ tagged: number; stalled: boolean; error?: string }> {
  const { user, profile } = await getUserAndProfile();
  if (!user || !profile?.active_org_id) return { tagged: 0, stalled: true, error: "Sign in first." };
  if (profile.role !== "owner" || user.is_anonymous) {
    return { tagged: 0, stalled: true, error: "Only an owner can refresh every item’s tags." };
  }
  const supabase = await createClient();
  const { data: items, error } = await supabase
    .from("items")
    .select("id, name, category, description, photo_url")
    .eq("org_id", profile.active_org_id)
    .in("id", ids.slice(0, BATCH));
  if (error || !items) return { tagged: 0, stalled: true, error: error?.message };

  let tagged = 0;
  for (const item of items as TaggableItem[]) {
    const tags = await tagsFor(supabase, item);
    if (tags.length === 0) return { tagged, stalled: true };
    const { error: updateError } = await supabase.from("items").update({ auto_tags: tags }).eq("id", item.id);
    if (!updateError) tagged += 1;
  }
  return { tagged, stalled: false };
}
