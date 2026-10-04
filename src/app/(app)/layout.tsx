import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav, MobileTabBar } from "@/components/app-nav";
import { FingerprintCatchUp } from "@/components/fingerprint-catch-up";
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
        {/* The shell widens only from xl up. Below that nothing changes: a
            phone is already edge to edge, and a tablet reads better narrow.
            The header tracks the same widths so the nav stays in line with
            the content underneath it. */}
        {/* min-h, not h: if the row ever has to wrap, the header grows with
            it. A fixed h-14 let a wrapped nav spill out underneath the page,
            where nothing in it could be tapped. */}
        <div className="mx-auto flex min-h-14 w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-6 py-2 xl:max-w-7xl xl:px-8 2xl:max-w-[96rem]">
          <OrgSwitcher
            memberships={profile.memberships}
            activeOrgId={profile.active_org_id}
          />
          <div className="flex items-center gap-5">
            <AppNav />
            <Link
              href="/account"
              aria-label={`Your account (${displayName})`}
              className="flex min-h-11 min-w-11 items-center justify-center gap-2 font-body text-sm text-muted transition-colors hover:text-foreground"
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
        {/* The extra bottom padding on a phone is the tab bar's height plus
            room to breathe, so the last thing on a page isn't under it. */}
        <div className="mx-auto w-full max-w-5xl px-6 pb-28 pt-8 md:py-12 xl:max-w-7xl xl:px-8 2xl:max-w-[96rem]">
          {children}
        </div>
      </main>
      {/* Catches up photo fingerprints in the background, but only on a device
          that already holds the model — see the component for why. */}
      <FingerprintCatchUp orgId={profile.active_org_id} />
      <MobileTabBar />
    </div>
  );
}
