// Recently Deleted: deleting with a snapshot first, restoring from one, and
// clearing them after 30 days. Server only — every function takes the
// request's Supabase client, so row-level security decides what each person
// can read, delete and put back, exactly as it does everywhere else.
//
// The table is deleted_records (migration 007). A delete writes the snapshot
// first and only then deletes; if the delete fails the snapshot is taken back
// out. A restore re-inserts with the original ids, as upserts that skip rows
// already there, so a restore that was cut off part-way can simply be run
// again. Rules that don't need a database live in ./deleted-records.ts.

import type { createClient } from "@/lib/supabase/server";
import { PHOTOS_BUCKET } from "@/lib/supabase/storage";
import { EMBEDDING_MODEL } from "@/lib/embedding";
import { locationPaths, type LocationNode } from "@/lib/locations";
import { pluralize } from "@/lib/inventory";
import {
  itemDetail,
  locationDetail,
  orphanedPhotos,
  productionDetail,
  purgeBefore,
  relinkPlan,
  type DeletedKind,
  type Snapshot,
} from "@/lib/deleted-records";

type Client = Awaited<ReturnType<typeof createClient>>;
type Row = Record<string, unknown>;

export type TrashResult = { ok: true; recordId: string; label: string } | { ok: false; message: string };

export type RestoreResult =
  | { ok: true; kind: DeletedKind; label: string; notes: string[]; href: string }
  | { ok: false; message: string };

export type DeletedRecord = {
  id: string;
  kind: DeletedKind;
  label: string;
  detail: string | null;
  deleted_at: string;
  deleted_by: string | null;
  profiles: { full_name: string | null } | null;
};

const ids = (rows: Row[] | null | undefined) => (rows ?? []).map((r) => String(r.id));

