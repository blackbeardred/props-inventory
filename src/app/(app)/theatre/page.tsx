import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { KEEP_DAYS } from "@/lib/deleted-records";
import { purgeExpired } from "@/lib/recently-deleted";
import { Badge, Notice, PageHeading } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { RetagAll } from "@/components/retag-all";
import { SubmitButton } from "@/components/submit-button";
import { DeleteButton } from "@/components/delete-button";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { getUserAndProfile } from "@/lib/auth";
import { SettingsSection as Section } from "@/components/settings-section";
import { regenerateInviteCode, removeMember, renameTheatre, setMemberRole } from "../organization/actions";
import { formatDate, pluralize } from "@/lib/inventory";

export const metadata: Metadata = {
  title: "Theatre · Propolis",
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
  "theatre-renamed": {
    title: "Renamed",
    body: "Everyone in the theatre sees the new name from their next page.",
  },
};

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

  const { data: members, error: membersError } = await supabase
    .from("memberships")
    .select("user_id, role, created_at, profiles(full_name)")
    .eq("org_id", profile.active_org_id ?? "")
    .order("created_at");

  const rows = (members ?? []) as unknown as MemberRow[];
  const isOwner = profile.role === "owner";
  const ownerCount = rows.filter((row) => row.role === "owner").length;
  const inviteCode = profile.organizations?.invite_code ?? null;
  // Opened from a tryout link (migration 013): an owner of their own test
  // copy, but with no invite code to hand out and no AI-priced refresh. The
  // sample items come tagged (migration 016), and anything a tester adds is
  // tagged as it's saved.
  const tryout = Boolean(user.is_anonymous);

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
        intro="Who’s here, how people join, and the tools the whole theatre shares."
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
        {/* Members and the invite code. Everything about you rather than
            the theatre (name, picture, sign-in, the theatres you belong to)
            is on /account. */}
        <Section
          id="members"
          title={profile.organizations?.name ?? "Your theatre"}
          intro={`${pluralize(rows.length, "member")}. ${
            isOwner
              ? tryout
                ? "As an owner you can change roles and remove members."
                : "As an owner you can invite people, change roles and remove members."
              : "Owners can invite people and manage who's here."
          }`}
        >
          {isOwner ? (
            <form
              action={renameTheatre}
              data-rename-theatre
              className="mb-5 rounded-lg border border-rule bg-surface px-4 py-3"
            >
              <label htmlFor="theatre-name" className="block font-body text-sm font-medium text-foreground">
                Theatre name
              </label>
              <p className="mt-1 font-body text-sm text-muted">
                The name everyone in this theatre sees. Only owners can change it.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <input
                  id="theatre-name"
                  name="name"
                  required
                  maxLength={100}
                  defaultValue={profile.organizations?.name ?? ""}
                  autoComplete="organization"
                  className="min-h-11 min-w-0 flex-1 basis-56 rounded-md border border-rule bg-background px-3 py-2 font-body text-sm text-foreground outline-none transition-colors focus:border-accent md:min-h-0"
                />
                <SubmitButton variant="ghost" pendingText="Saving…">
                  Rename
                </SubmitButton>
              </div>
            </form>
          ) : null}

          {isOwner && !tryout ? (
            <div data-invite-code className="mb-5 rounded-lg border border-rule bg-surface px-4 py-3">
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
            <Link
              href="/items/training-set"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface md:min-h-0"
            >
              Training set
            </Link>
          </div>
        </Section>

        <Section
          id="tags"
          title="Search tags"
          intro="Every item gets hidden tags for what it is, what it’s made of and its colours, from its photo and its words, so a search for “wood” or “red” finds it even when nobody wrote that down. New and edited items are tagged as they’re saved, and anything untagged is filled in on its own."
        >
          {tryout ? null : isOwner ? (
            <>
              <p className="mb-3 font-body text-sm text-muted">
                Refreshing re-tags every item with the latest tagging: about 30 cents per 100 items.
              </p>
              <RetagAll />
            </>
          ) : (
            <p className="font-body text-sm text-muted">An owner can refresh every item’s tags here.</p>
          )}
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

        <p className="border-t border-rule pt-8 font-body text-sm text-muted">
          Your name, picture, sign-in and the theatres you belong to are under{" "}
          <Link
            href="/account"
            className="-my-3 inline-block py-3 text-accent-ink underline underline-offset-2"
          >
            Your account
          </Link>
          .
        </p>
      </div>
    </>
  );
}
