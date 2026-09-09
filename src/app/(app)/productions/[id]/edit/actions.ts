"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function fail(productionId: string, message: string): never {
  redirect(
    `/productions/${productionId}/edit?error=${encodeURIComponent(message)}`
  );
}

export async function updateProduction(formData: FormData) {
  const productionId = String(formData.get("productionId") ?? "");
  if (!productionId) {
    redirect("/productions");
  }

  const name = String(formData.get("name") ?? "").trim();
  const statusRaw = String(formData.get("status") ?? "planning");
  const startDate = String(formData.get("startDate") ?? "").trim();
  const endDate = String(formData.get("endDate") ?? "").trim();

  if (!name) {
    fail(productionId, "Production name is required.");
  }

  const status = ["planning", "in_run", "closed"].includes(statusRaw)
    ? statusRaw
    : "planning";

  if (startDate && endDate && endDate < startDate) {
    fail(productionId, "The end date can\u2019t be before the start date.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("productions")
    .update({
      name,
      status,
      start_date: startDate || null,
      end_date: endDate || null,
    })
    .eq("id", productionId);

  if (error) {
    fail(productionId, error.message);
  }

  redirect(`/productions/${productionId}`);
}

export async function deleteProduction(formData: FormData) {
  const productionId = String(formData.get("productionId") ?? "");
  if (!productionId) {
    redirect("/productions");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("productions")
    .delete()
    .eq("id", productionId);

  if (error) {
    redirect(
      `/productions/${productionId}/edit?error=${encodeURIComponent(error.message)}`
    );
  }

  redirect("/productions");
}
