"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/school";

export async function signup(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  // Where to go once signed up, such as a handover link (migration 018).
  // Onboarding otherwise. A path on this site only.
  const next = safeNext(formData.get("next"), "/onboarding");
  const keep = next === "/onboarding" ? "" : `&next=${encodeURIComponent(next)}`;

  if (!email || !password) {
    return redirect(
      `/signup?error=${encodeURIComponent("Email and password are required.")}${keep}`
    );
  }

  if (password !== confirmPassword) {
    return redirect(
      `/signup?error=${encodeURIComponent("Passwords don’t match.")}${keep}`
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return redirect(`/signup?error=${encodeURIComponent(error.message)}${keep}`);
  }

  if (!data.session) {
    // Email confirmation is required on this project — there's no session
    // yet to continue straight into onboarding with.
    return redirect("/signup?notice=check-email");
  }

  return redirect(next);
}
