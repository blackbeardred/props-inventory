import { createClient } from "@/lib/supabase/server";

export type CurrentProfile = {
  org_id: string;
  full_name: string | null;
  role: "owner" | "member";
  organizations: { name: string; invite_code: string | null } | null;
};

/**
 * Fetches the signed-in user (if any) and their profile row (if it exists).
 * A user with no profile yet has signed up but hasn't finished onboarding
 * (creating an organization) — callers use this to decide where to send them.
 */
export async function getUserAndProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, profile: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, full_name, role, organizations(name, invite_code)")
    .eq("id", user.id)
    .maybeSingle();

  return { user, profile: (profile as unknown as CurrentProfile) ?? null };
}
