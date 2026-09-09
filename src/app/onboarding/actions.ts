"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function createOrganization(formData: FormData) {
  const fullName = String(formData.get("fullName") ?? "").trim();
  const orgName = String(formData.get("orgName") ?? "").trim();

  if (!fullName || !orgName) {
    return redirect(
      `/onboarding?error=${encodeURIComponent(
        "Your name and an organization name are both required."
      )}`
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/login?next=/onboarding");
  }

  const { error } = await supabase.rpc("create_organization_and_profile", {
    org_name: orgName,
    member_name: fullName,
  });

  if (error) {
    return redirect(`/onboarding?error=${encodeURIComponent(error.message)}`);
  }

  return redirect("/locations");
}

export async function joinOrganization(formData: FormData) {
  const fullName = String(formData.get("joinFullName") ?? "").trim();
  const inviteCode = String(formData.get("inviteCode") ?? "").trim();

  if (!fullName || !inviteCode) {
    return redirect(
      `/onboarding?error=${encodeURIComponent(
        "Your name and an invite code are both required."
      )}`
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/login?next=/onboarding");
  }

  const { error } = await supabase.rpc("join_organization_with_code", {
    p_invite_code: inviteCode,
    member_name: fullName,
  });

  if (error) {
    return redirect(`/onboarding?error=${encodeURIComponent(error.message)}`);
  }

  return redirect("/locations");
}
