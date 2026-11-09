"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NOT_SET_UP, schoolNotSetUp } from "@/lib/school";

export async function createOrganization(formData: FormData) {
  const fullName = String(formData.get("fullName") ?? "").trim();
  const orgName = String(formData.get("orgName") ?? "").trim();
  const isSchool = formData.get("isSchool") === "1";

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

  // p_is_school is only sent for a school, so making an ordinary theater
  // still works before migration 018 is run.
  const { error } = await supabase.rpc("create_organization_and_profile", {
    org_name: orgName,
    member_name: fullName,
    ...(isSchool ? { p_is_school: true } : {}),
  });

  if (error) {
    const message = isSchool && schoolNotSetUp(error) ? NOT_SET_UP : error.message;
    return redirect(`/onboarding?error=${encodeURIComponent(message)}`);
  }

  return redirect("/inventory");
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

  return redirect("/inventory");
}
