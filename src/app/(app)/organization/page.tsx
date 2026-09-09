import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Badge,
  DataTable,
  Notice,
  PageHeading,
} from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { DeleteButton } from "@/components/delete-button";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { getUserAndProfile } from "@/lib/auth";
import { formatDate, pluralize } from "@/lib/inventory";
import { regenerateInviteCode, removeMember, setMemberRole } from "./actions";

export const metadata: Metadata = {
  title: "Organization · Props & Costume Inventory",
};

type MemberRow = {
  id: string;
  full_name: string | null;
  role: "owner" | "member";
  created_at: string;
};

type OrganizationPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OrganizationPage({
  searchParams,
}: OrganizationPageProps) {
  if (!supabaseConfigured) {
    redirect("/locations");
  }

  const error = first((await searchParams).error);

  const { user, profile } = await getUserAndProfile();
  if (!user || !profile) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data: members, error: membersError } = await supabase
    .from("profiles")
    .select("id, full_name, role, created_at")
    .order("created_at");

  const rows = (members ?? []) as unknown as MemberRow[];
  const isOwner = profile.role === "owner";
  const ownerCount = rows.filter((row) => row.role === "owner").length;

  return (
    <>
      <PageHeading
        title="Organization"
        intro={`${profile.organizations?.name ?? "Your organization"} \u2014 ${pluralize(rows.length, "member")}.`}
      />

      {error ? (
        <div className="mb-6">
          <Notice title="That didn’t go through">{error}</Notice>
        </div>
      ) : null}

      {isOwner ? (
        <div className="mb-8 rounded-lg border border-rule bg-surface px-5 py-4">
          <p className="font-body text-sm font-medium text-foreground">
            Invite code
          </p>
          <p className="mt-1 font-body text-sm text-muted">
            Share this so a teammate can join from the sign-up page. Anyone
            with the code can join as a member.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="rounded-md border border-rule bg-background px-3 py-1.5 font-body text-sm text-foreground">
              {profile.organizations?.invite_code ?? "Not set"}
            </span>
            <form action={regenerateInviteCode}>
              <SubmitButton variant="ghost" pendingText="Generating…">
                Generate new code
              </SubmitButton>
            </form>
          </div>
        </div>
      ) : null}

      {membersError ? (
        <Notice title="Couldn’t load members">
          {membersError.message}
        </Notice>
      ) : (
        <DataTable
          columns={
            isOwner
              ? ["Member", "Role", "Joined", ""]
              : ["Member", "Role", "Joined"]
          }
        >
          {rows.map((member) => {
            const isSelf = member.id === user.id;
            const isLastOwner = member.role === "owner" && ownerCount <= 1;
            return (
              <tr key={member.id} className="border-b border-rule align-top">
                <td className="px-3 py-3 font-body text-sm text-foreground">
                  {member.full_name || "Unnamed member"}
                  {isSelf ? (
                    <span className="ml-1.5 text-muted">(you)</span>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  <Badge tone={member.role === "owner" ? "accent" : "neutral"}>
                    {member.role === "owner" ? "Owner" : "Member"}
                  </Badge>
                </td>
                <td className="px-3 py-3 font-body text-sm text-muted">
                  {formatDate(member.created_at)}
                </td>
                {isOwner ? (
                  <td className="px-3 py-3">
                    {isSelf ? (
                      <span className="font-body text-sm text-muted">
                        —
                      </span>
                    ) : (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <form action={setMemberRole}>
                          <input
                            type="hidden"
                            name="targetProfileId"
                            value={member.id}
                          />
                          <input
                            type="hidden"
                            name="newRole"
                            value={member.role === "owner" ? "member" : "owner"}
                          />
                          <SubmitButton
                            variant="ghost"
                            pendingText="Saving…"
                          >
                            {member.role === "owner"
                              ? "Demote to member"
                              : "Promote to owner"}
                          </SubmitButton>
                        </form>
                        {!(member.role === "owner" && isLastOwner) ? (
                          <form action={removeMember}>
                            <input
                              type="hidden"
                              name="targetProfileId"
                              value={member.id}
                            />
                            <DeleteButton
                              confirmMessage={`Remove ${member.full_name || "this member"} from your organization?`}
                            >
                              Remove
                            </DeleteButton>
                          </form>
                        ) : null}
                      </div>
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </DataTable>
      )}
    </>
  );
}
