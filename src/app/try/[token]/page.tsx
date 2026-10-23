import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Notice } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { openTryout } from "./actions";
import { AutoOpen } from "./auto-open";

type TryParams = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: TryParams): Promise<Metadata> {
  const { token } = await params;
  return {
    title: "Your test copy · Propolis",
    robots: { index: false, follow: false },
    // Added to a home screen from here, the app opens this test copy rather
    // than a log-in page (see manifest.webmanifest/route.ts).
    manifest: `/try/${token}/manifest.webmanifest`,
  };
}

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
  const query = await searchParams;
  const error = query.error;
  // Opened from the home-screen app: straight in, no button.
  const fromApp = query.open === "1" && typeof error !== "string";

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
    // Already signed in (the app's been opened before): rejoining is
    // harmless and makes the test copy the open one, so go straight there.
    if (fromApp && label && user) {
      const { error: joinError } = await supabase.rpc("join_tryout", { p_token: token });
      if (!joinError) redirect("/inventory");
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG from public/brand */}
        <img src="/brand/propolis-icon.svg" alt="" width={56} height={56} className="block" />

        {label ? (
          <>
            <h1 className="mt-6 font-display text-4xl leading-tight">Hi {label},</h1>
            {/* Arjun's own words to the people he sends links to. */}
            <div className="mt-4 space-y-3 font-body text-base leading-relaxed text-foreground" data-tryout-welcome>
              <p>
                This is your own copy of Propolis to try! I recommend opening this service on your
                phone. Once you’re in the web browser, press the 3 circles on the bottom right, then
                “Share”, “View More” and “Add to Home Screen”.
              </p>
              <p>
                You’re able to add and delete items, as well as search for them within rooms. Please
                let me know if you have any questions, and if any function isn’t intuitive.
              </p>
            </div>

            {typeof error === "string" ? (
              <div className="mt-6">
                <Notice title="That didn’t work">{error}</Notice>
              </div>
            ) : null}

            <form id="open-tryout" action={openTryout.bind(null, token)} className="mt-8" data-open-tryout>
              <SubmitButton pendingText="Opening…">Open my test copy</SubmitButton>
            </form>
            {fromApp ? <AutoOpen formId="open-tryout" /> : null}
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
