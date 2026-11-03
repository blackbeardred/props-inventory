import Link from "next/link";
import type { ReactNode } from "react";
import { Honeycomb } from "@/components/landing/honeycomb";
import { RevealCard } from "@/components/landing/reveal-card";
import { getUserAndProfile } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase/config";

/**
 * The front door, built from the Figma landing page (Nov 2026: desktop 1440,
 * tablet 768, phone 390). It's one responsive page: the phone layout first,
 * the tablet layout from md and the desktop layout from xl. Every claim on it
 * is something the app does today. It's in American English, like the
 * designs.
 */

const CONTACT_EMAIL = "arjunallenbhatkhande@gmail.com";

const FEATURES = [
  ["Every shelf, mapped", "Rooms hold shelves and shelves hold boxes, so “Props Room A › Shelf A › Shakespeare box” is one tap away."],
  ["Search by what it’s made of", "Hidden tags mean that “wood” finds the mahogany cane and “gold” finds the crown, even when nobody wrote that down."],
  ["Find it from a photo", "Snap the prop table and Propolis matches what’s in the picture against everything you own."],
  ["Pull lists for every show", "Build a list per production, tick things off as they’re pulled, and see what’s already in use."],
  ["Twins, told apart", "Identical items are linked, so you know which of the two silver trays is free tonight."],
  ["Nothing lost for good", "Deleted items wait 30 days in Recently deleted, in case someone needs them back."],
];

const STEPS = [
  ["Photograph it", "Take a picture on your phone. Propolis suggests a name, a description and the tags that make it searchable."],
  ["Give it a home", "Put it in a room, on a shelf or in a box. Move it later with a right-click or a swipe."],
  ["Pull it for the show", "Add it to a production’s pull list. Everyone can see it’s in use until it comes back."],
];

const ROLES = [
  ["Stage managers", "Know what’s on the prop table and what’s yet to be pulled.", "Pull lists you can tick off backstage, on your phone.", "See what’s already in use before you promise it to another show."],
  ["Prop curators", "Every candlestick, crown and cane, with a photo and a shelf.", "Rooms, shelves and boxes that match the real storage.", "Identical pieces linked, so you know which one is free."],
  ["Directors", "See what the company already owns before you design around it.", "Browse by period, material and color.", "Spot a piece in a rehearsal photo and find out where it lives."],
  ["Costume shops", "Doublets, ruffs and hats by size, color and fabric.", "Search “velvet” or “red” and find it, even if nobody wrote it down.", "Know what’s out on loan and when it’s due back."],
];

const SECTIONS = [
  { id: "what-it-does", label: "What it does" },
  { id: "how-it-works", label: "How it works" },
  { id: "who-its-for", label: "Who it’s for" },
];

const GUTTER = "px-5 md:px-12 xl:px-20";
const WIDTH = "mx-auto w-full max-w-[1440px]";

function Hex({ className }: { className: string }) {
  return <span aria-hidden="true" className={`hex inline-block shrink-0 bg-honey ${className}`} />;
}

function Eyebrow({ children, onDark = false }: { children: ReactNode; onDark?: boolean }) {
  return (
    <p className={`font-mono text-[13px] font-bold uppercase tracking-[0.12em] ${onDark ? "text-background/85" : "text-honey-ink"}`}>
      {children}
    </p>
  );
}

const h2 =
  "font-display text-[32px] font-semibold leading-[1.15] tracking-[-0.01em] text-balance md:text-[40px] md:leading-[1.12] md:tracking-[-0.015em] xl:text-5xl";
const lede = "font-body text-lg leading-[1.55] md:text-xl";

const button = {
  primary:
    "inline-flex min-h-[52px] items-center justify-center rounded-[10px] bg-accent px-7 font-body text-base font-semibold text-background transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  secondary:
    "inline-flex min-h-[52px] items-center justify-center rounded-[10px] border-[1.5px] border-foreground px-7 font-body text-base font-semibold text-foreground transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
};

