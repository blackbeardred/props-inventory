// The search tags the sample theatre's items start with (migration 016), so
// a tester's search for "wood" or "gold" works from the first minute, with no
// AI call per copy.
//
//   node --experimental-strip-types scripts/sample-tags.mjs   print the SQL values list
//
// The tags themselves are written by hand, from each sample photo, in
// supabase/sample-photos/tags.json. They go through refineTags, the same tidy
// the AI tags get, so every material and colour carries its family word
// (mahogany → wood, navy → blue). Each item's description comes from the
// seed in migration 015, so migration 016 only replaces the tags of an item
// a tester hasn't rewritten. src/lib/sample-tags.test.mjs checks that the
// values list in migration 016 is exactly what this prints.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { refineTags } from "../src/lib/ai/tag-words.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUPABASE = path.join(HERE, "..", "supabase");

/** [name, description] for every sample item, from the seed in migration 015. */
export function sampleItems() {
  const sql = fs.readFileSync(path.join(SUPABASE, "migrations", "015_sample_places.sql"), "utf8");
  const seed = sql.slice(sql.indexOf("insert into items"), sql.indexOf(") as seed("));
  const row = /^\s*\(\w+, '((?:[^']|'')*)', '\w+', '((?:[^']|'')*)'/gm;
  return [...seed.matchAll(row)].map((m) => [m[1].replace(/''/g, "'"), m[2].replace(/''/g, "'")]);
}

/** name → the tags it starts with. */
export function sampleTags() {
  const written = JSON.parse(fs.readFileSync(path.join(SUPABASE, "sample-photos", "tags.json"), "utf8"));
  return Object.fromEntries(Object.entries(written).map(([name, tags]) => [name, refineTags(tags, name)]));
}

const lit = (text) => `'${text.replace(/'/g, "''")}'`;

/** The values list migration 016 carries: (name, description, tags). */
export function sampleTagsValues() {
  const tags = sampleTags();
  return sampleItems()
    .map(([name, description]) => {
      if (!tags[name]) throw new Error(`No tags for ${name} in supabase/sample-photos/tags.json`);
      return `    (${lit(name)}, ${lit(description)}, array[${tags[name].map(lit).join(", ")}])`;
    })
    .join(",\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(sampleTagsValues());
}
