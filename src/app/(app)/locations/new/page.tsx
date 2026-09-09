import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Notice,
  PageHeading,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import type { LocationRow } from "@/lib/inventory";
import { createLocation } from "./actions";

export const metadata: Metadata = {
  title: "Add location · Props & Costume Inventory",
};

type NewLocationPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** Nesting depth of a location, walking up parent_location_id. Guards cycles. */
function depthOf(id: string, byId: Map<string, LocationRow>): number {
  let depth = 0;
  let current = byId.get(id);
  const seen = new Set<string>();
  while (current?.parent_location_id && !seen.has(current.id)) {
    seen.add(current.id);
    current = byId.get(current.parent_location_id);
    depth += 1;
  }
  return depth;
}

export default async function NewLocationPage({
  searchParams,
}: NewLocationPageProps) {
  if (!supabaseConfigured) {
    redirect("/locations");
  }

  const error = first((await searchParams).error);

  const supabase = await createClient();
  const { data } = await supabase
    .from("locations")
    .select("id, name, description, parent_location_id, created_at")
    .order("name");
  const locations = (data ?? []) as unknown as LocationRow[];
  const byId = new Map(locations.map((l) => [l.id, l]));

  return (
    <>
      <PageHeading
        title="Add a location"
        intro="A storage room, rack, shelf, or bin — nest it under another location if it lives inside one."
      />

      {error ? (
        <div className="mb-6">
          <Notice title="Couldn’t add this location">{error}</Notice>
        </div>
      ) : null}

      <form action={createLocation} className="max-w-lg space-y-5">
        <TextField label="Name" name="name" required />
        <TextareaField label="Description" name="description" rows={3} />
        <SelectField
          label="Within (optional)"
          name="parentLocationId"
          defaultValue=""
        >
          <option value="">No parent — top level</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {"— ".repeat(depthOf(location.id, byId))}
              {location.name}
            </option>
          ))}
        </SelectField>
        <SubmitButton pendingText="Adding location…">
          Add location
        </SubmitButton>
      </form>
    </>
  );
}
