"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function fail(message: string): never {
  redirect(`/locations/new?error=${encodeURIComponent(message)}`);
}

export async function createLocation(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const parentLocationId = String(
    formData.get("parentLocationId") ?? ""
  ).trim();

  if (!name) {
    fail("Location name is required.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/locations/new");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    redirect("/onboarding");
  }

  const { error } = await supabase.from("locations").insert({
    org_id: profile.org_id,
    name,
    description: description || null,
    parent_location_id: parentLocationId || null,
  });

  if (error) {
    fail(error.message);
  }

  redirect("/locations");
}
