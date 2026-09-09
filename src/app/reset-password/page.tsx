import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Notice, PageHeading, TextField } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getUserAndProfile } from "@/lib/auth";
import { updatePassword } from "./actions";

export const metadata: Metadata = {
  title: "Set a new password · Props & Costume Inventory",
};

type ResetPasswordPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const { user } = await getUserAndProfile();

  if (!user) {
    redirect("/login");
  }

  const error = first((await searchParams).error);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <PageHeading title="Set a new password" />

        {error ? (
          <div className="mb-6">
            <Notice title="Couldn’t update your password">{error}</Notice>
          </div>
        ) : null}

        <form action={updatePassword} className="space-y-5">
          <TextField
            label="New password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <TextField
            label="Confirm new password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <SubmitButton pendingText="Saving…">Save password</SubmitButton>
        </form>
      </div>
    </main>
  );
}
