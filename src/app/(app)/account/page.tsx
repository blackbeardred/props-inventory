import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge, FileField, Notice, PageHeading, TextField } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { DeleteButton } from "@/components/delete-button";
import { SettingsSection as Section } from "@/components/settings-section";
import { InstallApp } from "@/components/install-app";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { getUserAndProfile } from "@/lib/auth";
import { AVATARS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/supabase/storage";
import { logout } from "@/app/actions";
import {
  joinOrganization,
  leaveOrganization,
  switchOrganization,
  updateEmail,
  updatePassword,
  updateProfile,
} from "./actions";

export const metadata: Metadata = {
  title: "Your account · Propolis",
};

/*
 * Everything about you rather than the theatre: how you appear, how you sign
 * in, which theatres you belong to, and this device. It shared one long page
 * with the theatre's own settings until Oct 2026; the theatre's members,
 * invite code and shared tools are on /theatre.
 */

type AccountPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const NOTICES: Record<string, { title: string; body: string }> = {
  "profile-saved": {
    title: "Saved",
    body: "Your name and picture are up to date.",
  },
  "email-pending": {
    title: "Check your inbox",
    body: "We’ve sent a confirmation link. Your address won’t change until you click it, so keep signing in with the old one until then.",
  },
  "password-changed": {
    title: "Password changed",
    body: "Use the new one next time you sign in.",
  },
  "left-organization": {
    title: "You’ve left",
    body: "You no longer have access to that theatre’s inventory.",
  },
  "pick-organization": {
    title: "Choose a theatre",
    body: "You belong to more than one, but none is currently selected. Pick one below to carry on.",
  },
};

export default async function AccountPage({ searchParams }: AccountPageProps) {
  if (!supabaseConfigured) {
    redirect("/");
  }

  const params = await searchParams;
  const error = first(params.error);
  const notice = first(params.notice);

  const { user, profile } = await getUserAndProfile();

  if (!user) {
    redirect("/login?next=/account");
  }

  if (!profile) {
    redirect("/onboarding");
  }

  const supabase = await createClient();

  let avatarUrl: string | null = null;
  if (profile.avatar_url) {
    const { data: signed } = await supabase.storage
      .from(AVATARS_BUCKET)
      .createSignedUrl(profile.avatar_url, SIGNED_URL_TTL_SECONDS);
    avatarUrl = signed?.signedUrl ?? null;
  }

  const activeNotice = notice ? NOTICES[notice] : undefined;

  return (
    <>
      <PageHeading
        title="Your account"
        intro="How you appear, how you sign in, and the theatres you belong to."
      />

      {activeNotice ? (
        <div className="mb-6">
          <Notice title={activeNotice.title}>{activeNotice.body}</Notice>
        </div>
      ) : null}
      {error ? (
        <div className="mb-6">
          <Notice title="That didn’t go through">{error}</Notice>
        </div>
      ) : null}

      <div className="max-w-lg space-y-10">
        <Section
          id="you"
          title="How you appear"
          intro="Your name and picture show up on the members list and anywhere your work is attributed."
        >
          <form action={updateProfile} className="space-y-5">
            <div className="flex items-center gap-4">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL, same reasoning as item photos
                <img
                  src={avatarUrl}
                  alt=""
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                <div className="h-16 w-16 rounded-full border border-dashed border-rule" />
              )}
              {avatarUrl ? (
                <label className="flex items-center gap-2 font-body text-sm text-muted">
                  <input type="checkbox" name="removeAvatar" />
                  Remove current picture
                </label>
              ) : null}
            </div>

            <TextField
              label="Display name"
              name="fullName"
              defaultValue={profile.full_name ?? ""}
              autoComplete="name"
              required
            />

            <FileField
              label={avatarUrl ? "Replace picture" : "Profile picture"}
              name="avatar"
              accept="image/png,image/jpeg,image/webp"
              helpText="JPG, PNG, or WEBP — up to 4MB."
            />

            <SubmitButton pendingText="Saving…">Save</SubmitButton>
          </form>
        </Section>

        <Section
          id="theatres"
          title="Theatres you belong to"
          intro="You can belong to several. The one marked current is what every page shows."
        >
          <ul className="space-y-3">
            {profile.memberships.map((membership) => {
              const isActive = membership.org_id === profile.active_org_id;
              return (
                <li
                  key={membership.org_id}
                  className="rounded-lg border border-rule px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-body text-sm text-foreground">
                        {membership.organizations?.name ?? "Unnamed organization"}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <Badge
                          tone={membership.role === "owner" ? "accent" : "muted"}
                        >
                          {membership.role === "owner" ? "Owner" : "Member"}
                        </Badge>
                        {isActive ? <Badge tone="success">Current</Badge> : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isActive ? null : (
                        <form action={switchOrganization}>
                          <input
                            type="hidden"
                            name="orgId"
                            value={membership.org_id}
                          />
                          <SubmitButton variant="ghost" pendingText="Switching…">
                            Switch to this
                          </SubmitButton>
                        </form>
                      )}
                      <form action={leaveOrganization}>
                        <input
                          type="hidden"
                          name="orgId"
                          value={membership.org_id}
                        />
                        <DeleteButton
                          confirmMessage={`Leave ${membership.organizations?.name ?? "this organization"}? You'll lose access to its inventory until someone invites you back.`}
                        >
                          Leave
                        </DeleteButton>
                      </form>
                    </div>
                  </div>
                </li>
              );
            })}
            {profile.memberships.length === 0 ? (
              <li className="rounded-lg border border-dashed border-rule px-4 py-6 text-center font-body text-sm text-muted">
                You don’t belong to a theatre yet.
              </li>
            ) : null}
          </ul>

          <form action={joinOrganization} className="mt-6 space-y-5">
            <TextField
              label="Join another theatre with its invite code"
              name="inviteCode"
              autoComplete="off"
              required
            />
            <SubmitButton pendingText="Joining…" variant="ghost">
              Join a theatre
            </SubmitButton>
          </form>
        </Section>

        <Section
          id="email"
          title="Email address"
          intro="You sign in with this, and password resets go here."
        >
          <p className="mb-4 font-body text-sm">
            Currently{" "}
            <span className="text-foreground">{user.email ?? "unknown"}</span>
          </p>
          <form action={updateEmail} className="space-y-5">
            <TextField
              label="New email address"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
            <SubmitButton pendingText="Sending…" variant="ghost">
              Send confirmation link
            </SubmitButton>
          </form>
        </Section>

        <Section id="password" title="Password">
          <form action={updatePassword} className="space-y-5">
            <TextField
              label="New password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
            />
            <TextField
              label="Confirm new password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
            />
            <SubmitButton pendingText="Changing…" variant="ghost">
              Change password
            </SubmitButton>
          </form>
        </Section>

        <Section id="device" title="This device">
          <InstallApp />
        </Section>

        <Section title="Signing out">
          <p className="mb-3 font-body text-sm text-muted">
            Logging out also forgets the pages this device kept for offline use.
          </p>
          <form action={logout}>
            <SubmitButton pendingText="Signing out…" variant="ghost">
              Log out
            </SubmitButton>
          </form>
        </Section>

        <p className="border-t border-rule pt-8 font-body text-sm text-muted">
          Members, the invite code and the theatre&rsquo;s name are on the{" "}
          <Link
            href="/theatre"
            className="-my-3 inline-block py-3 text-accent-ink underline underline-offset-2"
          >
            Theatre
          </Link>{" "}
          page.
        </p>
      </div>
    </>
  );
}
