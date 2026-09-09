import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeading, TextField } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { supabaseConfigured } from "@/lib/supabase/config";
import { requestPasswordReset } from "./actions";

export const metadata: Metadata = {
  title: "Forgot password · Props & Costume Inventory",
};

type ForgotPasswordPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ForgotPasswordPage({
  searchParams,
}: ForgotPasswordPageProps) {
  const params = await searchParams;
  const error = first(params.error);
  const notice = first(params.notice);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <PageHeading
          title="Reset your password"
          intro="Enter your email and we’ll send you a link to set a new password."
        />

        {!supabaseConfigured ? (
          <Notice title="Connect Supabase first">
            Copy <code>.env.local.example</code> to <code>.env.local</code>{" "}
            and add your project URL and anon key, then reload.
          </Notice>
        ) : notice === "check-email" ? (
          <Notice title="Check your email">
            If an account exists for that address, we’ve sent a link to
            reset your password.
          </Notice>
        ) : (
          <>
            {error ? (
              <div className="mb-6">
                <Notice title="Couldn’t send reset email">{error}</Notice>
              </div>
            ) : null}
            <form action={requestPasswordReset} className="space-y-5">
              <TextField
                label="Email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
              <SubmitButton pendingText="Sending…">
                Send reset link
              </SubmitButton>
            </form>
          </>
        )}

        <p className="mt-6 font-body text-sm text-muted">
          <Link href="/login" className="text-accent hover:underline">
            Back to log in
          </Link>
        </p>
      </div>
    </main>
  );
}
