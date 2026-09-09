"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { LocationRow } from "@/lib/inventory";

function fail(locationId: string, message: string): never {
  redirect(`/locations/${locationId}/edit?error=${encodeURIComponent(message)}`);
}

/** All descendant ids of `id` within `rows` (self excluded), guarding cycles. */
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
    const next = queue.shift()!;
    if (result.has(next)) continue;
    result.add(next);
    queue.push(...(children.get(next) ?? []));
  }
  return result;
}

export async function updateLocation(formData: FormData) {
  const locationId = String(formData.get("locationId") ?? "");
  if (!locationId) {
    redirect("/locations");
  }

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const parentLocationId = String(
    formData.get("parentLocationId") ?? ""
  ).trim();

  if (!name) {
    fail(locationId, "Location name is required.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/locations/${locationId}/edit`);
  }

  if (parentLocationId) {
    if (parentLocationId === locationId) {
      fail(locationId, "A location can\u2019t be nested inside itself.");
    }

    const { data: allLocations } = await supabase
      .from("locations")
      .select("id, name, description, parent_location_id, created_at");
    const rows = (allLocations ?? []) as unknown as LocationRow[];

    if (descendantIds(locationId, rows).has(parentLocationId)) {
      fail(
        locationId,
        "A location can\u2019t be nested inside one of its own sub-locations."
      );
    }
  }

  const { error } = await supabase
    .from("locations")
    .update({
      name,
      description: description || null,
      parent_location_id: parentLocationId || null,
    })
    .eq("id", locationId);

  if (error) {
    fail(locationId, error.message);
  }

  redirect("/locations");
}

export async function deleteLocation(formData: FormData) {
  const locationId = String(formData.get("locationId") ?? "");
  if (!locationId) {
    redirect("/locations");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("locations")
    .delete()
    .eq("id", locationId);

  if (error) {
    redirect(
      `/locations/${locationId}/edit?error=${encodeURIComponent(error.message)}`
    );
  }

  redirect("/locations");
}
