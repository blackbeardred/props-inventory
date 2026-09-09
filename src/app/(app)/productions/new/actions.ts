"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function fail(message: string): never {
  redirect(`/productions/new?error=${encodeURIComponent(message)}`);
}

export async function createProduction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const statusRaw = String(formData.get("status") ?? "planning");
  const startDate = String(formData.get("startDate") ?? "").trim();
  const endDate = String(formData.get("endDate") ?? "").trim();

  if (!name) {
    fail("Production name is required.");
  }

  const status = ["planning", "in_run", "closed"].includes(statusRaw)
    ? statusRaw
    : "planning";

  if (startDate && endDate && endDate < startDate) {
    fail("The end date can\u2019t be before the start date.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/productions/new");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    redirect("/onboarding");
  }

  const { data: production, error } = await supabase
    .from("productions")
    .insert({
      org_id: profile.org_id,
      name,
      status,
      start_date: startDate || null,
      end_date: endDate || null,
    })
    .select("id")
    .single();

  if (error || !production) {
    fail(error?.message ?? "Couldn\u2019t create the production.");
  }

  redirect(`/productions/${production.id}`);
}
