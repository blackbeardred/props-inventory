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
import { DeleteButton } from "@/components/delete-button";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import type { LocationRow } from "@/lib/inventory";
import { deleteLocation, updateLocation } from "./actions";

export const metadata: Metadata = {
  title: "Edit location · Props & Costume Inventory",
};

type EditLocationPageProps = {
  params: Promise<{ id: string }>;
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

/** All descendant ids of `id` (self excluded) — these can’t become its parent. */
function descendantIds(id: string, rows: LocationRow[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parent_location_id) continue;
    const list = children.get(row.parent_location_id) ?? [];
    list.push(row.id);
    children.set(row.parent_location_id, list);
  }

  const result = new Set<string>();
  const queue = [...(children.get(id) ?? [])];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    if (result.has(next)) continue;
    result.add(next);
    queue.push(...(children.get(next) ?? []));
  }
  return result;
}

export default async function EditLocationPage({
  params,
  searchParams,
}: EditLocationPageProps) {
  if (!supabaseConfigured) {
    redirect("/locations");
  }

  const { id } = await params;
  const error = first((await searchParams).error);

  const supabase = await createClient();

  const [{ data: location }, { data: allLocations }, { data: itemCountRows }] =
    await Promise.all([
      supabase
        .from("locations")
        .select("id, name, description, parent_location_id, created_at")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("locations")
        .select("id, name, description, parent_location_id, created_at")
        .order("name"),
      supabase.from("items").select("id").eq("location_id", id),
    ]);

  if (!location) {
    return (
      <>
        <PageHeading title="Location not found" />
        <Notice title="This location isn’t available">
          It may have been deleted, or you may not have access to it.
        </Notice>
      </>
    );
  }

  const typedLocation = location as unknown as LocationRow;
  const rows = (allLocations ?? []) as unknown as LocationRow[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const blockedParentIds = descendantIds(typedLocation.id, rows);
  const itemCount = (itemCountRows ?? []).length;

  const selectableLocations = rows.filter(
    (row) => row.id !== typedLocation.id && !blockedParentIds.has(row.id)
  );

  return (
    <>
      <PageHeading title="Edit location" intro={typedLocation.name} />

      {error ? (
        <div className="mb-6">
          <Notice title="Couldn’t save this location">{error}</Notice>
        </div>
      ) : null}

      <form action={updateLocation} className="max-w-lg space-y-5">
        <input type="hidden" name="locationId" value={typedLocation.id} />

        <TextField
          label="Name"
          name="name"
          defaultValue={typedLocation.name}
          required
        />
        <TextareaField
          label="Description"
          name="description"
          rows={3}
          defaultValue={typedLocation.description ?? ""}
        />
        <SelectField
          label="Within (optional)"
          name="parentLocationId"
          defaultValue={typedLocation.parent_location_id ?? ""}
        >
          <option value="">No parent — top level</option>
          {selectableLocations.map((option) => (
            <option key={option.id} value={option.id}>
              {"— ".repeat(depthOf(option.id, byId))}
              {option.name}
            </option>
          ))}
        </SelectField>

        <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
      </form>

      <form
        action={deleteLocation}
        className="mt-10 border-t border-rule pt-6"
      >
        <input type="hidden" name="locationId" value={typedLocation.id} />
        <p className="mb-3 font-body text-sm text-muted">
          {itemCount > 0
            ? `${itemCount} item${itemCount === 1 ? "" : "s"} stored here will become unassigned.`
            : "No items are stored here."}
        </p>
        <DeleteButton
          confirmMessage={`Delete "${typedLocation.name}"? Any items stored here become unassigned, and any sub-locations move to the top level. This can’t be undone.`}
        >
          Delete location
        </DeleteButton>
      </form>
    </>
  );
}
