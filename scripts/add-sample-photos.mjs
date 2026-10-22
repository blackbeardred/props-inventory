// Adds the sample photos to every test copy (tryout link, migrations 013–014).
//
//   node scripts/add-sample-photos.mjs            add them
//   node scripts/add-sample-photos.mjs --dry-run  say what it would do
//
// Needs, in .env.local:
//   NEXT_PUBLIC_SUPABASE_URL=…        (already there)
//   SUPABASE_SERVICE_ROLE_KEY=…       (Supabase → Project Settings → API keys:
//                                      the service_role / secret key)
//
// The service role key can write to every theatre, which is what this needs:
// the test theatres belong to nobody who can sign in and upload. It stays in
// .env.local on this computer; .env.local is never committed, and the key
// must never be added to Vercel or anything that runs in a browser.
//
// Each picture in supabase/sample-photos/ goes to the items in each test
// theatre with the name photos.json gives it, as that theatre's own copy
// (`<org>/<item>/sample-….jpg`, the same layout the app uses), so deleting
// it in one copy can't break another. Only items with no photo yet are
// touched: a picture a tester added stays. Running it again, or after making
// more test links, only fills in what's missing.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PHOTO_DIR = path.join(HERE, "..", "supabase", "sample-photos");
const BUCKET = "item-photos";

/** The pairs in a .env file, quotes trimmed; comments and blank lines skipped. */
export function readEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return env;
}

/**
 * The work, given a Supabase client with the service role. Returns what it
 * did per test copy, and never throws for one bad copy: it carries on with
 * the rest and reports it.
 */
export async function addSamplePhotos(supabase, { dir = PHOTO_DIR, dryRun = false, log = console.log } = {}) {
  const photos = JSON.parse(fs.readFileSync(path.join(dir, "photos.json"), "utf8"));
  const names = Object.keys(photos);
  for (const file of new Set(Object.values(photos))) {
    if (!fs.existsSync(path.join(dir, file))) throw new Error(`Missing picture: supabase/sample-photos/${file}`);
  }

  const { data: links, error: linksError } = await supabase
    .from("tryout_links")
    .select("label, org_id")
    .order("created_at");
  if (linksError) throw new Error(`Couldn’t read the test links: ${linksError.message}`);
  if (!links?.length) {
    log("No test links yet: make them first (see supabase/migrations/013_tryout_links.sql).");
    return [];
  }

  const report = [];
  for (const link of links) {
    const done = { label: link.label, added: 0, failed: [] };
    const { data: items, error } = await supabase
      .from("items")
      .select("id, name")
      .eq("org_id", link.org_id)
      .is("photo_url", null)
      .in("name", names);
    if (error) {
      done.failed.push(`couldn’t read items: ${error.message}`);
      report.push(done);
      continue;
    }
    for (const item of items ?? []) {
      const file = photos[item.name];
      const objectPath = `${link.org_id}/${item.id}/sample-${path.basename(file, ".jpg")}-${randomUUID().slice(0, 8)}.jpg`;
      if (dryRun) {
        done.added += 1;
        continue;
      }
      const bytes = fs.readFileSync(path.join(dir, file));
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(objectPath, bytes, { contentType: "image/jpeg" });
      if (uploadError) {
        done.failed.push(`${item.name}: ${uploadError.message}`);
        continue;
      }
      // Still no photo? (A tester may have added one a moment ago.)
      const { data: updated, error: updateError } = await supabase
        .from("items")
        .update({ photo_url: objectPath })
        .eq("id", item.id)
        .is("photo_url", null)
        .select("id");
      if (updateError || !updated?.length) {
        await supabase.storage.from(BUCKET).remove([objectPath]);
        if (updateError) done.failed.push(`${item.name}: ${updateError.message}`);
        continue;
      }
      done.added += 1;
    }
    report.push(done);
    const note = done.failed.length ? `, ${done.failed.length} failed (${done.failed.join("; ")})` : "";
    log(`${link.label}: ${dryRun ? "would add" : "added"} ${done.added} photo${done.added === 1 ? "" : "s"}${note}`);
  }
  return report;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const envPath = path.join(HERE, "..", ".env.local");
  const env = fs.existsSync(envPath) ? readEnv(fs.readFileSync(envPath, "utf8")) : {};
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Add SUPABASE_SERVICE_ROLE_KEY=… to .env.local first (Supabase → Project Settings → API keys, " +
        "the service_role / secret key), then run this again."
    );
    process.exit(1);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const report = await addSamplePhotos(supabase, { dryRun });
  const failed = report.some((r) => r.failed.length);
  console.log(failed ? "Done, with some failures above." : "Done.");
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exit(1);
  });
}
