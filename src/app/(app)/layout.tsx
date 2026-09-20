import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { OrgSwitcher } from "@/components/org-switcher";
import { getUserAndProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AVATARS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/supabase/storage";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, profile } = await getUserAndProfile();

  if (!user) {
    redirect("/login");
  }

  // No profile, or a profile belonging to nothing: they've signed up but
  // haven't joined a theatre yet.
  if (!profile || profile.memberships.length === 0) {
    redirect("/onboarding");
  }

  // Belongs somewhere, but the active organization no longer resolves —
  // they need to pick one before any org-scoped page can show anything.
  if (!profile.organizations) {
    redirect("/account?notice=pick-organization");
  }

  let avatarUrl: string | null = null;
  if (profile.avatar_url) {
    const supabase = await createClient();
    const { data: signed } = await supabase.storage
      .from(AVATARS_BUCKET)
      .createSignedUrl(profile.avatar_url, SIGNED_URL_TTL_SECONDS);
    avatarUrl = signed?.signedUrl ?? null;
  }

  const displayName = profile.full_name?.trim() || user.email || "Account";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-rule">
        <div className="mx-auto flex h-14 w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-6">
          <OrgSwitcher
            memberships={profile.memberships}
            activeOrgId={profile.active_org_id}
          />
          <div className="flex items-center gap-5">
            <AppNav />
            <Link
              href="/account"
              className="flex items-center gap-2 font-body text-sm text-muted transition-colors hover:text-foreground"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL, same reasoning as item photos
                <img
                  src={avatarUrl}
                  alt=""
                  className="h-7 w-7 rounded-full object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft/20 font-body text-xs font-medium text-accent"
                >
                  {initial}
                </span>
              )}
              <span className="hidden sm:inline">{displayName}</span>
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-6 py-12">{children}</div>
      </main>
    </div>
  );
}
