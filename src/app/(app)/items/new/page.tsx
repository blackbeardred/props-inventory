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
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { CATEGORY_LABELS, CONDITION_LABELS } from "@/lib/inventory";
import { createItem } from "./actions";

export const metadata: Metadata = {
  title: "Add item · Props & Costume Inventory",
};

type NewItemPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewItemPage({
  searchParams,
}: NewItemPageProps) {
  if (!supabaseConfigured) {
    redirect("/items");
  }

  const error = first((await searchParams).error);

  const supabase = await createClient();
  const { data: locations } = await supabase
    .from("locations")
    .select("id, name")
    .order("name");

  return (
    <>
      <PageHeading
        title="Add an item"
        intro="A prop or costume, where it lives, and (optionally) a photo."
      />

      {error ? (
        <div className="mb-6">
          <Notice title="Couldn’t add this item">{error}</Notice>
        </div>
      ) : null}

      <form action={createItem} className="max-w-lg space-y-5">
        <TextField label="Name" name="name" required />

        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Category" name="category" defaultValue="prop">
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
            defaultValue="1"
          />
        </div>

        <TextareaField label="Description" name="description" rows={3} />

        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Condition" name="condition" defaultValue="">
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
            defaultValue=""
          >
            <option value="">Unassigned</option>
            {(locations ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </SelectField>
        </div>

        <FileField
          label="Photo"
          name="photo"
          accept="image/png,image/jpeg,image/webp,image/gif"
          helpText="JPG, PNG, GIF, or WEBP — up to 8MB."
        />

        <SubmitButton pendingText="Adding item…">Add item</SubmitButton>
      </form>
    </>
  );
}
