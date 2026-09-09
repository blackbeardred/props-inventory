"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextParam = String(formData.get("next") ?? "/locations");
  const next = nextParam.startsWith("/") ? nextParam : "/locations";

  if (!email || !password) {
    return redirect(
      `/login?error=${encodeURIComponent(
        "Email and password are required."
      )}&next=${encodeURIComponent(next)}`
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return redirect(
      `/login?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(
        next
      )}`
    );
  }

  return redirect(next);
}
