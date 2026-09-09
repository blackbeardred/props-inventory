import Link from "next/link";
import { getUserAndProfile } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase/config";

const roadmap = [
  { day: "Day 1", label: "Project, database, and hosting wired together" },
  { day: "Day 2", label: "Locations, items, and productions tables" },
  { day: "Day 3", label: "Sign up, log in, create an organization" },
  { day: "Day 4", label: "Add an item, upload a photo, assign a shelf" },
  { day: "Day 5", label: "Search across everything in storage" },
];

export default async function Home() {
  const { user } = supabaseConfigured
    ? await getUserAndProfile()
    : { user: null };

  return (
    <main className="flex-1 flex flex-col">
      {user ? null : (
        <div className="mx-auto flex w-full max-w-3xl items-center justify-end gap-5 px-6 pt-8">
          <Link
            href="/login"
            className="font-body text-sm text-muted hover:text-foreground"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="font-body text-sm text-accent hover:underline"
          >
            Sign up
          </Link>
        </div>
      )}

      <div className="flex flex-1 items-center">
        <div className="w-full max-w-3xl mx-auto px-6 py-20">
          <p className="font-body text-sm text-muted mb-6">
            Props &amp; Costume Inventory
          </p>

          <h1 className="font-display text-4xl sm:text-5xl leading-[1.15] mb-6">
            <span className="italic text-accent">Every prop</span> and
            costume, the shelf it lives on, and the show it&rsquo;s pulled
            for.
          </h1>

          <p className="font-body text-base text-muted max-w-lg mb-12">
            This started as the Day 1 scaffold: a Next.js app connected to
            Supabase, ready to deploy on Vercel. The list below is the plan
            for the rest of the week.
          </p>

          <ol className="border-t border-rule">
            {roadmap.map((step, i) => (
              <li
                key={step.day}
                className="flex items-baseline gap-4 py-4 border-b border-rule"
              >
                <span className="font-display text-lg text-accent w-6 shrink-0">
                  {i + 1}
                </span>
                <span className="font-body text-sm text-muted w-14 shrink-0">
                  {step.day}
                </span>
                <span className="font-body text-base">{step.label}</span>
              </li>
            ))}
          </ol>

          {user ? (
            <div className="mt-12 text-center">
              <Link
                href="/locations"
                className="font-display text-3xl sm:text-4xl text-accent hover:underline"
              >
                Explore my Inventory
              </Link>
            </div>
          ) : null}

          <p className="font-body text-sm text-muted mt-10">
            Day 2 is live &mdash;{" "}
            <Link href="/locations" className="text-accent hover:underline">
              Locations
            </Link>
            ,{" "}
            <Link href="/items" className="text-accent hover:underline">
              Items
            </Link>
            , and{" "}
            <Link href="/productions" className="text-accent hover:underline">
              Productions
            </Link>
            . Day 3 is live &mdash; sign up above to create your
            organization.
          </p>
        </div>
      </div>
    </main>
  );
}
