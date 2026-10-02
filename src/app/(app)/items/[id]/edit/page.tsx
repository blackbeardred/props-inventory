import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Notice,
  PageHeading,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { PhotoField } from "@/components/photo-field";
import { LocationField } from "@/components/location-field";
import type { LocationNode } from "@/lib/locations";
import { DeleteButton } from "@/components/delete-button";
import { ImportDataPanel } from "@/components/import-data-panel";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  type ItemRow,
} from "@/lib/inventory";
import { PHOTOS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/supabase/storage";
import { deleteItem, regenerateTags, updateItem } from "./actions";

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
  const notice = first((await searchParams).notice);

  const supabase = await createClient();

  const [{ data: item }, { data: locations }, { data: openChecks }] = await Promise.all([
    supabase
      .from("items")
      .select(
        "id, name, category, description, photo_url, quantity, condition, location_id, created_at, auto_tags, import_data"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("locations").select("id, name, parent_location_id").order("name"),
    // Every list this item is on. Two different facts come out of it: whether
    // it's out on a show, and whether anyone has actually stood in front of it
    // — and this is the page someone opens when a prop has gone missing.
    supabase
      .from("pull_list_items")
      .select("id, status, check_state, quantity_needed, pull_lists(name, productions(id, name))")
      .eq("item_id", id),
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

  const listRows = ((openChecks ?? []) as unknown as {
    id: string;
    status: string;
    check_state: string | null;
    quantity_needed: number;
    pull_lists: { name: string; productions: { id: string; name: string } | null } | null;
  }[]).filter((row) => row.pull_lists?.productions);

  const pulled = listRows.filter((row) => row.status === "pulled");
  const pulledQuantity = pulled.reduce((total, row) => total + row.quantity_needed, 0);
  const unchecked = listRows.filter((row) => (row.check_state ?? "open") === "open");

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

      {pulled.length > 0 ? (
        <div className="mb-6 rounded-lg border border-rule bg-surface px-4 py-3">
          <p className="font-body text-sm">
            <span
              aria-hidden="true"
              className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full bg-in-use align-[1px]"
            />
            <span className="text-foreground">
              {typedItem.quantity > 1
                ? `${pulledQuantity} of ${typedItem.quantity} pulled for `
                : "Pulled for "}
            </span>
            {pulled.map((row, index) => (
              <span key={row.id}>
                {index > 0 ? ", " : ""}
                <Link
                  href={`/productions/${row.pull_lists!.productions!.id}`}
                  className="text-accent hover:underline"
                >
                  {row.pull_lists!.productions!.name}
                </Link>
              </span>
            ))}
            <span className="text-muted"> — out of storage.</span>
          </p>
        </div>
      ) : null}

      {unchecked.length > 0 ? (
        <div className="mb-6 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3">
          <p className="font-body text-sm font-semibold text-danger-ink">NOT CHECKED</p>
          <p className="mt-1 font-body text-sm text-foreground">
            On the pull list for{" "}
            {unchecked.map((row, index) => (
              <span key={row.id}>
                {index > 0 ? ", " : ""}
                <Link
                  href={`/productions/${row.pull_lists!.productions!.id}/checklist`}
                  className="text-accent hover:underline"
                >
                  {row.pull_lists!.productions!.name}
                </Link>
              </span>
            ))}
            , and nobody has confirmed it in the store yet.
          </p>
        </div>
      ) : null}

      {notice === "tags-regenerated" ? (
        <div className="mb-6">
          <Notice title="Tags regenerated">
            Ran AI detection again on the current photo.
          </Notice>
        </div>
      ) : null}
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

        <PhotoField
          label={currentPhotoUrl ? "Photo" : "Photo"}
          name="photo"
          accept="image/png,image/jpeg,image/webp,image/gif"
          helpText="JPG, PNG, GIF, or WEBP — up to 8MB. Choosing a new one replaces what’s there."
          existingUrl={currentPhotoUrl}
        />

        {currentPhotoUrl ? (
          <label className="flex items-center gap-2 font-body text-sm text-muted">
            <input type="checkbox" name="removePhoto" />
            Remove current photo
          </label>
        ) : null}

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

          <LocationField
            nodes={(locations ?? []) as unknown as LocationNode[]}
            defaultValue={typedItem.location_id ?? ""}
          />
        </div>

        <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
      </form>

      <div className="mt-8 max-w-lg border-t border-rule pt-6">
        <h2 className="font-body text-sm font-medium text-foreground">
          Search tags
        </h2>
        <p className="mt-1 font-body text-xs text-muted">
          Generated from this item’s name, description and photo, and used
          only to decide what a search matches — they’re never shown in the
          items list or in search results. They’re what lets someone find
          this by searching “wood” when nothing here says “wood”.
        </p>

        {(typedItem.auto_tags ?? []).length > 0 ? (
          <p className="mt-3 font-body text-sm text-foreground">
            {(typedItem.auto_tags ?? []).join(", ")}
          </p>
        ) : (
          <p className="mt-3 font-body text-sm text-muted">
            None yet — save this item, or regenerate, to tag it.
          </p>
        )}

        <form action={regenerateTags} className="mt-3">
          <input type="hidden" name="itemId" value={typedItem.id} />
          <SubmitButton pendingText="Regenerating…" variant="ghost">
            Regenerate tags
          </SubmitButton>
        </form>
      </div>

      <ImportDataPanel data={typedItem.import_data} />

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
