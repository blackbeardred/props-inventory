"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signup(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!email || !password) {
    return redirect(
      `/signup?error=${encodeURIComponent("Email and password are required.")}`
    );
  }

  if (password !== confirmPassword) {
    return redirect(
      `/signup?error=${encodeURIComponent("Passwords don’t match.")}`
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  }

  if (!data.session) {
    // Email confirmation is required on this project — there's no session
    // yet to continue straight into onboarding with.
    return redirect("/signup?notice=check-email");
  }

  return redirect("/onboarding");
}