async function currentUserId(supabase: Client): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** Writes the snapshot. Returns its id, or why it couldn't. */
async function keep(
  supabase: Client,
  entry: {
    orgId: string;
    kind: DeletedKind;
    label: string;
    detail: string | null;
    snapshot: Snapshot;
    photoPaths?: string[];
  }
): Promise<{ id: string } | { message: string }> {
  const userId = await currentUserId(supabase);
  if (!userId) return { message: "You need to be signed in to delete things." };
  const { data, error } = await supabase
    .from("deleted_records")
    .insert({
      org_id: entry.orgId,
      kind: entry.kind,
      label: entry.label,
      detail: entry.detail,
      snapshot: entry.snapshot,
      photo_paths: entry.photoPaths ?? [],
      deleted_by: userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    return {
      message: /deleted_records|schema cache|does not exist/i.test(error?.message ?? "")
        ? "Recently Deleted isn’t set up yet: migration 007 needs running in Supabase. Nothing was deleted."
        : `Couldn’t keep a copy to restore from, so nothing was deleted. ${error?.message ?? ""}`.trim(),
    };
  }
  return { id: String((data as Row).id) };
}

/** The delete failed after the snapshot was written: take the snapshot back out. */
async function unkeep(supabase: Client, recordId: string) {
  await supabase.from("deleted_records").delete().eq("id", recordId);
}

// ── Giving a duplicate's photos to its twin ─────────────────────────────

type Twin = { id: string; name: string };

/** What giveToTwin did, so it can be undone if the delete then fails. */
type Handover = { movedIds: string[]; copied: { rowId: string; path: string } | null };

/**
 * A duplicate's photos go to the item it duplicated, so that item can still
 * be found from them: its extra pictures move across as they are, and its own
 * photo is copied in as one more (with its fingerprint, when there is a
 * current one). A copy rather than a shared file, so the twin's picture can't
 * vanish if the duplicate is restored and later given a new photo.
 *
 * All or nothing: if any step fails, what was done is undone and the reason
 * comes back, and the caller doesn't delete.
 */
async function giveToTwin(
  supabase: Client,
  item: Row,
  twin: Twin,
  pictures: Row[],
  embedding: Row | null
): Promise<{ ok: true; handover: Handover } | { ok: false; message: string }> {
  const handover: Handover = { movedIds: [], copied: null };

  if (pictures.length) {
    const movedIds = pictures.map((picture) => String(picture.id));
    const { error } = await supabase
      .from("item_reference_photos")
      .update({ item_id: twin.id })
      .in("id", movedIds);
    if (error) return { ok: false, message: error.message };
    handover.movedIds = movedIds;
  }

  if (item.photo_url) {
    const from = String(item.photo_url);
    const extension = /\.([a-z0-9]+)$/i.exec(from)?.[1]?.toLowerCase() ?? "jpg";
    const to = `${String(item.org_id)}/${twin.id}/ref-${crypto.randomUUID()}.${extension}`;
    const { error: copyError } = await supabase.storage.from(PHOTOS_BUCKET).copy(from, to);
    if (copyError) {
      await takeBack(supabase, item, handover);
      return { ok: false, message: copyError.message };
    }

    const fingerprint =
      embedding && embedding.photo_url === item.photo_url && embedding.embedding ? embedding : null;
    const { data, error } = await supabase
      .from("item_reference_photos")
      .insert({
        item_id: twin.id,
        org_id: item.org_id,
        photo_path: to,
        source: "duplicate",
        similarity: null,
        model: fingerprint ? String(fingerprint.model ?? EMBEDDING_MODEL) : EMBEDDING_MODEL,
        embedding: fingerprint ? fingerprint.embedding : null,
        created_by: await currentUserId(supabase),
      })
      .select("id")
      .single();
    if (error || !data) {
      await supabase.storage.from(PHOTOS_BUCKET).remove([to]);
      await takeBack(supabase, item, handover);
      return { ok: false, message: error?.message ?? "Couldn’t add its photo to the other item." };
    }
    handover.copied = { rowId: String((data as Row).id), path: to };
  }

  return { ok: true, handover };
}

/** Undoes giveToTwin, when the delete it was for didn't go through. */
async function takeBack(supabase: Client, item: Row, handover: Handover) {
  if (handover.movedIds.length) {
    await supabase.from("item_reference_photos").update({ item_id: item.id }).in("id", handover.movedIds);
  }
  if (handover.copied) {
    await supabase.from("item_reference_photos").delete().eq("id", handover.copied.rowId);
    await supabase.storage.from(PHOTOS_BUCKET).remove([handover.copied.path]);
  }
}

// ── Deleting ────────────────────────────────────────────────────────────

/**
 * `twinId`: the item this one is a duplicate of, when the person deleting
 * said so. Its photos go there (giveToTwin) and stay there even if this one
 * is restored.
 */
export async function trashItem(
  supabase: Client,
  itemId: string,
  options: { twinId?: string | null } = {}
): Promise<TrashResult> {
  const { data: item } = await supabase.from("items").select("*").eq("id", itemId).maybeSingle();
  if (!item) return { ok: false, message: "That item isn’t there any more." };
  const row = item as Row;

  let twin: Twin | null = null;
  if (options.twinId) {
    if (options.twinId === itemId) {
      return { ok: false, message: "An item can’t be a duplicate of itself. Nothing was deleted." };
    }
    const { data: found } = await supabase
      .from("items")
      .select("id, name, org_id")
      .eq("id", options.twinId)
      .maybeSingle();
    if (!found || (found as Row).org_id !== row.org_id) {
      return {
        ok: false,
        message: "The item you said this duplicates isn’t there any more. Nothing was deleted.",
      };
    }
    twin = { id: String((found as Row).id), name: String((found as Row).name) };
  }

  const [{ data: lines }, { data: embedding }, { data: locations }, { data: references }] = await Promise.all([
    supabase.from("pull_list_items").select("*").eq("item_id", itemId),
    supabase.from("item_photo_embeddings").select("*").eq("item_id", itemId).maybeSingle(),
    supabase.from("locations").select("id, name, parent_location_id"),
    // Its extra pictures (migration 008), which the delete cascades away.
    // Before 008 is run this reads nothing, which is right: there are none.
    supabase.from("item_reference_photos").select("*").eq("item_id", itemId),
  ]);
  const extraPictures = (references ?? []) as Row[];
  const place = row.location_id
    ? (locationPaths((locations ?? []) as LocationNode[]).get(String(row.location_id)) ?? null)
    : null;

  const kept = await keep(supabase, {
    orgId: String(row.org_id),
    kind: "item",
    label: String(row.name),
    detail: twin
      ? `${itemDetail(place, (lines ?? []).length)} · a duplicate of ${twin.name}`
      : itemDetail(place, (lines ?? []).length),
    snapshot: {
      kind: "item",
      item: row,
      lines: (lines ?? []) as Row[],
      embedding: (embedding as Row | null) ?? null,
      references: extraPictures,
      twin,
    },
    // Kept until the snapshot is purged, so a restored item has its pictures.
    photoPaths: [
      ...(row.photo_url ? [String(row.photo_url)] : []),
      ...extraPictures.map((picture) => String(picture.photo_path)),
    ],
  });
  if ("message" in kept) return { ok: false, message: kept.message };

  let handover: Handover | null = null;
  if (twin && (extraPictures.length || row.photo_url)) {
    const given = await giveToTwin(supabase, row, twin, extraPictures, (embedding as Row | null) ?? null);
    if (!given.ok) {
      await unkeep(supabase, kept.id);
      return {
        ok: false,
        message: `Couldn’t give its photos to ${twin.name}, so nothing was deleted. ${given.message}`.trim(),
      };
    }
    handover = given.handover;
  }

  const { error } = await supabase.from("items").delete().eq("id", itemId);
  if (error) {
    if (handover) await takeBack(supabase, row, handover);
    await unkeep(supabase, kept.id);
    return { ok: false, message: error.message };
  }
  return { ok: true, recordId: kept.id, label: String(row.name) };
}

export async function trashLocation(supabase: Client, locationId: string): Promise<TrashResult> {
  const { data: location } = await supabase.from("locations").select("*").eq("id", locationId).maybeSingle();
  if (!location) return { ok: false, message: "That place isn’t there any more." };
  const row = location as Row;

  // What the delete moves out: shelves go to the top level, items kept
  // directly here become unassigned (both by the foreign keys).
  const [{ data: children }, { data: items }] = await Promise.all([
    supabase.from("locations").select("id").eq("parent_location_id", locationId),
    supabase.from("items").select("id").eq("location_id", locationId),
  ]);
  const childIds = ids(children as Row[]);
  const itemIds = ids(items as Row[]);

  const kept = await keep(supabase, {
    orgId: String(row.org_id),
    kind: "location",
    label: String(row.name),
    detail: locationDetail(childIds.length, itemIds.length),
    snapshot: { kind: "location", location: row, childIds, itemIds },
  });
  if ("message" in kept) return { ok: false, message: kept.message };

  const { error } = await supabase.from("locations").delete().eq("id", locationId);
  if (error) {
    await unkeep(supabase, kept.id);
    return { ok: false, message: error.message };
  }
  return { ok: true, recordId: kept.id, label: String(row.name) };
}

export async function trashProduction(supabase: Client, productionId: string): Promise<TrashResult> {
  const { data: production } = await supabase.from("productions").select("*").eq("id", productionId).maybeSingle();
  if (!production) return { ok: false, message: "That production isn’t there any more." };
  const row = production as Row;

  const { data: lists } = await supabase.from("pull_lists").select("*").eq("production_id", productionId);
  const listIds = ids(lists as Row[]);
  const { data: lines } = listIds.length
    ? await supabase.from("pull_list_items").select("*").in("pull_list_id", listIds)
    : { data: [] as Row[] };

  const kept = await keep(supabase, {
    orgId: String(row.org_id),
    kind: "production",
    label: String(row.name),
    detail: productionDetail(listIds.length, (lines ?? []).length),
    snapshot: { kind: "production", production: row, lists: (lists ?? []) as Row[], lines: (lines ?? []) as Row[] },
  });
  if ("message" in kept) return { ok: false, message: kept.message };

  const { error } = await supabase.from("productions").delete().eq("id", productionId);
  if (error) {
    await unkeep(supabase, kept.id);
    return { ok: false, message: error.message };
  }
  return { ok: true, recordId: kept.id, label: String(row.name) };
}

export async function trashPullList(supabase: Client, pullListId: string): Promise<TrashResult> {
  const { data: list } = await supabase
    .from("pull_lists")
    .select("*, productions(org_id, name)")
    .eq("id", pullListId)
    .maybeSingle();
  if (!list) return { ok: false, message: "That pull list isn’t there any more." };
  const { productions: production, ...row } = list as Row & { productions: { org_id: string; name: string } | null };
  if (!production) return { ok: false, message: "That pull list’s production isn’t there any more." };

  const { data: lines } = await supabase.from("pull_list_items").select("*").eq("pull_list_id", pullListId);

  const kept = await keep(supabase, {
    orgId: production.org_id,
    kind: "pull_list",
    label: String(row.name),
    detail: `from ${production.name} · ${pluralize((lines ?? []).length, "line")}`,
    snapshot: { kind: "pull_list", list: row, lines: (lines ?? []) as Row[], productionName: production.name },
  });
  if ("message" in kept) return { ok: false, message: kept.message };

  const { error } = await supabase.from("pull_lists").delete().eq("id", pullListId);
  if (error) {
    await unkeep(supabase, kept.id);
    return { ok: false, message: error.message };
  }
  return { ok: true, recordId: kept.id, label: String(row.name) };
}

export async function trashPullListItem(supabase: Client, pullListItemId: string): Promise<TrashResult> {
  const { data: line } = await supabase
    .from("pull_list_items")
    .select("*, items(name), pull_lists(name, production_id, productions(org_id, name))")
    .eq("id", pullListItemId)
    .maybeSingle();
  if (!line) return { ok: false, message: "That line isn’t on the list any more." };
  const { items: item, pull_lists: list, ...row } = line as Row & {
    items: { name: string } | null;
    pull_lists: { name: string; production_id: string; productions: { org_id: string; name: string } | null } | null;
  };
  if (!list?.productions) return { ok: false, message: "That line’s pull list isn’t there any more." };
  const name = item?.name ?? "An item";

  const kept = await keep(supabase, {
    orgId: list.productions.org_id,
    kind: "pull_list_item",
    label: name,
    detail: `from ${list.productions.name}’s ${list.name}`,
    snapshot: {
      kind: "pull_list_item",
      line: row,
      productionId: list.production_id,
      productionName: list.productions.name,
      listName: list.name,
    },
  });
  if ("message" in kept) return { ok: false, message: kept.message };

  const { error } = await supabase.from("pull_list_items").delete().eq("id", pullListItemId);
  if (error) {
    await unkeep(supabase, kept.id);
    return { ok: false, message: error.message };
  }
  return { ok: true, recordId: kept.id, label: name };
}

// ── Restoring ───────────────────────────────────────────────────────────

/** Puts rows back with their original ids; rows already there are left alone. */
async function putBack(supabase: Client, table: string, rows: Row[]): Promise<string | null> {
  if (!rows.length) return null;
  const { error } = await supabase.from(table).upsert(rows, { onConflict: "id", ignoreDuplicates: true });
  return error ? error.message : null;
}

async function existing(supabase: Client, table: string, wanted: string[]): Promise<Set<string>> {
  if (!wanted.length) return new Set();
  const { data } = await supabase.from(table).select("id").in("id", wanted);
  return new Set(ids(data as Row[]));
}

/** Lines whose item and list are both still here, and how many aren't. */
async function restorableLines(supabase: Client, lines: Row[]) {
  const items = await existing(supabase, "items", lines.map((l) => String(l.item_id)));
  const lists = await existing(supabase, "pull_lists", lines.map((l) => String(l.pull_list_id)));
  const keep = lines.filter((l) => items.has(String(l.item_id)) && lists.has(String(l.pull_list_id)));
  return { keep, dropped: lines.length - keep.length };
}

export async function restoreRecord(supabase: Client, recordId: string): Promise<RestoreResult> {
  const { data } = await supabase.from("deleted_records").select("*").eq("id", recordId).maybeSingle();
  if (!data) return { ok: false, message: "That’s no longer in Recently Deleted — it may already have been restored." };
  const record = data as Row & { kind: DeletedKind; label: string; snapshot: Snapshot };
  const snap = record.snapshot;
  const notes: string[] = [];
  let href = "/inventory";
  let failure: string | null = null;

  if (snap.kind === "item") {
    const item = { ...snap.item };
    if (item.location_id && !(await existing(supabase, "locations", [String(item.location_id)])).size) {
      item.location_id = null;
      notes.push("The place it was kept has been deleted since, so it’s back unassigned.");
    }
    failure = await putBack(supabase, "items", [item]);
    if (!failure) {
      const { keep, dropped } = await restorableLines(supabase, snap.lines);
      failure = await putBack(supabase, "pull_list_items", keep);
      if (dropped) notes.push(`${pluralize(dropped, "pull-list line")} didn’t come back: the list has been deleted since.`);
    }
    if (!failure && snap.embedding && snap.embedding.photo_url === item.photo_url) {
      // Best effort: a missing fingerprint is redone by the next catch-up.
      await putBack(supabase, "item_photo_embeddings", [snap.embedding]).catch(() => null);
    }
    if (!failure && snap.references?.length) {
      // Best effort too: they're extra pictures, and the item is what was
      // asked for. Pictures that went to a twin are still there under the
      // same ids, so this leaves them where they are.
      await putBack(supabase, "item_reference_photos", snap.references).catch(() => null);
    }
    if (!failure && snap.twin) {
      notes.push(`Its photos stay with ${snap.twin.name}, the item it was deleted as a duplicate of.`);
    }
    href = `/items/${String(item.id)}/edit`;
  } else if (snap.kind === "location") {
    const location = { ...snap.location };
    if (location.parent_location_id && !(await existing(supabase, "locations", [String(location.parent_location_id)])).size) {
      location.parent_location_id = null;
      notes.push("The place it was inside has been deleted since, so it’s back at the top level.");
    }
    failure = await putBack(supabase, "locations", [location]);
    if (!failure) {
      const [{ data: children }, { data: items }] = await Promise.all([
        snap.childIds.length
          ? supabase.from("locations").select("id, parent_location_id").in("id", snap.childIds)
          : Promise.resolve({ data: [] }),
        snap.itemIds.length
          ? supabase.from("items").select("id, location_id").in("id", snap.itemIds)
          : Promise.resolve({ data: [] }),
      ]);
      const plan = relinkPlan(snap.childIds, snap.itemIds, {
        locations: (children ?? []) as { id: string; parent_location_id: string | null }[],
        items: (items ?? []) as { id: string; location_id: string | null }[],
      });
      if (plan.childIds.length) {
        const { error } = await supabase.from("locations").update({ parent_location_id: location.id }).in("id", plan.childIds);
        failure = error?.message ?? null;
      }
      if (!failure && plan.itemIds.length) {
        const { error } = await supabase.from("items").update({ location_id: location.id }).in("id", plan.itemIds);
        failure = error?.message ?? null;
      }
      if (plan.movedOn) {
        notes.push(`${pluralize(plan.movedOn, "thing")} that used to be in it ${plan.movedOn === 1 ? "has" : "have"} been moved or deleted since, and ${plan.movedOn === 1 ? "was" : "were"} left where ${plan.movedOn === 1 ? "it is" : "they are"}.`);
      }
    }
    href = `/inventory?place=${String(location.id)}`;
  } else if (snap.kind === "production") {
    failure = await putBack(supabase, "productions", [snap.production]);
    if (!failure) failure = await putBack(supabase, "pull_lists", snap.lists);
    if (!failure) {
      const { keep, dropped } = await restorableLines(supabase, snap.lines);
      failure = await putBack(supabase, "pull_list_items", keep);
      if (dropped) notes.push(`${pluralize(dropped, "line")} didn’t come back: ${dropped === 1 ? "its item has" : "their items have"} been deleted since.`);
    }
    href = `/productions/${String(snap.production.id)}`;
  } else if (snap.kind === "pull_list") {
    const productionId = String(snap.list.production_id);
    if (!(await existing(supabase, "productions", [productionId])).size) {
      return { ok: false, message: `Its production, ${snap.productionName}, has been deleted. Restore that first, then this list.` };
    }
    failure = await putBack(supabase, "pull_lists", [snap.list]);
    if (!failure) {
      const { keep, dropped } = await restorableLines(supabase, snap.lines);
      failure = await putBack(supabase, "pull_list_items", keep);
      if (dropped) notes.push(`${pluralize(dropped, "line")} didn’t come back: ${dropped === 1 ? "its item has" : "their items have"} been deleted since.`);
    }
    href = `/productions/${productionId}`;
  } else if (snap.kind === "pull_list_item") {
    const listId = String(snap.line.pull_list_id);
    if (!(await existing(supabase, "pull_lists", [listId])).size) {
      return { ok: false, message: `${snap.productionName}’s ${snap.listName} has been deleted. Restore that first, then this line.` };
    }
    if (!(await existing(supabase, "items", [String(snap.line.item_id)])).size) {
      return { ok: false, message: `${record.label} itself has been deleted. Restore the item first, then this line.` };
    }
    failure = await putBack(supabase, "pull_list_items", [snap.line]);
    href = `/productions/${snap.productionId}`;
  }

  if (failure) return { ok: false, message: `Couldn’t restore ${record.label}: ${failure}` };
  await supabase.from("deleted_records").delete().eq("id", recordId);
  return { ok: true, kind: record.kind, label: record.label, notes, href };
}

// ── Clearing ────────────────────────────────────────────────────────────

/** Removes photos only the cleared snapshots still pointed at. */
async function removeOrphanedPhotos(supabase: Client, paths: string[]) {
  if (!paths.length) return;
  const [{ data: used }, { data: usedByPictures }] = await Promise.all([
    supabase.from("items").select("photo_url").in("photo_url", paths),
    // An extra picture still in use (its item was restored, then deleted
    // again and restored again, say) keeps its file too.
    supabase.from("item_reference_photos").select("photo_path").in("photo_path", paths),
  ]);
  const orphans = orphanedPhotos(paths, [
    ...((used ?? []) as Row[]).map((r) => String(r.photo_url)),
    ...((usedByPictures ?? []) as Row[]).map((r) => String(r.photo_path)),
  ]);
  if (orphans.length) await supabase.storage.from(PHOTOS_BUCKET).remove(orphans);
}

/** Everything past its 30 days, cleared. Run whenever the list is opened. */
export async function purgeExpired(supabase: Client, now = new Date()): Promise<number> {
  const { data } = await supabase
    .from("deleted_records")
    .delete()
    .lt("deleted_at", purgeBefore(now))
    .select("photo_paths");
  const rows = (data ?? []) as { photo_paths: string[] | null }[];
  await removeOrphanedPhotos(supabase, rows.flatMap((r) => r.photo_paths ?? []));
  return rows.length;
}

/** Gone for good, before its time. The caller checks the person is an owner. */
export async function deleteForever(supabase: Client, recordId: string): Promise<{ ok: boolean; label?: string }> {
  const { data } = await supabase
    .from("deleted_records")
    .delete()
    .eq("id", recordId)
    .select("label, photo_paths");
  const rows = (data ?? []) as { label: string; photo_paths: string[] | null }[];
  if (!rows.length) return { ok: false };
  await removeOrphanedPhotos(supabase, rows.flatMap((r) => r.photo_paths ?? []));
  return { ok: true, label: rows[0].label };
}

export async function listDeleted(supabase: Client): Promise<{ records: DeletedRecord[]; missingTable: boolean }> {
  const { data, error } = await supabase
    .from("deleted_records")
    .select("id, kind, label, detail, deleted_at, deleted_by, profiles(full_name)")
    .order("deleted_at", { ascending: false })
    .limit(500);
  if (error) return { records: [], missingTable: /deleted_records|schema cache|does not exist/i.test(error.message) };
  return { records: (data ?? []) as unknown as DeletedRecord[], missingTable: false };
}
