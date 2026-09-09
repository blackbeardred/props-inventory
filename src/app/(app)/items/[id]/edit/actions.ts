"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PHOTOS_BUCKET } from "@/lib/supabase/storage";
import { tagPhoto } from "@/lib/ai/tag-photo";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const ALLOWED_PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function fail(itemId: string, message: string): never {
  redirect(`/items/${itemId}/edit?error=${encodeURIComponent(message)}`);
}

/** Comma-separated manual tag edits from the form, deduped and capped. */
function parseManualTags(raw: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const entry of raw.split(",")) {
    const tag = entry.trim().toLowerCase();
    if (!tag || tag.length > 40 || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= 20) break;
  }
  return tags;
}

export async function updateItem(formData: FormData) {
  const itemId = String(formData.get("itemId") ?? "");
  if (!itemId) {
    redirect("/items");
  }

  const name = String(formData.get("name") ?? "").trim();
  const categoryRaw = String(formData.get("category") ?? "prop");
  const description = String(formData.get("description") ?? "").trim();
  const quantityRaw = String(formData.get("quantity") ?? "1").trim();
  const conditionRaw = String(formData.get("condition") ?? "").trim();
  const locationId = String(formData.get("locationId") ?? "").trim();
  const removePhoto = formData.get("removePhoto") === "on";
  const photo = formData.get("photo");

  if (!name) {
    fail(itemId, "Item name is required.");
  }

  const quantity = Number.parseInt(quantityRaw, 10);
  if (!Number.isFinite(quantity) || quantity < 1) {
    fail(itemId, "Quantity must be a whole number of 1 or more.");
  }

  const category = categoryRaw === "costume" ? "costume" : "prop";
  const condition = ["new", "good", "fair", "needs_repair"].includes(
    conditionRaw
  )
    ? conditionRaw
    : null;

  let photoFile: File | null = null;
  if (photo instanceof File && photo.size > 0) {
    if (!(photo.type in ALLOWED_PHOTO_TYPES)) {
      fail(itemId, "Photo must be a JPG, PNG, GIF, or WEBP image.");
    }
    if (photo.size > MAX_PHOTO_BYTES) {
      fail(itemId, "Photo must be smaller than 8MB.");
    }
    photoFile = photo;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/items/${itemId}/edit`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    redirect("/onboarding");
  }

  const { data: existingItem } = await supabase
    .from("items")
    .select("photo_url, auto_tags")
    .eq("id", itemId)
    .maybeSingle();

  if (!existingItem) {
    redirect("/items");
  }

  const oldPhotoPath: string | null = existingItem.photo_url;
  let photoPath: string | null = oldPhotoPath;
  // Tags describe the photo, so they only change when the photo does: a new
  // upload gets freshly detected tags (overriding whatever was in the form's
  // tags field, since that was showing the *old* photo's tags), removing the
  // photo clears them, and otherwise whatever the user typed in the tags
  // field wins — that's the only case where it reflects a deliberate edit.
  let autoTags: string[] = (existingItem.auto_tags as string[] | null) ?? [];

  if (photoFile) {
    const ext = ALLOWED_PHOTO_TYPES[photoFile.type];
    photoPath = `${profile.org_id}/${itemId}/${randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .upload(photoPath, photoFile, { contentType: photoFile.type });

    if (uploadError) {
      fail(itemId, `Couldn\u2019t upload the photo: ${uploadError.message}`);
    }

    autoTags = await tagPhoto(
      new Uint8Array(await photoFile.arrayBuffer()),
      photoFile.type
    );
  } else if (removePhoto) {
    photoPath = null;
    autoTags = [];
  } else {
    autoTags = parseManualTags(String(formData.get("autoTags") ?? ""));
  }

  const { error: updateError } = await supabase
    .from("items")
    .update({
      name,
      category,
      description: description || null,
      quantity,
      condition,
      location_id: locationId || null,
      photo_url: photoPath,
      auto_tags: autoTags,
    })
    .eq("id", itemId);

  if (updateError) {
    fail(itemId, updateError.message);
  }

  // Clean up the old photo only after the new state is saved successfully.
  if (oldPhotoPath && oldPhotoPath !== photoPath) {
    await supabase.storage.from(PHOTOS_BUCKET).remove([oldPhotoPath]);
  }

  redirect("/items");
}

/**
 * Re-runs AI tag detection on an item's existing photo, without requiring a
 * fresh upload. Discards whatever is currently in auto_tags (including any
 * manual edits) in favor of a new guess from the current photo — same
 * "tags always describe the current photo" rule the upload path follows.
 */
export async function regenerateTags(formData: FormData) {
  const itemId = String(formData.get("itemId") ?? "");
  if (!itemId) {
    redirect("/items");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/items/${itemId}/edit`);
  }

  const { data: existingItem } = await supabase
    .from("items")
    .select("photo_url")
    .eq("id", itemId)
    .maybeSingle();

  if (!existingItem) {
    redirect("/items");
  }

  const photoPath: string | null = existingItem.photo_url;
  if (!photoPath) {
    fail(itemId, "This item doesn\u2019t have a photo to tag.");
  }

  const { data: photoBlob, error: downloadError } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .download(photoPath);

  if (downloadError || !photoBlob) {
    fail(
      itemId,
      `Couldn\u2019t re-tag: ${downloadError?.message ?? "photo not found in storage"}`
    );
  }

  const mediaType = photoBlob.type || "image/jpeg";
  const photoBytes = new Uint8Array(await photoBlob.arrayBuffer());
  const autoTags = await tagPhoto(photoBytes, mediaType);

  const { error: updateError } = await supabase
    .from("items")
    .update({ auto_tags: autoTags })
    .eq("id", itemId);

  if (updateError) {
    fail(itemId, updateError.message);
  }

  redirect(`/items/${itemId}/edit?notice=tags-regenerated`);
}

export async function deleteItem(formData: FormData) {
  const itemId = String(formData.get("itemId") ?? "");
  if (!itemId) {
    redirect("/items");
  }

  const supabase = await createClient();

  const { data: existingItem } = await supabase
    .from("items")
    .select("photo_url, auto_tags")
    .eq("id", itemId)
    .maybeSingle();

  const { error } = await supabase.from("items").delete().eq("id", itemId);

  if (error) {
    redirect(
      `/items/${itemId}/edit?error=${encodeURIComponent(error.message)}`
    );
  }

  if (existingItem?.photo_url) {
    await supabase.storage.from(PHOTOS_BUCKET).remove([existingItem.photo_url]);
  }

  redirect("/items");
}