export default async function Home() {
  const { user } = supabaseConfigured ? await getUserAndProfile() : { user: null };
  const primary = user
    ? { href: "/inventory", label: "Open my inventory", short: "Open", nav: "Open my inventory" }
    : { href: "/signup", label: "Start your theater", short: "Try it", nav: "Try Propolis" };

  return (
    <main className="flex flex-1 flex-col bg-background" data-landing>
      {/* ── Nav */}
      <header className="border-b border-rule bg-background">
        <div className={`${WIDTH} ${GUTTER} flex items-center justify-between gap-4 py-4 md:py-5 xl:py-6`}>
          <Link href="/" className="flex min-h-11 items-center" aria-label="Propolis home">
            {/* eslint-disable-next-line @next/next/no-img-element -- the brand lockup, a static SVG */}
            <img src="/brand/propolis-lockup.svg" alt="Propolis" className="block h-8 w-auto md:h-9 xl:h-10" />
          </Link>
          <nav aria-label="On this page" className="hidden items-center gap-6 md:flex xl:gap-10">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="inline-flex min-h-11 items-center font-body text-[15px] font-medium text-foreground hover:text-accent xl:text-base">
                {s.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-6">
            {user ? null : (
              <Link href="/login" className="hidden min-h-11 items-center font-body text-base font-medium text-accent hover:underline lg:inline-flex">
                Log in
              </Link>
            )}
            <Link href={primary.href} className={`${button.primary} min-h-11 px-5 md:min-h-[52px] md:px-7`} data-nav-primary>
              <span className="md:hidden">{primary.short}</span>
              <span className="hidden md:inline">{primary.nav}</span>
            </Link>
          </div>
        </div>
        {/* Phone: the section links as chips under the bar. */}
        <nav aria-label="Jump to" className={`flex gap-2 border-t border-rule ${GUTTER} py-3 md:hidden`} data-jump-links>
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="inline-flex min-h-11 items-center rounded-full border border-rule px-3 font-body text-[13px] font-medium text-foreground"
            >
              {s.label}
            </a>
          ))}
        </nav>
      </header>

      {/* ── Hero */}
      <section className={`${WIDTH} ${GUTTER} grid items-center gap-10 pb-16 pt-10 md:gap-12 md:pb-22 md:pt-16 xl:grid-cols-[minmax(0,1fr)_minmax(0,560px)] xl:pb-28 xl:pt-22`}>
        <div className="flex flex-col gap-[22px] md:gap-7">
          <p className="flex items-center gap-3 font-mono text-[13px] font-bold uppercase tracking-[0.12em] text-honey-ink">
            <Hex className="w-4" />
            Props · costumes · set pieces
          </p>
          <h1 className="font-display text-[40px] font-semibold leading-[1.08] tracking-[-0.015em] text-balance md:text-[56px] md:leading-[1.06] md:tracking-[-0.02em] xl:text-[72px] xl:leading-[1.04]">
            Every prop, every costume, exactly where you left it.
          </h1>
          <p className={`${lede} max-w-[640px] text-muted`}>
            Propolis is the storage inventory for theater companies. Photograph a piece, put it on a
            shelf, and find it again in seconds — then pull it for the next show.
          </p>
          <div className="flex flex-col gap-3 md:flex-row md:gap-4">
            <Link href={primary.href} className={button.primary}>
              {primary.label}
            </Link>
            <a href="#how-it-works" className={button.secondary}>
              See how it works
            </a>
          </div>
          <p className="flex items-start gap-2.5 font-body text-base text-muted">
            <Hex className="mt-1.5 w-3" />
            Works on your phone — even in the basement with no signal.
          </p>
        </div>
        <div className="flex justify-center">
          <Honeycomb />
        </div>
      </section>

      {/* ── What it does */}
      <section id="what-it-does" aria-labelledby="what-it-does-title" className="scroll-mt-4 bg-surface">
        <div className={`${WIDTH} ${GUTTER} py-16 md:py-20 xl:py-28`}>
          <div className="max-w-[760px] space-y-4">
            <Eyebrow>What it does</Eyebrow>
            <h2 id="what-it-does-title" className={h2}>Everything backstage, findable.</h2>
            <p className={`${lede} max-w-[680px] text-muted`}>
              Built around how a theater’s storage actually works: rooms with shelves, shelves with
              boxes, and a show that needs half of it by Thursday.
            </p>
          </div>
          {/* Each card shows its title; tapping it opens the line beneath. items-start
              so an opened card doesn't stretch the closed ones beside it. */}
          <ul className="mt-8 grid items-start gap-4 md:mt-10 md:grid-cols-2 md:gap-6 xl:mt-14 xl:grid-cols-3">
            {FEATURES.map(([title, body]) => (
              <RevealCard
                key={title}
                layout="stack"
                hexClassName="w-8"
                headingClassName="font-display text-2xl font-semibold leading-tight tracking-[-0.005em] text-foreground"
                className="rounded-2xl bg-background p-8"
                heading={title}
              >
                <p className="pt-4 font-body text-base leading-[1.55] text-muted">{body}</p>
              </RevealCard>
            ))}
          </ul>
        </div>
      </section>

      {/* ── How it works */}
      <section id="how-it-works" aria-labelledby="how-it-works-title" className="scroll-mt-4 bg-accent text-background">
        <div className={`${WIDTH} ${GUTTER} py-16 md:py-20 xl:py-28`}>
          <div className="max-w-[1000px] space-y-4">
            <Eyebrow onDark>How it works</Eyebrow>
            <h2 id="how-it-works-title" className={h2}>From the shelf to the stage in three steps.</h2>
          </div>
          <ol className="mt-8 grid gap-10 md:mt-10 md:grid-cols-3 md:gap-7 xl:mt-14 xl:gap-16">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="space-y-5">
                <span className="hex flex w-16 items-center justify-center bg-honey font-display text-[26px] font-semibold text-foreground">
                  {i + 1}
                </span>
                <h3 className="font-display text-2xl font-semibold leading-tight">{title}</h3>
                <p className="font-body text-base leading-[1.55] text-background/85">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Who it's for */}
      <section id="who-its-for" aria-labelledby="who-its-for-title" className="scroll-mt-4 bg-background">
        <div className={`${WIDTH} ${GUTTER} py-16 md:py-20 xl:py-26`}>
          <div className="max-w-[900px] space-y-4">
            <Eyebrow>Who it’s for</Eyebrow>
            <h2 id="who-its-for-title" className={h2}>Built for the people behind the curtain.</h2>
            <p className={`${lede} max-w-[680px] text-muted`}>
              Whoever has to find the thing, keep track of it or decide on it, Propolis keeps
              everyone looking at the same storage.
            </p>
          </div>
          {/* Each card shows only who it's for; tapping it opens what Propolis
              does for them. */}
          <ul className="mt-8 grid items-start gap-4 md:mt-10 md:grid-cols-2 md:gap-6 xl:mt-12 xl:grid-cols-4">
            {ROLES.map(([role, line, a, b]) => (
              <RevealCard
                key={role}
                layout="inline"
                hexClassName="w-4"
                headingClassName="font-mono text-[13px] font-bold uppercase tracking-[0.1em] text-accent-ink"
                className="rounded-2xl bg-surface px-6 py-7"
                heading={role}
              >
                <div className="flex flex-col gap-3.5 pt-3.5">
                  <p className="font-display text-[21px] font-semibold leading-[1.25] text-foreground">{line}</p>
                  <hr className="border-rule" />
                  <p className="font-body text-[15px] leading-[1.55] text-muted">{a}</p>
                  <p className="font-body text-[15px] leading-[1.55] text-muted">{b}</p>
                </div>
              </RevealCard>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Call to action */}
      <section aria-labelledby="cta-title" className="bg-surface">
        <div className={`${WIDTH} ${GUTTER} flex flex-col items-center gap-8 py-16 text-center md:py-20 xl:py-26`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the app icon, a static SVG */}
          <img src="/brand/propolis-icon.svg" alt="" width={80} height={80} className="block" />
          <div className="max-w-[760px] space-y-4">
            <Eyebrow>Get started</Eyebrow>
            <h2 id="cta-title" className={h2}>Bring order to the prop room.</h2>
            <p className={`${lede} mx-auto max-w-[680px] text-muted`}>
              Set up your theater, invite your crew with a code, and add your first shelf in a few
              minutes.
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:gap-4">
            {user ? (
              <Link href="/inventory" className={button.primary}>Open my inventory</Link>
            ) : (
              <>
                <Link href="/signup" className={button.primary}>Start your theater</Link>
                <Link href="/signup" className={button.secondary}>Join with an invite code</Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── Footer */}
      <footer className="bg-foreground text-background">
        <div className={`${WIDTH} ${GUTTER} pb-10 pt-14 md:pt-[72px]`}>
          <div className="flex flex-col gap-8 md:flex-row md:gap-8 xl:gap-16">
            <div className="flex-1 space-y-5">
              {/* eslint-disable-next-line @next/next/no-img-element -- the brand lockup for dark grounds */}
              <img src="/brand/propolis-lockup-on-dark.svg" alt="Propolis" className="block h-10 w-auto" />
              <p className="font-body text-base text-background/72">The storage inventory for theater companies.</p>
            </div>
            <nav aria-label="Product" className="md:w-[150px] xl:w-[200px]">
              <p className="font-mono text-[13px] font-bold uppercase tracking-[0.12em] text-honey">Product</p>
              <ul className="mt-2">
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="inline-flex min-h-11 items-center font-body text-base hover:underline">{s.label}</a>
                  </li>
                ))}
              </ul>
            </nav>
            <nav aria-label="Company" className="md:w-[150px] xl:w-[200px]">
              <p className="font-mono text-[13px] font-bold uppercase tracking-[0.12em] text-honey">Company</p>
              <ul className="mt-2">
                <li>
                  <a href={`mailto:${CONTACT_EMAIL}`} className="inline-flex min-h-11 items-center font-body text-base hover:underline">Contact</a>
                </li>
                <li>
                  <Link href="/privacy" className="inline-flex min-h-11 items-center font-body text-base hover:underline">Privacy</Link>
                </li>
              </ul>
            </nav>
          </div>
          <div className="mt-12 flex flex-col gap-2 border-t border-muted pt-6 font-body text-base text-background/60 md:flex-row md:justify-between">
            <p>© 2026 Propolis</p>
            <p>Made for the people behind the curtain.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
