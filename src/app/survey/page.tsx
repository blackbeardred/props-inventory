import type { Metadata } from "next";
import Link from "next/link";
import { SurveyForm } from "./survey-form";

export const metadata: Metadata = {
  title: "Theater storage survey",
  description: "About five minutes on how your theater keeps track of props, costumes and set pieces.",
  robots: { index: false, follow: false },
};

/*
 * The research survey (Oct 2026): problem discovery with stage managers, prop
 * curators and directors. It's public, needs no account, and answers go to
 * submit_survey (migration 017). The questions live in
 * src/lib/survey/storage-2026.ts. Propolis isn't named on the page, so the
 * answers aren't steered toward it.
 */
export default function SurveyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-5 pb-24 pt-10 sm:px-6">
      {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG from public/brand */}
      <img src="/brand/propolis-icon.svg" alt="" width={44} height={44} className="block" />
      <p className="mt-8 font-mono text-xs font-bold uppercase tracking-[0.12em] text-honey-ink">
        Research survey · About 5 minutes
      </p>
      <h1 className="mt-3 font-display text-4xl leading-tight text-balance sm:text-5xl">
        How does your theater keep track of what’s in storage?
      </h1>
      <div className="mt-5 space-y-3 font-body text-base leading-relaxed text-foreground">
        <p>
          I’m researching how theater companies keep track of their props, costumes and set
          pieces: what they own, where it is, and what goes wrong. If you’re a stage manager,
          prop curator or director, I’d love to hear how it works where you are.
        </p>
        <p className="text-muted">
          There’s no sign-in, and your answers are anonymous unless you leave a phone number at
          the end. Only the first question is required.
        </p>
      </div>

      <SurveyForm />

      <p className="mt-16 border-t border-rule pt-6 font-body text-sm text-muted">
        Run by Arjun Bhatkhande.{" "}
        <Link href="/privacy" className="-my-3 inline-block py-3 text-accent-ink underline underline-offset-2">
          How answers are kept
        </Link>
      </p>
    </main>
  );
}
