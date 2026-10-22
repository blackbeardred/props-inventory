// scripts/add-sample-photos.mjs against a fake Supabase: the sample pictures
// reach every test copy, only items with no photo get one, each copy gets
// its own files, and a second run adds nothing.
//   node src/lib/add-sample-photos.test.mjs

import fs from "node:fs";
import { addSamplePhotos, readEnv, PHOTO_DIR } from "../../scripts/add-sample-photos.mjs";

let pass = 0, fail = 0;
function is(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label} — expected ${e}, got ${a}`); }
}

function fakeSupabase({ links, items, failUploadFor = null }) {
  const uploads = [], removed = [];
  const from = (table) => {
    const filters = [];
    let patch = null;
    const rows = () => (table === "tryout_links" ? links : items).filter((row) => filters.every((f) => f(row)));
    const chain = {
      select: () => chain,
      order: () => chain,
      eq: (col, v) => (filters.push((r) => r[col] === v), chain),
      is: (col, v) => (filters.push((r) => r[col] === v), chain),
      in: (col, vs) => (filters.push((r) => vs.includes(r[col])), chain),
      update: (p) => ((patch = p), chain),
      then: (resolve) => {
        const hit = rows();
        if (patch) hit.forEach((r) => Object.assign(r, patch));
        resolve({ data: hit.map((r) => ({ ...r })), error: null });
      },
    };
    return chain;
  };
  return {
    uploads, removed,
    from,
    storage: {
      from: () => ({
        upload: async (p, bytes) => {
          if (failUploadFor && p.includes(failUploadFor)) return { error: { message: "quota" } };
          uploads.push({ path: p, size: bytes.length });
          return { error: null };
        },
        remove: async (paths) => (removed.push(...paths), { error: null }),
      }),
    },
  };
}

const photos = JSON.parse(fs.readFileSync(`${PHOTO_DIR}/photos.json`, "utf8"));
is("23 pictures, every one on disk", [Object.keys(photos).length, Object.values(photos).every((f) => fs.existsSync(`${PHOTO_DIR}/${f}`))], [23, true]);

const links = [{ label: "Gregg", org_id: "orgA" }, { label: "Tester 2", org_id: "orgB" }];
const items = [
  { id: "a1", org_id: "orgA", name: "Anvil", photo_url: null },
  { id: "a2", org_id: "orgA", name: "Serving platter, black", photo_url: null },
  { id: "a3", org_id: "orgA", name: "Serving platter, black", photo_url: null },
  { id: "a4", org_id: "orgA", name: "Pewter tankard", photo_url: null },          // no picture for it
  { id: "a5", org_id: "orgA", name: "Mug, monogram A", photo_url: "orgA/a5/mine.jpg" }, // tester's own
  { id: "b1", org_id: "orgB", name: "Anvil", photo_url: null },
  { id: "c1", org_id: "realTheatre", name: "Anvil", photo_url: null },             // not a test copy
];
const fake = fakeSupabase({ links, items });
const logs = [];
const report = await addSamplePhotos(fake, { log: (l) => logs.push(l) });

is("each copy reports what it added", report.map((r) => [r.label, r.added, r.failed.length]), [["Gregg", 3, 0], ["Tester 2", 1, 0]]);
is("both platters get a picture", items.filter((i) => i.name === "Serving platter, black").every((i) => i.photo_url), true);
is("pictures go in that copy's own folder, under that item", items.find((i) => i.id === "a1").photo_url.startsWith("orgA/a1/sample-anvil-"), true);
is("each copy has its own file", new Set(fake.uploads.map((u) => u.path)).size, 4);
is("an item with no matching picture is left alone", items.find((i) => i.id === "a4").photo_url, null);
is("a tester's own photo is kept", items.find((i) => i.id === "a5").photo_url, "orgA/a5/mine.jpg");
is("a theatre that isn't a test copy is never touched", items.find((i) => i.id === "c1").photo_url, null);
is("it says so, one line per copy", logs, ["Gregg: added 3 photos", "Tester 2: added 1 photo"]);

const again = await addSamplePhotos(fake, { log: () => {} });
is("a second run adds nothing", again.map((r) => r.added), [0, 0]);
is("  and uploads nothing more", fake.uploads.length, 4);

// A dry run changes nothing.
const items2 = [{ id: "x1", org_id: "orgA", name: "Anvil", photo_url: null }];
const fake2 = fakeSupabase({ links: [links[0]], items: items2 });
const dry = await addSamplePhotos(fake2, { dryRun: true, log: () => {} });
is("a dry run counts what it would add", dry[0].added, 1);
is("  and uploads and changes nothing", [fake2.uploads.length, items2[0].photo_url], [0, null]);

// One failed upload doesn't stop the rest, and is reported.
const items3 = [
  { id: "y1", org_id: "orgA", name: "Anvil", photo_url: null },
  { id: "y2", org_id: "orgA", name: "Umbrella, blue", photo_url: null },
];
const fake3 = fakeSupabase({ links: [links[0]], items: items3, failUploadFor: "anvil" });
const partial = await addSamplePhotos(fake3, { log: () => {} });
is("a failed upload is reported and the rest carry on", [partial[0].added, partial[0].failed], [1, ["Anvil: quota"]]);
is("  the failed item has no photo", items3[0].photo_url, null);

// .env.local parsing
is("reads .env pairs, trims quotes, skips comments", readEnv('# c\nA=1\r\nB = "two"\nC=\'3\'\n\nnot a pair'), { A: "1", B: "two", C: "3" });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
