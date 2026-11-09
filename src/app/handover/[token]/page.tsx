import type { Metadata } from "next";
import Link from "next/link";
import { Notice, TextField } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { handoverPath, isHandoverToken } from "@/lib/school";
import { acceptHandover } from "./actions";

export const metadata: Metadata = {
  title: "Take over a school theater · Propolis",
  robots: { index: false, follow: false },
};

type HandoverPageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

type Info = { theatre_name: string; from_name: string | null; expires_at: string };

const LINK =
  "inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 font-body text-sm font-medium transition-colors md:min-h-0";

/*
 * Where a handover link lands (migration 018). Public, so a new teacher with
 * no account yet can see what they're being given, then sign up or log in
 * and come straight back here to accept it.
 */
export default async function HandoverPage({ params, searchParams }: HandoverPageProps) {
  const { token } = await params;
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : null;
  const here = handoverPath(token);

  let info: Info | null = null;
  let signedIn: { email: string | null; anonymous: boolean } | null = null;
  let myName = "";
  if (supabaseConfigured && isHandoverToken(token)) {
    const supabase = await createClient();
    const [{ data }, { data: auth }] = await Promise.all([
      supabase.rpc("school_handover_info", { p_token: token }),
      supabase.auth.getUser(),
    ]);
    const rows = (Array.isArray(data) ? data : data ? [data] : []) as Info[];
    info = rows[0] ?? null;
    const user = auth.user as { id: string; email?: string | null; is_anonymous?: boolean } | null;
    if (user) {
      signedIn = { email: user.email ?? null, anonymous: Boolean(user.is_anonymous) };
      const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
      myName = (profile as { full_name?: string | null } | null)?.full_name ?? "";
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md" data-handover-page>
        {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG from public/brand */}
        <img src="/brand/propolis-icon.svg" alt="" width={56} height={56} className="block" />

        {info ? (
          <>
            <h1 className="mt-6 font-display text-3xl leading-tight">
              Take over {info.theatre_name}
            </h1>
            <p className="mt-4 font-body text-base leading-relaxed text-foreground">
              {info.from_name ? `${info.from_name} is handing` : "You’re being handed"} this school
              theater to you: its inventory, productions and everything in it. A school theater has
              one account, the teacher’s, so when you accept, the previous teacher’s access ends.
            </p>

            {error ? (
              <div className="mt-6">
                <Notice title="That didn’t work">{error}</Notice>
              </div>
            ) : null}

            {!signedIn ? (
              <div className="mt-8 space-y-3" data-handover-signed-out>
                <p className="font-body text-sm text-muted">
                  First, sign up or log in with your own email. You’ll come straight back here.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Link href={`/signup?next=${encodeURIComponent(here)}`} className={`${LINK} bg-accent text-background hover:opacity-90`}>
                    Create an account
                  </Link>
                  <Link href={`/login?next=${encodeURIComponent(here)}`} className={`${LINK} border border-rule text-foreground hover:bg-surface`}>
                    Log in
                  </Link>
                </div>
              </div>
            ) : signedIn.anonymous ? (
              <div className="mt-8 space-y-3" data-handover-anonymous>
                <p className="font-body text-sm text-muted">
                  You’re using a test copy, which has no email. A school needs a real account, so sign
                  up with your own email first.
                </p>
                <Link href={`/signup?next=${encodeURIComponent(here)}`} className={`${LINK} bg-accent text-background hover:opacity-90`}>
                  Create an account
                </Link>
              </div>
            ) : (
              <form action={acceptHandover.bind(null, token)} className="mt-8 space-y-5" data-handover-accept>
                <TextField label="Your name" name="fullName" autoComplete="name" defaultValue={myName} required />
                <SubmitButton pendingText="Taking it over…">Take it over</SubmitButton>
                <p className="font-body text-sm text-muted">
                  Signed in as {signedIn.email ?? "your account"}. Your other theaters stay as they are.
                </p>
              </form>
            )}
          </>
        ) : (
          <>
            <h1 className="mt-6 font-display text-3xl leading-tight">This handover link isn’t working</h1>
            <p className="mt-4 font-body text-base leading-relaxed text-muted">
              It may have been used, cancelled or replaced, or it’s more than 7 days old. Ask the teacher
              for a new one.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
