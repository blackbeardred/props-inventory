"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function fail(message: string): never {
  redirect(`/organization?error=${encodeURIComponent(message)}`);
}

export async function regenerateInviteCode() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("regenerate_invite_code");

  if (error) {
    fail(error.message);
  }

  redirect("/organization");
}

export async function setMemberRole(formData: FormData) {
  const targetProfileId = String(formData.get("targetProfileId") ?? "");
  const newRole = String(formData.get("newRole") ?? "");

  if (!targetProfileId || !["owner", "member"].includes(newRole)) {
    fail("That role change didn\u2019t include the required fields.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_role", {
    target_profile_id: targetProfileId,
    new_role: newRole,
  });

  if (error) {
    fail(error.message);
  }

  redirect("/organization");
}

export async function removeMember(formData: FormData) {
  const targetProfileId = String(formData.get("targetProfileId") ?? "");

  if (!targetProfileId) {
    fail("That request didn\u2019t include which member to remove.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_member", {
    target_profile_id: targetProfileId,
  });

  if (error) {
    fail(error.message);
  }

  redirect("/organization");
}
