import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Notice,
  PageHeading,
  TextField,
  TextareaField,
} from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import type { LocationRow } from "@/lib/inventory";
import type { LocationNode } from "@/lib/locations";
import { LocationInput } from "@/components/location-input";
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

export default async function NewLocationPage({
  searchParams,
}: NewLocationPageProps) {
  if (!supabaseConfigured) {
    redirect("/inventory");
  }

  const params = await searchParams;
  const error = first(params.error);
  // "+ Add a shelf or box in …" from inside a place in Inventory.
  const parent = first(params.parent) ?? "";

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
        <LocationInput
          name="parentLocationId"
          nodes={locations as unknown as LocationNode[]}
          defaultValue={byId.has(parent) ? parent : ""}
          label="Inside"
          noneLabel="Nothing — it’s a room of its own"
        />
        <SubmitButton pendingText="Adding location…">
          Add location
        </SubmitButton>
      </form>
    </>
  );
}
