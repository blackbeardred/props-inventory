"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

/**
 * Signs out and goes straight to log in, for someone with more than one
 * account (their own and a theater's shared one, say). The login page says
 * they've been signed out, and its form is empty for the other account.
 */
export async function switchAccount() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login?switched=1");
}
