"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PHOTOS_BUCKET } from "@/lib/supabase/storage";
import { generateTags } from "@/lib/ai/tag-item";

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


/**
 * Resolves which location an item should be filed under, creating one first
 * when the form asked for a new one. Runs after the item's own fields have
 * been validated, so a rejected save doesn't leave a stray shelf behind.
 */
async function resolveLocationId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  formData: FormData,
  selectedId: string
): Promise<string | null> {
  const newName = String(formData.get("newLocationName") ?? "").trim();

  if (!newName) {
    // "__new__" without a name means the picker was opened and abandoned.
    return selectedId && selectedId !== "__new__" ? selectedId : null;
  }

  const parentId = String(formData.get("newLocationParentId") ?? "").trim();
  const { data: created, error } = await supabase
    .from("locations")
    .insert({
      org_id: orgId,
      name: newName,
      parent_location_id: parentId || null,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(
      `Couldn\u2019t create the location \u201c${newName}\u201d: ${error?.message ?? "unknown error"}`
    );
  }

  return created.id as string;
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
    .select("active_org_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.active_org_id) {
    redirect("/onboarding");
  }

  const { data: existingItem } = await supabase
    .from("items")
    .select("photo_url, auto_tags, name, description, category")
    .eq("id", itemId)
    .maybeSingle();

  if (!existingItem) {
    redirect("/items");
  }

  let resolvedLocationId: string | null;
  try {
    resolvedLocationId = await resolveLocationId(
      supabase,
      profile.active_org_id,
      formData,
      locationId
    );
  } catch (locationError) {
    fail(
      itemId,
      locationError instanceof Error
        ? locationError.message
        : "Couldn\u2019t create that location."
    );
  }

  const oldPhotoPath: string | null = existingItem.photo_url;
  let photoPath: string | null = oldPhotoPath;
  let autoTags: string[] = (existingItem.auto_tags as string[] | null) ?? [];

  // Tags describe the item, so they're regenerated when the item's own
  // description of itself changes — its words or its photo — and left alone
  // when someone is only correcting a quantity or moving a shelf, which
  // would otherwise cost an API call for nothing.
  const wordsChanged =
    name !== existingItem.name ||
    (description || null) !== (existingItem.description ?? null) ||
    category !== existingItem.category;

  // Items that arrived through the CSV import have never been tagged, so the
  // first save of one tags it even if nothing about it changed.
  const neverTagged = autoTags.length === 0;

  if (photoFile) {
    const ext = ALLOWED_PHOTO_TYPES[photoFile.type];
    photoPath = `${profile.active_org_id}/${itemId}/${randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .upload(photoPath, photoFile, { contentType: photoFile.type });

    if (uploadError) {
      fail(itemId, `Couldn\u2019t upload the photo: ${uploadError.message}`);
    }
  } else if (removePhoto) {
    photoPath = null;
  }

  if (photoFile || removePhoto || wordsChanged || neverTagged) {
    autoTags = await generateTags({
      name,
      category,
      description,
      photo: photoFile
        ? {
            bytes: new Uint8Array(await photoFile.arrayBuffer()),
            mediaType: photoFile.type,
          }
        : null,
    });
  }

  const { error: updateError } = await supabase
    .from("items")
    .update({
      name,
      category,
      description: description || null,
      quantity,
      condition,
      location_id: resolvedLocationId,
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
 * Regenerates an item's search tags on demand, from its current name,
 * category, description and photo. Useful after editing a description, or
 * when the tags simply came out wrong — and, unlike the version this
 * replaced, it works for items that have no photo at all.
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
    .select("name, category, description, photo_url")
    .eq("id", itemId)
    .maybeSingle();

  if (!existingItem) {
    redirect("/items");
  }

  let photo: { bytes: Uint8Array; mediaType: string } | null = null;
  const photoPath: string | null = existingItem.photo_url;

  if (photoPath) {
    const { data: photoBlob, error: downloadError } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .download(photoPath);

    if (downloadError || !photoBlob) {
      // A missing photo isn't fatal any more: tag from the words instead.
      console.error("regenerateTags: couldn't fetch the photo", downloadError);
    } else {
      photo = {
        bytes: new Uint8Array(await photoBlob.arrayBuffer()),
        mediaType: photoBlob.type || "image/jpeg",
      };
    }
  }

  const autoTags = await generateTags({
    name: existingItem.name,
    category: existingItem.category,
    description: existingItem.description,
    photo,
  });

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
