import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Privacy · Propolis",
  description: "What Propolis collects, why, who it's shared with, and your choices.",
};

/*
 * DRAFT, written Oct 14 2026 from what the app actually does. Not legal
 * advice: have it reviewed before Propolis is offered widely, and keep it in
 * step with the app. Fill these in before publishing:
 */
const OPERATOR = "[Your name or company]";
const CONTACT_EMAIL = "[contact email]";
const EFFECTIVE = "October 14, 2026";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-rule pt-7">
      <h2 className="font-display text-xl text-foreground">{title}</h2>
      <div className="mt-3 space-y-3 font-body text-[15px] leading-relaxed text-foreground [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 pb-20 pt-10">
      <Link href="/" className="inline-flex min-h-11 items-center gap-2 md:min-h-0">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG from public/brand */}
        <img src="/brand/propolis-icon.svg" alt="" width={28} height={28} className="block" />
        <span className="font-display text-lg font-semibold text-foreground">Propolis</span>
      </Link>

      <h1 className="mt-10 font-display text-4xl leading-tight">Privacy policy</h1>
      <p className="mt-2 font-mono text-xs text-muted">Effective {EFFECTIVE}</p>

      <div className="mt-8 space-y-8">
        <p className="font-body text-[15px] leading-relaxed text-foreground">
          Propolis helps theatres keep track of their props, costumes and set pieces: what they
          own, where it&rsquo;s stored, and what each production has pulled. It is run by{" "}
          {OPERATOR} (&ldquo;we&rdquo;). This policy explains what information Propolis collects,
          how it&rsquo;s used, who it&rsquo;s shared with, and the choices you have. If anything
          here is unclear, write to us at {CONTACT_EMAIL}.
        </p>

        <Section title="What we collect">
          <p>
            <strong className="font-semibold">Your account.</strong> Your email address and
            password (stored by our sign-in provider in scrambled form, never readable by us),
            your display name, and a profile picture if you add one.
          </p>
          <p>
            <strong className="font-semibold">Your theatre&rsquo;s inventory.</strong> What you
            and your colleagues put in: items and their names, descriptions, categories,
            condition and quantities; photos of them; rooms, shelves and boxes; productions, pull
            lists and checklists; and any extra columns kept from a spreadsheet you import (for
            example an inventory number or a donor&rsquo;s name).
          </p>
          <p>
            <strong className="font-semibold">Your theatre&rsquo;s members.</strong> Who belongs
            to each theatre, their role (owner or member), and the theatre&rsquo;s invite code.
          </p>
          <p>
            <strong className="font-semibold">Photo fingerprints.</strong> To find things by
            photo, Propolis turns each item photo into a list of numbers that describes how it
            looks. This is worked out on your own device, then saved with the item. When you
            confirm a photo match, that photo may also be kept as another picture of the item, to
            improve matching; these pictures are never shown in the app.
          </p>
          <p>
            <strong className="font-semibold">Things kept on your device.</strong> A cookie that
            keeps you signed in and one that remembers whether you prefer the list or grid view.
            Your browser also keeps a few settings (the production you last added to, recent
            places, whether photo recognition is turned on), any checklist ticks made while
            offline until they can be sent, copies of pages you&rsquo;ve opened so they work
            without a signal, and the photo recognition model. All of this stays on your device.
          </p>
          <p>
            <strong className="font-semibold">Technical information.</strong> Like any website,
            the services that host Propolis receive standard information with each request, such
            as your IP address and browser type, and may keep it briefly in their logs.
          </p>
          <p>
            We don&rsquo;t use advertising, analytics or tracking tools, and we don&rsquo;t collect
            your location.
          </p>
        </Section>

        <Section title="How we use it">
          <ul>
            <li>To run Propolis: show your theatre its inventory, search it, match photos, build pull lists and checklists, and print labels.</li>
            <li>To sign you in, keep your account secure, and send the emails sign-in needs (confirming your address, resetting a password).</li>
            <li>To fix problems and improve Propolis.</li>
          </ul>
          <p>We don&rsquo;t sell your information, and we don&rsquo;t use it for advertising.</p>
        </Section>

        <Section title="The AI features">
          <p>
            Some features use Claude, an AI model made by Anthropic. When you use them, the photo
            and the item&rsquo;s text are sent to Anthropic to be read:
          </p>
          <ul>
            <li>filling in a new item&rsquo;s details from its photo;</li>
            <li>making the hidden search tags when an item is saved (its name, description and photo);</li>
            <li>reading a photo of a prop table to mark what a production has pulled.</li>
          </ul>
          <p>
            Anthropic processes this for us under its commercial terms. Its published policy is
            to delete these inputs and outputs within 30 days and not to use them to train its
            models. Anthropic&rsquo;s own privacy information is at{" "}
            <a
              href="https://privacy.claude.com"
              className="-my-3 inline-block py-3 text-accent-ink underline underline-offset-2"
            >
              privacy.claude.com
            </a>
            .
          </p>
          <p>
            Finding things by photo is different: it runs on your own device, and your photos
            aren&rsquo;t sent anywhere to do it. The first time you turn it on, your device
            downloads the recognition model from Hugging Face.
          </p>
        </Section>

        <Section title="Who can see your theatre’s information">
          <p>
            Your theatre&rsquo;s inventory is visible to the people who belong to that theatre,
            and to no other theatre. Anyone with your theatre&rsquo;s invite code can join it as a
            member, so share the code only with people you trust; owners can change the code and
            remove members at any time.
          </p>
          <p>
            Photos are stored privately and shown through links that expire after a short time.
          </p>
        </Section>

        <Section title="Who we share it with">
          <p>
            Only the companies that help us run Propolis, each handling information on our behalf
            and only for that purpose:
          </p>
          <ul>
            <li><strong className="font-semibold">Supabase</strong>: the database, sign-in and photo storage.</li>
            <li><strong className="font-semibold">Vercel</strong>: hosting the website.</li>
            <li><strong className="font-semibold">Anthropic</strong>: the AI features described above.</li>
            <li><strong className="font-semibold">Our email provider</strong>: sending sign-in emails.</li>
            <li><strong className="font-semibold">Hugging Face</strong>: serving the photo recognition model your device downloads. No inventory information is sent to it.</li>
          </ul>
          <p>
            We may also share information if the law requires it, or to protect the safety of our
            users or the service.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            We keep your account and your theatre&rsquo;s inventory for as long as you use
            Propolis. Anything you delete goes to Recently deleted for 30 days, so it can be
            restored, and is then removed for good, photos included. Our providers may keep
            backups for a limited time after that.
          </p>
          <p>
            To close your account or remove a theatre entirely, write to {CONTACT_EMAIL} and
            we&rsquo;ll delete it, along with its photos.
          </p>
        </Section>

        <Section title="Your choices">
          <ul>
            <li>See and correct your information at any time in the app, under Theatre.</li>
            <li>Export your theatre&rsquo;s inventory as a spreadsheet whenever you like.</li>
            <li>Leave a theatre from Theatre › Your theatres.</li>
            <li>Don&rsquo;t turn on photo recognition, or don&rsquo;t use the AI features, if you&rsquo;d rather not.</li>
            <li>Ask us for a copy of your information, or to delete it, at {CONTACT_EMAIL}.</li>
          </ul>
          <p>
            Depending on where you live, you may have further rights over your information; write
            to us and we&rsquo;ll help.
          </p>
        </Section>

        <Section title="Keeping it safe">
          <p>
            Propolis is served only over encrypted connections, each theatre&rsquo;s information
            is kept apart by the database itself, and photos are stored privately. No system is
            perfectly secure, but we take reasonable steps to protect your information and will
            tell you if something goes wrong that affects it.
          </p>
        </Section>

        <Section title="Children">
          <p>
            Propolis is for the people who run a theatre&rsquo;s storage, and isn&rsquo;t meant
            for children under 13. School and youth theatres should have staff hold the accounts.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            If we change this policy, we&rsquo;ll update the date at the top, and tell you in the
            app or by email if the change is significant.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about privacy, or a request about your information: {CONTACT_EMAIL}.
          </p>
        </Section>
      </div>
    </main>
  );
}
