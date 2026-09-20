import { createClient } from "@/lib/supabase/server";

export type OrgSummary = { name: string; invite_code: string | null } | null;

export type MembershipSummary = {
  org_id: string;
  role: "owner" | "member";
  organizations: OrgSummary;
};

export type CurrentProfile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  /** The organization the person is currently working in, if any. */
  active_org_id: string | null;
  /** Role in the active organization. Null when there isn't one. */
  role: "owner" | "member" | null;
  /** The active organization itself. Null when there isn't one. */
  organizations: OrgSummary;
  /** Every organization this person belongs to, oldest membership first. */
  memberships: MembershipSummary[];
};

/**
 * Fetches the signed-in user (if any) and their profile.
 *
 * A profile is the *person*; `memberships` is which theatres they belong to.
 * Someone with a profile but no memberships has signed up without joining
 * anywhere yet — callers send them to /onboarding. Someone with memberships
 * but no resolvable active organization needs to pick one, which happens on
 * /account.
 */
export async function getUserAndProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, profile: null };
  }

  const [{ data: profileRow }, { data: membershipRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, avatar_url, active_org_id")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("memberships")
      .select("org_id, role, organizations(name, invite_code)")
      .eq("user_id", user.id)
      .order("created_at"),
  ]);

  if (!profileRow) {
    return { user, profile: null };
  }

  const row = profileRow as unknown as {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
    active_org_id: string | null;
  };
  const memberships = (membershipRows ?? []) as unknown as MembershipSummary[];
  const active = memberships.find((m) => m.org_id === row.active_org_id) ?? null;

  const profile: CurrentProfile = {
    ...row,
    role: active?.role ?? null,
    organizations: active?.organizations ?? null,
    memberships,
  };

  return { user, profile };
}
