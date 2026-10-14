import Link from "next/link";
import { getUserAndProfile } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase/config";

/**
 * The front door, for theatres that haven't signed up yet (and a way back in
 * for those who have). Says what Propolis does in a theatre's own terms, and
 * every claim on it is something the app does today.
 */

const FEATURES = [
  {
    title: "Walk your storage like folders",
    body: "Rooms, shelves and boxes, nested the way they really are. Open a room, step into a box, and see exactly what’s inside.",
  },
  {
    title: "Find it from a photo",
    body: "Point your phone at a prop and Propolis finds the ones that look like it, so you know whether you already own one, and where it lives.",
  },
  {
    title: "Bring your spreadsheet",
    body: "Import the inventory you already keep, as an Excel workbook or a CSV, photos included. Columns it has no field for are kept and searchable.",
  },
  {
    title: "Search everything",
    body: "Names, descriptions, materials, donors, inventory numbers. Type “brass” and find the candlestick, the tray and the lantern.",
  },
  {
    title: "Pull for a show",
    body: "Build each production’s pull list, then walk a checklist on your phone, grouped by room and box in the order you’d fetch them.",
  },
  {
    title: "Labels that open the box",
    body: "Print a QR label for every shelf and box. Scan one and the phone shows what should be in it.",
  },
];

const STEPS = [
  {
    title: "Bring in what you have",
    body: "Import your spreadsheet, or add items one photo at a time. The photo fills in the name and description for you.",
  },
  {
    title: "Put it where it lives",
    body: "Set up your rooms, shelves and boxes, file each item, and print labels for the boxes.",
  },
  {
    title: "Pull, check, return",
    body: "Give each show its pull list, tick things off as they leave the shelves, and see what’s still out.",
  },
];

function Logo({ size }: { size: number }) {
  // eslint-disable-next-line @next/next/no-img-element -- a static SVG from public/brand
  return <img src="/brand/propolis-icon.svg" alt="" width={size} height={size} className="block" />;
}

export default async function Home() {
  const { user } = supabaseConfigured ? await getUserAndProfile() : { user: null };

  const primary = user
    ? { href: "/inventory", label: "Open my inventory" }
    : { href: "/signup", label: "Set up your theatre" };

  return (
    <main className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 pt-6">
        <Link href="/" className="flex min-h-11 items-center gap-2.5" aria-label="Propolis home">
          <Logo size={36} />
          <span className="font-display text-xl font-semibold text-foreground">Propolis</span>
        </Link>
        {user ? (
          <Link
            href="/inventory"
            className="inline-flex min-h-11 items-center font-body text-sm text-accent hover:underline md:min-h-0"
          >
            Open my inventory
          </Link>
        ) : (
          <nav className="flex items-center gap-5" aria-label="Account">
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center font-body text-sm text-muted hover:text-foreground md:min-h-0"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="inline-flex min-h-11 items-center font-body text-sm text-accent hover:underline md:min-h-0"
            >
              Sign up
            </Link>
          </nav>
        )}
      </header>

      {/* The pitch */}
      <section className="mx-auto w-full max-w-5xl px-6 pb-16 pt-16 sm:pt-24">
        <p className="mb-5 font-mono text-xs uppercase tracking-[0.12em] text-muted">
          Props · costumes · set pieces
        </p>
        <h1 className="max-w-3xl font-display text-4xl leading-[1.12] sm:text-6xl">
          <span className="italic text-accent">Every prop</span> and costume, the shelf it lives
          on, and the show it&rsquo;s pulled for.
        </h1>
        <p className="mt-6 max-w-xl font-body text-lg leading-relaxed text-muted">
          Propolis is the storage inventory built for theatres. Know what you own, find it in
          seconds, and send every production off with a pull list that keeps track of itself.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link
            href={primary.href}
            className="inline-flex min-h-12 items-center justify-center rounded-md bg-accent px-6 font-body text-base font-medium text-background transition-opacity hover:opacity-90"
          >
            {primary.label}
          </Link>
          {user ? null : (
            <p className="font-body text-sm text-muted">
              Joining a theatre that’s already here?{" "}
              <Link href="/signup" className="-my-3 inline-block py-3 text-accent hover:underline">
                Sign up
              </Link>{" "}
              and use its invite code.
            </p>
          )}
        </div>
      </section>

      {/* What it does */}
      <section aria-labelledby="features" className="border-y border-rule bg-surface/60">
        <div className="mx-auto w-full max-w-5xl px-6 py-16">
          <h2 id="features" className="font-display text-2xl sm:text-3xl">
            Made for the storeroom, not the office
          </h2>
          <ul className="mt-10 grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <li key={feature.title}>
                <h3 className="font-display text-lg font-semibold text-foreground">{feature.title}</h3>
                <p className="mt-2 font-body text-sm leading-relaxed text-muted">{feature.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* How it goes */}
      <section aria-labelledby="how" className="mx-auto w-full max-w-5xl px-6 py-16">
        <h2 id="how" className="font-display text-2xl sm:text-3xl">
          From spreadsheet to shelf
        </h2>
        <ol className="mt-10 grid gap-8 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="border-t border-rule pt-5">
              <span className="font-mono text-sm text-accent-ink">{String(index + 1).padStart(2, "0")}</span>
              <h3 className="mt-2 font-display text-lg font-semibold text-foreground">{step.title}</h3>
              <p className="mt-2 font-body text-sm leading-relaxed text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-12 max-w-2xl font-body text-sm leading-relaxed text-muted">
          It works on the phone in your pocket: install it to your home screen, and the pages
          and checklists you’ve opened keep working in a basement with no signal. Everyone in
          your theatre shares one inventory, and each theatre’s is private to it.
        </p>
      </section>

      {/* The last word */}
      {user ? null : (
        <section className="mx-auto w-full max-w-5xl px-6 pb-20">
          <div className="flex flex-col items-start gap-5 rounded-xl bg-accent px-7 py-9 text-background sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-display text-2xl">Ready to find the brass lantern?</p>
              <p className="mt-1 font-body text-sm">Set up your theatre in a couple of minutes.</p>
            </div>
            <Link
              href="/signup"
              className="inline-flex min-h-12 items-center justify-center rounded-md bg-background px-6 font-body text-base font-medium text-accent-ink transition-opacity hover:opacity-90"
            >
              Get started
            </Link>
          </div>
        </section>
      )}

      <footer className="mt-auto border-t border-rule">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-6">
          <div className="flex items-center gap-2">
            <Logo size={20} />
            <span className="font-body text-sm text-muted">Propolis</span>
          </div>
          <nav className="flex items-center gap-5" aria-label="About">
            <Link
              href="/privacy"
              className="inline-flex min-h-11 items-center font-body text-sm text-muted hover:text-foreground md:min-h-0"
            >
              Privacy
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
