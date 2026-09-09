import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Notice, PageHeading, TextField } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getUserAndProfile } from "@/lib/auth";
import { createOrganization, joinOrganization } from "./actions";

export const metadata: Metadata = {
  title: "Create your organization · Props & Costume Inventory",
};

type OnboardingPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OnboardingPage({
  searchParams,
}: OnboardingPageProps) {
  const { user, profile } = await getUserAndProfile();

  if (!user) {
    redirect("/login?next=/onboarding");
  }

  if (profile) {
    redirect("/locations");
  }

  const error = first((await searchParams).error);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <PageHeading
          title="Create your organization"
          intro="This is the theatre company, school, or program your team will share."
        />

        {error ? (
          <div className="mb-6">
            <Notice title="Couldn’t create your organization">
              {error}
            </Notice>
          </div>
        ) : null}

        <form action={createOrganization} className="space-y-5">
          <TextField
            label="Your name"
            name="fullName"
            autoComplete="name"
            required
          />
          <TextField
            label="Organization name"
            name="orgName"
            autoComplete="organization"
            required
          />
          <SubmitButton pendingText="Creating organization…">
            Create organization
          </SubmitButton>
        </form>

        <div className="my-8 flex items-center gap-3">
          <div className="h-px flex-1 bg-rule" />
          <span className="font-body text-xs text-muted">
            or join an existing one
          </span>
          <div className="h-px flex-1 bg-rule" />
        </div>

        <form action={joinOrganization} className="space-y-5">
          <TextField
            label="Your name"
            name="joinFullName"
            autoComplete="name"
            required
          />
          <TextField
            label="Invite code"
            name="inviteCode"
            autoComplete="off"
            required
          />
          <SubmitButton pendingText="Joining…" variant="ghost">
            Join organization
          </SubmitButton>
        </form>
      </div>
    </main>
  );
}
