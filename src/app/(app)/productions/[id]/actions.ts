"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { trashPullList, trashPullListGroup, trashPullListItem } from "@/lib/recently-deleted";
import { costumeName } from "@/lib/costumes";
import { withUndo } from "@/lib/undo-href";

/**
 * Back to the production. A line inside a costume (migration 019) sends the
 * costume's id as keepOpen, so changing one piece doesn't shut the costume
 * it's in.
 */
function back(productionId: string, formData: FormData, undo?: { recordId: string; label: string }) {
  const keepOpen = String(formData.get("keepOpen") ?? "").trim();
  const open = keepOpen && /^[\w-]{1,64}$/.test(keepOpen) ? keepOpen : "";
  const path = open ? `/productions/${productionId}?open=${encodeURIComponent(open)}` : `/productions/${productionId}`;
  // The #costume- part goes last: anything after it isn't sent to the page.
  return `${undo ? withUndo(path, undo.recordId, undo.label) : path}${open ? `#costume-${open}` : ""}`;
}

function fail(productionId: string, message: string): never {
  redirect(
    `/productions/${productionId}?error=${encodeURIComponent(message)}`
  );
}

export async function createPullList(formData: FormData) {
  const productionId = String(formData.get("productionId") ?? "");
  if (!productionId) {
    redirect("/productions");
  }

  const name = String(formData.get("name") ?? "").trim() || "Pull List";

  const supabase = await createClient();
  const { error } = await supabase
    .from("pull_lists")
    .insert({ production_id: productionId, name });

  if (error) {
    fail(productionId, error.message);
  }

  redirect(`/productions/${productionId}`);
}

export async function deletePullList(formData: FormData) {
  const productionId = String(formData.get("productionId") ?? "");
  const pullListId = String(formData.get("pullListId") ?? "");
  if (!productionId) {
    redirect("/productions");
  }
  if (!pullListId) {
    redirect(`/productions/${productionId}`);
  }

  const supabase = await createClient();
  const result = await trashPullList(supabase, pullListId);
  if (!result.ok) {
    fail(productionId, result.message);
  }

  redirect(withUndo(`/productions/${productionId}`, result.recordId, result.label));
}

export async function addPullListItem(formData: FormData) {
  const productionId = String(formData.get("productionId") ?? "");
  const pullListId = String(formData.get("pullListId") ?? "");
  const itemId = String(formData.get("itemId") ?? "").trim();
  const quantityRaw = String(formData.get("quantityNeeded") ?? "1").trim();

  if (!productionId) {
    redirect("/productions");
  }
  if (!pullListId) {
    redirect(`/productions/${productionId}`);
  }

  if (!itemId) {
    fail(productionId, "Choose an item to add to the pull list.");
  }

  const quantityNeeded = Number.parseInt(quantityRaw, 10);
  if (!Number.isFinite(quantityNeeded) || quantityNeeded < 1) {
    fail(productionId, "Quantity needed must be a whole number of 1 or more.");
  }

  // Added inside a costume (migration 019). Only sent then, so adding a
  // plain line still works before 019 is run.
  const groupId = String(formData.get("groupId") ?? "").trim();

  const supabase = await createClient();
  const { error } = await supabase.from("pull_list_items").insert({
    pull_list_id: pullListId,
    item_id: itemId,
    quantity_needed: quantityNeeded,
    ...(groupId ? { group_id: groupId } : {}),
  });

  if (error) {
    fail(productionId, costumeError(error));
  }

  redirect(groupId ? openCostume(productionId, groupId) : `/productions/${productionId}`);
}

// ── Costumes (migration 019) ────────────────────────────────────────────

/** The production page with one costume opened, scrolled to. */
function openCostume(productionId: string, groupId: string) {
  return `/productions/${productionId}?open=${encodeURIComponent(groupId)}#costume-${groupId}`;
}

/** A plain sentence for the one failure people can do something about. */
function costumeError(error: { code?: string; message: string }) {
  return error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST204" ||
    /pull_list_groups|group_id|schema cache/i.test(error.message)
    ? "Costumes aren’t switched on yet: run migration 019 (019_costumes.sql) in Supabase, then try again."
    : error.message;
}

