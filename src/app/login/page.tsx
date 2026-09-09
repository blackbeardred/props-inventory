import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeading, TextField } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { supabaseConfigured } from "@/lib/supabase/config";
import { login } from "./actions";

export const metadata: Metadata = {
  title: "Log in · Props & Costume Inventory",
};

type LoginPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const error = first(params.error);
  const next = first(params.next) ?? "/locations";

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <PageHeading title="Log in" intro="Welcome back." />

        {!supabaseConfigured ? (
          <Notice title="Connect Supabase to log in">
            Copy <code>.env.local.example</code> to <code>.env.local</code> and
            add your project URL and anon key, then reload.
          </Notice>
        ) : (
          <>
            {error ? (
              <div className="mb-6">
                <Notice title="Couldn’t log in">{error}</Notice>
              </div>
            ) : null}
            <form action={login} className="space-y-5">
              <input type="hidden" name="next" value={next} />
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
                autoComplete="current-password"
                required
              />
              <SubmitButton pendingText="Logging in…">Log in</SubmitButton>
            </form>
            <p className="mt-6 font-body text-sm text-muted">
              <Link
                href="/forgot-password"
                className="text-accent hover:underline"
              >
                Forgot your password?
              </Link>
            </p>
            <p className="mt-2 font-body text-sm text-muted">
              Need an account?{" "}
              <Link href="/signup" className="text-accent hover:underline">
                Sign up
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
