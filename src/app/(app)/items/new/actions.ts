"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PHOTOS_BUCKET } from "@/lib/supabase/storage";
import { tagPhoto } from "@/lib/ai/tag-photo";

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
    .select("org_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    redirect("/onboarding");
  }

  const itemId = randomUUID();
  let photoPath: string | null = null;
  let autoTags: string[] = [];

  if (photoFile) {
    const ext = ALLOWED_PHOTO_TYPES[photoFile.type];
    photoPath = `${profile.org_id}/${itemId}/${randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .upload(photoPath, photoFile, { contentType: photoFile.type });

    if (uploadError) {
      fail(`Couldn\u2019t upload the photo: ${uploadError.message}`);
    }

    // Best-effort: never blocks or fails the save if this doesn't work.
    const photoBytes = new Uint8Array(await photoFile.arrayBuffer());
    autoTags = await tagPhoto(photoBytes, photoFile.type);
  }

  const { error: insertError } = await supabase.from("items").insert({
    id: itemId,
    org_id: profile.org_id,
    name,
    category,
    description: description || null,
    quantity,
    condition,
    location_id: locationId || null,
    photo_url: photoPath,
    auto_tags: autoTags,
  });

  if (insertError) {
    fail(insertError.message);
  }

  redirect("/items");
}
