# Props & Costume Inventory

Next.js + Supabase scaffold for tracking props, costumes, storage locations,
and per-production pull lists.

## Day 1 checklist

### 1. Push to GitHub
```bash
cd props-inventory
git init
git add .
git commit -m "Day 1: project scaffold"
gh repo create props-inventory --private --source=. --push
# or: create the repo on github.com, then
#   git remote add origin <your-repo-url>
#   git push -u origin main
```

### 2. Create the Supabase project
1. Go to https://supabase.com/dashboard and create a new project.
2. Once it's provisioned, open the **SQL Editor** and run everything in
   `supabase/schema.sql` — it creates the tables and locks them down with
   row-level security scoped to your organization.
3. Go to **Project Settings → API** and copy the **Project URL** and
   **anon public key**.

### 3. Configure environment variables
```bash
cp .env.local.example .env.local
```
Paste the URL and anon key into `.env.local`.

### 4. Run it locally
```bash
npm install
npm run dev
```
Visit http://localhost:3000 — you should see the placeholder homepage.

### 5. Deploy to Vercel
1. Go to https://vercel.com/new and import the GitHub repo.
2. Add the two `NEXT_PUBLIC_SUPABASE_*` variables under
   **Project Settings → Environment Variables** (same values as `.env.local`).
3. Deploy. You now have a live URL.

## What's already wired up

- Next.js 15, App Router, TypeScript, Tailwind CSS
- Supabase client helpers for both Client Components (`src/lib/supabase/client.ts`)
  and Server Components / Route Handlers (`src/lib/supabase/server.ts`)
- Middleware (`src/middleware.ts`) that keeps auth sessions refreshed
- `supabase/schema.sql` — organizations, profiles, locations, items,
  productions, pull_lists, pull_list_items, with row-level security

## Deliberately not built yet (per the plan)

AI photo classification, OCR, QR codes, marketplace features, billing.
Those come after Day 5, once there's a real inventory + pull-list flow to
test against actual theatre storage rooms.

## Next up (Day 2)

The schema is already written — Day 2 is really about building the pages:
a locations list, an items list scoped to a location, and a productions
list. See `supabase/schema.sql` for the exact shape of the data.
