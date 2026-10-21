import type { Metadata } from "next";
import { Notice } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { openTryout } from "./actions";

export const metadata: Metadata = {
  title: "Your test copy · Propolis",
  robots: { index: false, follow: false },
};

type TryPageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

/*
 * Where a tryout link lands (migration 013). Says whose copy it is and what's
 * in it, and one button opens it: no sign-up, no password. The same link
 * brings the person back later, on any device.
 */
export default async function TryPage({ params, searchParams }: TryPageProps) {
  const { token } = await params;
  const error = (await searchParams).error;

  let label: string | null = null;
  let notSetUp = false;
  let signedInAs: string | null = null;
  if (supabaseConfigured) {
    const supabase = await createClient();
    const [{ data, error: labelError }, { data: auth }] = await Promise.all([
      supabase.rpc("tryout_label", { p_token: token }),
      supabase.auth.getUser(),
    ]);
    label = typeof data === "string" ? data : null;
    notSetUp = labelError?.code === "PGRST202";
    const user = auth.user as { email?: string | null; is_anonymous?: boolean } | null;
    if (user && !user.is_anonymous) signedInAs = user.email ?? "your account";
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG from public/brand */}
        <img src="/brand/propolis-icon.svg" alt="" width={56} height={56} className="block" />

        {label ? (
          <>
            <h1 className="mt-6 font-display text-4xl leading-tight">Hi {label}.</h1>
            <div className="mt-4 space-y-3 font-body text-base leading-relaxed text-foreground">
              <p>
                This is your own copy of Propolis to try out: a made-up theatre with a few rooms,
                shelves and boxes, some props and costumes, and two shows.
              </p>
              <p>
                Change anything you like. Add things, delete them, import a spreadsheet, take
                photos. Nothing you do reaches anyone else’s copy.
              </p>
            </div>

            {typeof error === "string" ? (
              <div className="mt-6">
                <Notice title="That didn’t work">{error}</Notice>
              </div>
            ) : null}

            <form action={openTryout.bind(null, token)} className="mt-8" data-open-tryout>
              <SubmitButton pendingText="Opening…">Open my test copy</SubmitButton>
            </form>
            <p className="mt-4 font-body text-sm text-muted">
              No account needed. To come back later, open this same link again, on this device or
              another.
            </p>
            {signedInAs ? (
              <p className="mt-3 font-body text-sm text-muted" data-tryout-signed-in>
                You’re signed in as {signedInAs}. Opening this adds {label}’s test theatre to your
                theatres; switch back to your own from the menu at the top left.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <h1 className="mt-6 font-display text-3xl leading-tight">This link isn’t working</h1>
            <p className="mt-4 font-body text-base leading-relaxed text-muted">
              {notSetUp
                ? "Test copies aren’t set up on this site yet."
                : "It may have been switched off, or a bit of it went missing when it was copied. Ask whoever sent it for a fresh one."}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
