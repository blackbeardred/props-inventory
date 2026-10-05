import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { KEEP_DAYS } from "@/lib/deleted-records";
import { purgeExpired } from "@/lib/recently-deleted";
import {
  Badge,
  FileField,
  Notice,
  PageHeading,
  TextField,
} from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { SubmitButton } from "@/components/submit-button";
import { DeleteButton } from "@/components/delete-button";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { getUserAndProfile } from "@/lib/auth";
import { AVATARS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/supabase/storage";
import { logout } from "@/app/actions";
import { InstallApp } from "@/components/install-app";
import {
  joinOrganization,
  leaveOrganization,
  switchOrganization,
  updateEmail,
  updatePassword,
  updateProfile,
} from "../account/actions";
import { regenerateInviteCode, removeMember, setMemberRole } from "../organization/actions";
import { formatDate, pluralize } from "@/lib/inventory";

export const metadata: Metadata = {
  title: "Theatre · Props & Costume Inventory",
};

// A member of the current theatre. The person lives in profiles; their role
// here lives in memberships, so the list reads the join.
type MemberRow = {
  user_id: string;
  role: "owner" | "member";
  created_at: string;
  profiles: { full_name: string | null } | null;
};

type TheatrePageProps = {
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

function Section({
  id,
  title,
  intro,
  children,
}: {
  id?: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-rule pt-8">
      <h2 className="font-display text-xl">{title}</h2>
      {intro ? (
        <p className="mt-1 max-w-xl font-body text-sm text-muted">{intro}</p>
      ) : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default async function TheatrePage({ searchParams }: TheatrePageProps) {
  if (!supabaseConfigured) {
    redirect("/");
  }

  const params = await searchParams;
  const error = first(params.error);
  const notice = first(params.notice);

  const { user, profile } = await getUserAndProfile();

  if (!user) {
    redirect("/login?next=/theatre");
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

  const { data: members, error: membersError } = await supabase
    .from("memberships")
    .select("user_id, role, created_at, profiles(full_name)")
    .eq("org_id", profile.active_org_id ?? "")
    .order("created_at");

  const rows = (members ?? []) as unknown as MemberRow[];
  const isOwner = profile.role === "owner";
  const ownerCount = rows.filter((row) => row.role === "owner").length;
  const inviteCode = profile.organizations?.invite_code ?? null;

  const activeNotice = notice ? NOTICES[notice] : undefined;

  // Anything past its 30 days is cleared whenever Theatre or Recently
  // deleted is opened, so old photos don't pile up in storage. The count is
  // null when migration 007 hasn't been run: the link still goes to the page,
  // which says so.
  await purgeExpired(supabase);
  const { count: deletedCount } = await supabase
    .from("deleted_records")
    .select("id", { count: "exact", head: true });

  return (
    <>
      <PageHeading
        title="Theatre"
        intro="Who’s here, the theatres you belong to, and your own sign-in details."
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
        {/* Members and the invite code, from the old Organization page. The
            code used to show in two places, here and on Account; it's here
            only now. */}
        <Section
          id="members"
          title={profile.organizations?.name ?? "Your theatre"}
          intro={`${pluralize(rows.length, "member")}. ${
            isOwner
              ? "As an owner you can invite people, change roles and remove members."
              : "Owners can invite people and manage who's here."
          }`}
        >
          {isOwner ? (
            <div className="mb-5 rounded-lg border border-rule bg-surface px-4 py-3">
              <p className="font-body text-sm font-medium text-foreground">Invite code</p>
              <p className="mt-1 font-body text-sm text-muted">
                Anyone with it can join as a member, from the sign-up page.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="rounded-md border border-rule bg-background px-3 py-1.5 font-mono text-sm tracking-wider text-foreground">
                  {inviteCode ?? "Not set"}
                </span>
                {inviteCode ? <CopyButton text={inviteCode} /> : null}
                <form action={regenerateInviteCode}>
                  <SubmitButton variant="ghost" pendingText="Generating…">
                    Generate new code
                  </SubmitButton>
                </form>
              </div>
            </div>
          ) : null}

          {membersError ? (
            <Notice title="Couldn’t load members">{membersError.message}</Notice>
          ) : (
            // A list rather than a table: a table scrolled sideways on a
            // phone and hid the buttons at the end of each row.
            <ul className="divide-y divide-rule rounded-lg border border-rule">
              {rows.map((member) => {
                const isSelf = member.user_id === user.id;
                const isLastOwner = member.role === "owner" && ownerCount <= 1;
                return (
                  <li key={member.user_id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-body text-sm text-foreground">
                        {member.profiles?.full_name || "Unnamed member"}
                        {isSelf ? <span className="ml-1.5 text-muted">(you)</span> : null}
                      </span>
                      <Badge tone={member.role === "owner" ? "accent" : "neutral"}>
                        {member.role === "owner" ? "Owner" : "Member"}
                      </Badge>
                      <span className="font-mono text-[11px] text-muted">
                        joined {formatDate(member.created_at)}
                      </span>
                    </div>
                    {isOwner && !isSelf ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <form action={setMemberRole}>
                          <input type="hidden" name="targetProfileId" value={member.user_id} />
                          <input
                            type="hidden"
                            name="newRole"
                            value={member.role === "owner" ? "member" : "owner"}
                          />
                          <SubmitButton variant="ghost" pendingText="Saving…">
                            {member.role === "owner" ? "Demote to member" : "Promote to owner"}
                          </SubmitButton>
                        </form>
                        {!(member.role === "owner" && isLastOwner) ? (
                          <form action={removeMember}>
                            <input type="hidden" name="targetProfileId" value={member.user_id} />
                            <DeleteButton
                              confirmMessage={`Remove ${member.profiles?.full_name || "this member"} from your theatre?`}
                            >
                              Remove
                            </DeleteButton>
                          </form>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section
          id="photos"
          title="Recognising photos"
          intro="Each item photo gets a visual fingerprint, so a picture of the prop table can be matched against what you own."
        >
          <div className="flex flex-wrap gap-3">
            <Link
              href="/items/fingerprints"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface md:min-h-0"
            >
              Photo fingerprints
            </Link>
            <Link
              href="/items/lookalike"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface md:min-h-0"
            >
              Find an item by photo
            </Link>
          </div>
        </Section>

        <Section
          id="deleted"
          title="Recently deleted"
          intro={`Items, places, productions and pull lists wait here for ${KEEP_DAYS} days after they're deleted, in case you want them back.`}
        >
          <Link
            href="/theatre/deleted"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface md:min-h-0"
          >
            Recently deleted
            {deletedCount ? (
              <span className="rounded-full bg-foreground/[0.08] px-1.5 font-body text-xs text-muted">
                {deletedCount}
              </span>
            ) : null}
          </Link>
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

        <Section title="This device">
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
      </div>
    </>
  );
}
