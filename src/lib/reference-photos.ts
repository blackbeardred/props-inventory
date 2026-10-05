/**
 * Keeping a confirmed photo as another picture of an item (migration 008).
 *
 * When someone photographs a prop and the app finds it, and a person says
 * that's the one ("That's it" on Find by photo, or a ticked match on the
 * prop-table screen), the photograph is a second picture of the same thing
 * from another angle. It's kept against the item, never shown anywhere, and
 * match_items compares new photos against it as well as the item's own photo.
 * They're also labelled examples, ready if a custom-trained model is ever
 * wanted.
 *
 * Runs in the browser, like the importer's embedded pictures and the
 * prop-table crops: the bytes are already here. Storage's row-level security
 * keys on the path starting with the caller's organization, and the table's
 * policy checks the item is theirs, so going direct is no less locked down.
 *
 * Quiet on purpose. A picture that couldn't be kept costs nothing the person
 * asked for, so failures come back as a value and are never thrown or logged.
 */

import { createClient } from "@/lib/supabase/client";
import { PHOTOS_BUCKET } from "@/lib/supabase/storage";
import { EMBEDDING_MODEL, checkEmbedding, toVectorLiteral } from "@/lib/embedding";
import { worthKeepingAsReference } from "@/lib/visual-match";

export type ReferenceSource = "find_by_photo" | "prop_table";

export type ReferencePhoto = {
  itemId: string;
  photo: Blob;
  source: ReferenceSource;
  /** How alike the app scored it, 0..1, or null when matched by name. */
  similarity: number | null;
  /** Its fingerprint, when this device already took one. Otherwise it is
   *  filled in later by whichever device holds the model. */
  embedding: number[] | null;
};

export type KeepOutcome =
  | { kept: true; path: string; fingerprinted: boolean }
  | { kept: false; reason: "same-picture" | "failed" };

/** Stored pictures are kept to this on their longest side. Enough for any
 *  model to learn from; a phone's 4000px original is not. */
const STORE_DIMENSION = 1024;
const STORE_QUALITY = 0.85;

/** Shrinks a photo to a JPEG no larger than STORE_DIMENSION, or returns it as
 *  it is when it's small enough already or can't be decoded here. */
export async function shrinkForStorage(photo: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(photo);
    const scale = STORE_DIMENSION / Math.max(bitmap.width, bitmap.height);
    if (scale >= 1 && photo.type === "image/jpeg") {
      bitmap.close();
      return photo;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * Math.min(scale, 1)));
    canvas.height = Math.max(1, Math.round(bitmap.height * Math.min(scale, 1)));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((done) =>
      canvas.toBlob(done, "image/jpeg", STORE_QUALITY)
    );
    return blob ?? photo;
  } catch {
    return photo;
  }
}

/** The signed-in person and the theatre they're working in, for pages that
 *  don't already have them. Null when either is missing. */
export async function whoAmI(): Promise<{ userId: string; orgId: string } | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("active_org_id")
    .eq("id", user.id)
    .maybeSingle();
  const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id;
  return orgId ? { userId: user.id, orgId } : null;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Stores one confirmed picture: the file in the item's folder, then the row.
 * If the row can't be written (migration 008 not run, say), the file is
 * taken back out so nothing is left in storage that nothing points at.
 */
export async function keepReferencePhoto(
  who: { userId: string; orgId: string },
  reference: ReferencePhoto
): Promise<KeepOutcome> {
  if (!worthKeepingAsReference(reference.similarity)) {
    return { kept: false, reason: "same-picture" };
  }

  try {
    const supabase = createClient();
    const photo = await shrinkForStorage(reference.photo);
    const extension = EXTENSIONS[photo.type] ?? "jpg";
    const path = `${who.orgId}/${reference.itemId}/ref-${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .upload(path, photo, { contentType: photo.type || "image/jpeg" });
    if (uploadError) return { kept: false, reason: "failed" };

    const embedding =
      reference.embedding && checkEmbedding(reference.embedding) === null
        ? toVectorLiteral(reference.embedding)
        : null;

    const { error } = await supabase.from("item_reference_photos").insert({
      item_id: reference.itemId,
      org_id: who.orgId,
      photo_path: path,
      source: reference.source,
      similarity:
        reference.similarity !== null && Number.isFinite(reference.similarity)
          ? Math.max(0, Math.min(1, reference.similarity))
          : null,
      model: EMBEDDING_MODEL,
      embedding,
      created_by: who.userId,
    });

    if (error) {
      await supabase.storage.from(PHOTOS_BUCKET).remove([path]);
      return { kept: false, reason: "failed" };
    }

    return { kept: true, path, fingerprinted: embedding !== null };
  } catch {
    return { kept: false, reason: "failed" };
  }
}
