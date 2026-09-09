"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
  const { error } = await supabase
    .from("pull_lists")
    .delete()
    .eq("id", pullListId);

  if (error) {
    fail(productionId, error.message);
  }

  redirect(`/productions/${productionId}`);
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

  const supabase = await createClient();
  const { error } = await supabase.from("pull_list_items").insert({
    pull_list_id: pullListId,
    item_id: itemId,
    quantity_needed: quantityNeeded,
  });

  if (error) {
    fail(productionId, error.message);
  }

  redirect(`/productions/${productionId}`);
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

  redirect(`/productions/${productionId}`);
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

  redirect(`/productions/${productionId}`);
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
  const { error } = await supabase
    .from("pull_list_items")
    .delete()
    .eq("id", pullListItemId);

  if (error) {
    fail(productionId, error.message);
  }

  redirect(`/productions/${productionId}`);
}