/** "Add costume": a named, empty costume on the list, opened ready for pieces. */
export async function addCostume(formData: FormData) {
  const productionId = String(formData.get("productionId") ?? "");
  const pullListId = String(formData.get("pullListId") ?? "");
  if (!productionId) redirect("/productions");
  if (!pullListId) redirect(`/productions/${productionId}`);
  const name = costumeName(String(formData.get("name") ?? ""));
  if (!name) fail(productionId, "Give the costume a name, such as the character’s.");

  const supabase = await createClient();
  const { count } = await supabase
    .from("pull_list_groups")
    .select("id", { count: "exact", head: true })
    .eq("pull_list_id", pullListId);
  const { data, error } = await supabase
    .from("pull_list_groups")
    .insert({ pull_list_id: pullListId, name, position: count ?? 0 })
    .select("id")
    .single();
  if (error || !data) fail(productionId, costumeError(error ?? { message: "The costume wasn’t made." }));

  redirect(openCostume(productionId, String((data as { id: string }).id)));
}

export async function renameCostume(formData: FormData) {
  const productionId = String(formData.get("productionId") ?? "");
  const groupId = String(formData.get("groupId") ?? "");
  if (!productionId) redirect("/productions");
  const name = costumeName(String(formData.get("name") ?? ""));
  if (!groupId || !name) fail(productionId, "Give the costume a name.");

  const supabase = await createClient();
  const { error } = await supabase.from("pull_list_groups").update({ name }).eq("id", groupId);
  if (error) fail(productionId, costumeError(error));
  redirect(openCostume(productionId, groupId));
}

/**
 * Puts a line into a costume on the same list, or takes it out (groupId
 * empty). The database refuses a costume on another list.
 */
export async function moveToCostume(formData: FormData) {
  const productionId = String(formData.get("productionId") ?? "");
  const pullListItemId = String(formData.get("pullListItemId") ?? "");
  const groupId = String(formData.get("groupId") ?? "").trim();
  if (!productionId) redirect("/productions");
  if (!pullListItemId) redirect(`/productions/${productionId}`);

  const supabase = await createClient();
  const { error } = await supabase
    .from("pull_list_items")
    .update({ group_id: groupId || null })
    .eq("id", pullListItemId);
  if (error) fail(productionId, costumeError(error));
  redirect(groupId ? openCostume(productionId, groupId) : `/productions/${productionId}`);
}

/**
 * Deletes a costume, to Recently Deleted. "keep" leaves its pieces on the
 * list as loose lines; "remove" takes them too.
 */
export async function deleteCostume(formData: FormData) {
  const productionId = String(formData.get("productionId") ?? "");
  const groupId = String(formData.get("groupId") ?? "");
  const withPieces = formData.get("pieces") === "remove";
  if (!productionId) redirect("/productions");
  if (!groupId) redirect(`/productions/${productionId}`);

  const supabase = await createClient();
  const result = await trashPullListGroup(supabase, groupId, { withPieces });
  if (!result.ok) fail(productionId, result.message);
  redirect(withUndo(`/productions/${productionId}`, result.recordId, result.label));
}

/**
 * "Reuse a costume from a past show": a new costume of the same name on this
 * list, with the same pieces. A piece already loose on this list joins it
 * rather than being added twice; one already in another costume here is left
 * where it is.
 */
