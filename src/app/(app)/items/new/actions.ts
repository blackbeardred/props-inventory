"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PHOTOS_BUCKET } from "@/lib/supabase/storage";
import { generateTags } from "@/lib/ai/tag-item";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

// Keyed by the browser-supplied MIME type; the value is the extension we
// store the file under. Anything else is rejected.
const ALLOWED_PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function fail(message: string): never {
  redirect(`/items/new?error=${encodeURIComponent(message)}`);
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

export async function createItem(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const categoryRaw = String(formData.get("category") ?? "prop");
  const description = String(formData.get("description") ?? "").trim();
  const quantityRaw = String(formData.get("quantity") ?? "1").trim();
  const conditionRaw = String(formData.get("condition") ?? "").trim();
  const locationId = String(formData.get("locationId") ?? "").trim();
  const photo = formData.get("photo");

  if (!name) {
    fail("Item name is required.");
  }

  const quantity = Number.parseInt(quantityRaw, 10);
  if (!Number.isFinite(quantity) || quantity < 1) {
    fail("Quantity must be a whole number of 1 or more.");
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
      fail("Photo must be a JPG, PNG, GIF, or WEBP image.");
    }
    if (photo.size > MAX_PHOTO_BYTES) {
      fail("Photo must be smaller than 8MB.");
    }
    photoFile = photo;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/items/new");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("active_org_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.active_org_id) {
    redirect("/onboarding");
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
      locationError instanceof Error
        ? locationError.message
        : "Couldn\u2019t create that location."
    );
  }

  const itemId = randomUUID();
  let photoPath: string | null = null;
  let autoTags: string[] = [];

  if (photoFile) {
    const ext = ALLOWED_PHOTO_TYPES[photoFile.type];
    photoPath = `${profile.active_org_id}/${itemId}/${randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .upload(photoPath, photoFile, { contentType: photoFile.type });

    if (uploadError) {
      fail(`Couldn\u2019t upload the photo: ${uploadError.message}`);
    }
  }

  // Tags come from what the item *is*, so every item gets them — a photo
  // just gives the model more to go on. Best-effort: never blocks the save.
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

  const { error: insertError } = await supabase.from("items").insert({
    id: itemId,
    org_id: profile.active_org_id,
    name,
    category,
    description: description || null,
    quantity,
    condition,
    location_id: resolvedLocationId,
    photo_url: photoPath,
    auto_tags: autoTags,
  });

  if (insertError) {
    fail(insertError.message);
  }

  redirect("/items");
}
