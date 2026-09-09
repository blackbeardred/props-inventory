import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  FileField,
  Notice,
  PageHeading,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { DeleteButton } from "@/components/delete-button";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  type ItemRow,
} from "@/lib/inventory";
import { PHOTOS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/supabase/storage";
import { deleteItem, updateItem } from "./actions";

export const metadata: Metadata = {
  title: "Edit item · Props & Costume Inventory",
};

type EditItemPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EditItemPage({
  params,
  searchParams,
}: EditItemPageProps) {
  if (!supabaseConfigured) {
    redirect("/items");
  }

  const { id } = await params;
  const error = first((await searchParams).error);

  const supabase = await createClient();

  const [{ data: item }, { data: locations }] = await Promise.all([
    supabase
      .from("items")
      .select(
        "id, name, category, description, photo_url, quantity, condition, location_id, created_at, auto_tags"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("locations").select("id, name").order("name"),
  ]);

  if (!item) {
    return (
      <>
        <PageHeading title="Item not found" />
        <Notice title="This item isn’t available">
          It may have been deleted, or you may not have access to it.
        </Notice>
      </>
    );
  }

  const typedItem = item as unknown as ItemRow;

  let currentPhotoUrl: string | null = null;
  if (typedItem.photo_url) {
    const { data: signed } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .createSignedUrl(typedItem.photo_url, SIGNED_URL_TTL_SECONDS);
    currentPhotoUrl = signed?.signedUrl ?? null;
  }

  return (
    <>
      <PageHeading title="Edit item" intro={typedItem.name} />

      {error ? (
        <div className="mb-6">
          <Notice title="Couldn’t save this item">{error}</Notice>
        </div>
      ) : null}

      <form action={updateItem} className="max-w-lg space-y-5">
        <input type="hidden" name="itemId" value={typedItem.id} />

        <TextField
          label="Name"
          name="name"
          defaultValue={typedItem.name}
          required
        />

        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Category"
            name="category"
            defaultValue={typedItem.category}
          >
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>

          <TextField
            label="Quantity"
            name="quantity"
            type="number"
            defaultValue={String(typedItem.quantity)}
          />
        </div>

        <TextareaField
          label="Description"
          name="description"
          rows={3}
          defaultValue={typedItem.description ?? ""}
        />

        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Condition"
            name="condition"
            defaultValue={typedItem.condition ?? ""}
          >
            <option value="">Not set</option>
            {Object.entries(CONDITION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Shelf / location"
            name="locationId"
            defaultValue={typedItem.location_id ?? ""}
          >
            <option value="">Unassigned</option>
            {(locations ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </SelectField>
        </div>

        {currentPhotoUrl ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed URL, see items/page.tsx */}
            <img
              src={currentPhotoUrl}
              alt=""
              className="h-16 w-16 rounded object-cover"
            />
            <label className="flex items-center gap-2 font-body text-sm text-muted">
              <input type="checkbox" name="removePhoto" />
              Remove current photo
            </label>
          </div>
        ) : null}

        <FileField
          label={currentPhotoUrl ? "Replace photo" : "Photo"}
          name="photo"
          accept="image/png,image/jpeg,image/webp,image/gif"
          helpText="JPG, PNG, GIF, or WEBP — up to 8MB."
        />

        <TextField
          label="Auto-detected tags"
          name="autoTags"
          defaultValue={(typedItem.auto_tags ?? []).join(", ")}
        />
        <p className="-mt-3 font-body text-xs text-muted">
          Comma-separated. Guessed from the photo (material, color, style) and
          never shown on the items or search list — they only affect what a
          text search matches, so fix anything the AI got wrong. Uploading a
          new photo replaces these with a fresh guess.
        </p>

        <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
      </form>

      <form action={deleteItem} className="mt-10 border-t border-rule pt-6">
        <input type="hidden" name="itemId" value={typedItem.id} />
        <DeleteButton
          confirmMessage={`Delete "${typedItem.name}"? This can’t be undone.`}
        >
          Delete item
        </DeleteButton>
      </form>
    </>
  );
}
