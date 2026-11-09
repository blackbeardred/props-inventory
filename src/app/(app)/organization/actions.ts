"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NOT_SET_UP, isHandoverToken, schoolNotSetUp } from "@/lib/school";

function fail(message: string): never {
  redirect(`/theatre?error=${encodeURIComponent(message)}`);
}

export async function regenerateInviteCode() {
  const supabase = await createClient();
  // A test copy (tryout link, migration 013) has no invite code: it's one
  // tester's own, and a code passed on would let others sign up into it.
  const { data: auth } = await supabase.auth.getUser();
  if (auth.user?.is_anonymous) fail("A test copy can’t have an invite code.");
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

/**
 * School mode on or off (migration 018). The database does the checking:
 * owners only, never a test copy, and turning it on only with exactly one
 * account (it names who to remove otherwise). Turning it on clears the
 * invite code; turning it off cancels any handover link.
 */
export async function setSchoolMode(formData: FormData) {
  const on = formData.get("school") === "on";
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_school_mode", { p_school: on });
  if (error) fail(schoolNotSetUp(error) ? NOT_SET_UP : error.message);
  revalidatePath("/", "layout");
  redirect(`/theatre?notice=${on ? "school-on" : "school-off"}`);
}

export type HandoverState = { token: string | null; madeAt: string | null; error: string | null };

/**
 * A one-time link for the next teacher. Making one replaces any earlier
 * link, which stops working. The link is shown once, on the page that made
 * it: nobody can read the stored links back, by design.
 */
export async function createHandover(prev: HandoverState, formData: FormData): Promise<HandoverState> {
  void prev;
  void formData;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_school_handover");
  if (error) return { token: null, madeAt: null, error: schoolNotSetUp(error) ? NOT_SET_UP : error.message };
  if (typeof data !== "string" || !isHandoverToken(data)) {
    return { token: null, madeAt: null, error: "The link didn’t come back. Try again." };
  }
  return { token: data, madeAt: new Date().toISOString(), error: null };
}

export async function cancelHandover() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_school_handover");
  if (error) fail(schoolNotSetUp(error) ? NOT_SET_UP : error.message);
  redirect("/theatre?notice=handover-cancelled#handover");
}