export async function reuseCostume(formData: FormData) {
  const productionId = String(formData.get("productionId") ?? "");
  const pullListId = String(formData.get("pullListId") ?? "");
  const sourceId = String(formData.get("sourceGroupId") ?? "");
  if (!productionId) redirect("/productions");
  if (!pullListId) redirect(`/productions/${productionId}`);
  if (!sourceId) fail(productionId, "Choose a costume from a past show.");

  const supabase = await createClient();
  const [{ data: source }, { data: pieces }, { data: here }, { count }] = await Promise.all([
    supabase.from("pull_list_groups").select("name").eq("id", sourceId).maybeSingle(),
    supabase.from("pull_list_items").select("item_id, quantity_needed").eq("group_id", sourceId).order("created_at"),
    supabase.from("pull_list_items").select("*").eq("pull_list_id", pullListId),
    supabase.from("pull_list_groups").select("id", { count: "exact", head: true }).eq("pull_list_id", pullListId),
  ]);
  if (!source) fail(productionId, "That costume isn’t there any more.");

  const { data: made, error } = await supabase
    .from("pull_list_groups")
    .insert({ pull_list_id: pullListId, name: String((source as { name: string }).name), position: count ?? 0 })
    .select("id")
    .single();
  if (error || !made) fail(productionId, costumeError(error ?? { message: "The costume wasn’t made." }));
  const groupId = String((made as { id: string }).id);

  type HereLine = { id: string; item_id: string; group_id?: string | null };
  const existing = (here ?? []) as HereLine[];
  const toJoin: string[] = [];
  const toAdd: { pull_list_id: string; item_id: string; quantity_needed: number; group_id: string }[] = [];
  for (const piece of (pieces ?? []) as { item_id: string; quantity_needed: number }[]) {
    const onList = existing.find((l) => l.item_id === piece.item_id);
    if (!onList) toAdd.push({ pull_list_id: pullListId, item_id: piece.item_id, quantity_needed: piece.quantity_needed, group_id: groupId });
    else if (!onList.group_id) toJoin.push(onList.id);
  }
  if (toJoin.length) {
    const { error: joinError } = await supabase.from("pull_list_items").update({ group_id: groupId }).in("id", toJoin);
    if (joinError) fail(productionId, costumeError(joinError));
  }
  if (toAdd.length) {
    const { error: addError } = await supabase.from("pull_list_items").insert(toAdd);
    if (addError) fail(productionId, costumeError(addError));
  }
  redirect(openCostume(productionId, groupId));
}

export async function updatePullListItemQuantity(formData: FormData) {
  const productionId = String(formData.get("productionId") ?? "");
  const pullListItemId = String(formData.get("pullListItemId") ?? "");
  const quantityRaw = String(formData.get("quantityNeeded") ?? "").trim();

  if (!productionId) {
    redirect("/productions");
  }
  if (!pullListItemId) {
    redirect(`/productions/${productionId}`);
  }

  const quantityNeeded = Number.parseInt(quantityRaw, 10);
  if (!Number.isFinite(quantityNeeded) || quantityNeeded < 1) {
    fail(productionId, "Quantity needed must be a whole number of 1 or more.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("pull_list_items")
    .update({ quantity_needed: quantityNeeded })
    .eq("id", pullListItemId);

  if (error) {
    fail(productionId, error.message);
  }

  redirect(back(productionId, formData));
}

export async function updatePullListItemStatus(formData: FormData) {
  const productionId = String(formData.get("productionId") ?? "");
  const pullListItemId = String(formData.get("pullListItemId") ?? "");
  const newStatus = String(formData.get("newStatus") ?? "");

  if (!productionId) {
    redirect("/productions");
  }
  if (!pullListItemId || !["pending", "pulled", "returned"].includes(newStatus)) {
    fail(productionId, "That status change wasn\u2019t valid.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("pull_list_items")
    .update({ status: newStatus })
    .eq("id", pullListItemId);

  if (error) {
    fail(productionId, error.message);
  }

  redirect(back(productionId, formData));
}

export async function removePullListItem(formData: FormData) {
  const productionId = String(formData.get("productionId") ?? "");
  const pullListItemId = String(formData.get("pullListItemId") ?? "");

  if (!productionId) {
    redirect("/productions");
  }
  if (!pullListItemId) {
    redirect(`/productions/${productionId}`);
  }

  const supabase = await createClient();
  const result = await trashPullListItem(supabase, pullListItemId);
  if (!result.ok) {
    fail(productionId, result.message);
  }

  redirect(back(productionId, formData, { recordId: result.recordId, label: result.label }));
}
