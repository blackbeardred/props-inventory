import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import {
  Badge,
  FileField,
  Notice,
  PageHeading,
  TextField,
} from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { DeleteButton } from "@/components/delete-button";
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
  title: "Account · Props & Costume Inventory",
};

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
    body: "You no longer have access to that organization’s inventory.",
  },
  "pick-organization": {
    title: "Choose an organization",
    body: "You belong to more than one, but none is currently selected. Pick one below to carry on.",
  },
};

function Section({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-rule pt-8">
      <h2 className="font-display text-xl">{title}</h2>
      {intro ? (
        <p className="mt-1 max-w-xl font-body text-sm text-muted">{intro}</p>
      ) : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

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
        title="Account"
        intro="Your sign-in details, how you appear to the rest of the company, and which organizations you belong to."
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

        <Section title="Password">
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

        <Section
          title="Organizations"
          intro="You can belong to several theatres. The one marked current is what every other page shows."
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

                  {isActive && membership.role === "owner" ? (
                    <p className="mt-3 border-t border-rule pt-3 font-body text-xs text-muted">
                      Invite code:{" "}
                      <span className="text-foreground">
                        {membership.organizations?.invite_code ?? "Not set"}
                      </span>{" "}
                      — share it so a colleague can join. As an owner you can
                      regenerate it, and manage members, on the{" "}
                      <a href="/organization" className="text-accent hover:underline">
                        Organization
                      </a>{" "}
                      page.
                    </p>
                  ) : null}
                </li>
              );
            })}
            {profile.memberships.length === 0 ? (
              <li className="rounded-lg border border-dashed border-rule px-4 py-6 text-center font-body text-sm text-muted">
                You don’t belong to any organization yet.
              </li>
            ) : null}
          </ul>

          <form action={joinOrganization} className="mt-6 space-y-5">
            <TextField
              label="Join another with an invite code"
              name="inviteCode"
              autoComplete="off"
              required
            />
            <SubmitButton pendingText="Joining…" variant="ghost">
              Join organization
            </SubmitButton>
          </form>
        </Section>

        <Section title="Signing out">
          <form action={logout}>
            <SubmitButton pendingText="Signing out…" variant="ghost">
              Log out
            </SubmitButton>
          </form>
        </Section>
      </div>
    </>
  );
}
