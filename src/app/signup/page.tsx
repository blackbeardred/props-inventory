import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeading, TextField } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { supabaseConfigured } from "@/lib/supabase/config";
import { signup } from "./actions";

export const metadata: Metadata = {
  title: "Sign up · Props & Costume Inventory",
};

type SignupPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await searchParams;
  const error = first(params.error);
  const notice = first(params.notice);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <PageHeading
          title="Create your account"
          intro="You'll set up your organization right after this."
        />

        {!supabaseConfigured ? (
          <Notice title="Connect Supabase to sign up">
            Copy <code>.env.local.example</code> to <code>.env.local</code> and
            add your project URL and anon key, then reload.
          </Notice>
        ) : (
          <>
            {notice === "check-email" ? (
              <div className="mb-6">
                <Notice title="Check your email">
                  We sent a confirmation link to finish creating your
                  account. Click it, then come back and log in.
                </Notice>
              </div>
            ) : null}
            {error ? (
              <div className="mb-6">
                <Notice title="Couldn’t create your account">{error}</Notice>
              </div>
            ) : null}
            <form action={signup} className="space-y-5">
              <TextField
                label="Email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
              <TextField
                label="Password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
              <SubmitButton pendingText="Creating account…">Create account</SubmitButton>
            </form>
            <p className="mt-6 font-body text-sm text-muted">
              Already have an account?{" "}
              <Link href="/login" className="text-accent hover:underline">
                Log in
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
