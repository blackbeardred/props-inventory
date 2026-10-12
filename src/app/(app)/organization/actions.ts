"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function fail(message: string): never {
  redirect(`/theatre?error=${encodeURIComponent(message)}`);
}

export async function regenerateInviteCode() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("regenerate_invite_code");

  if (error) {
    fail(error.message);
  }

  redirect("/theatre#members");
}

/** The longest name rename_organization (migration 012) accepts. */
const MAX_THEATRE_NAME = 100;

/**
 * Renames the theatre that's open. Owners only: the database function
 * checks that, and tidies and limits the name too. Checked here as well
 * only so a plain mistake gets a plain message without a round trip.
 */
export async function renameTheatre(formData: FormData) {
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim();
  if (!name) fail("A theatre needs a name.");
  if (name.length > MAX_THEATRE_NAME) fail(`That name is too long: ${MAX_THEATRE_NAME} characters at most.`);

  const supabase = await createClient();
  const { error } = await supabase.rpc("rename_organization", { new_name: name });

  if (error) {
    // PGRST202: the function isn't there, so migration 012 hasn't been run.
    if (error.code === "PGRST202" || /could not find the function/i.test(error.message)) {
      fail("Renaming isn’t switched on yet: run migration 012 (012_rename_organization.sql) in Supabase, then try again.");
    }
    fail(error.message.replace(/\.?$/, "."));
  }

  // The name shows in the header and the theatre switcher on every page.
  revalidatePath("/", "layout");
  redirect("/theatre?notice=theatre-renamed#members");
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

  redirect("/theatre#members");
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

  redirect("/theatre#members");
}
