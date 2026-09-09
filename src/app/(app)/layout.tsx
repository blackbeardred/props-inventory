import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { getUserAndProfile } from "@/lib/auth";
import { logout } from "@/app/actions";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, profile } = await getUserAndProfile();

  if (!user) {
    redirect("/login");
  }

  if (!profile) {
    redirect("/onboarding");
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-rule">
        <div className="mx-auto flex h-14 w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-6">
          <Link
            href="/"
            className="font-display text-sm text-muted transition-colors hover:text-foreground"
          >
            {profile.organizations?.name ?? "Props & Costume Inventory"}
          </Link>
          <div className="flex items-center gap-5">
            <AppNav />
            {profile.role === "owner" && profile.organizations?.invite_code ? (
              <span
                title="Share this code so a teammate can join your organization from the sign-up page."
                className="hidden font-body text-xs text-muted sm:inline"
              >
                Invite code:{" "}
                <span className="text-foreground">
                  {profile.organizations.invite_code}
                </span>
              </span>
            ) : null}
            <form action={logout}>
              <button
                type="submit"
                className="font-body text-sm text-muted transition-colors hover:text-foreground"
              >
                Log out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-6 py-12">{children}</div>
      </main>
    </div>
  );
}
