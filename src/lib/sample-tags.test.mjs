// The sample theatre's search tags (migration 016): every sample item has
// some, each names a material and a colour, and the values in the migration
// and in schema.sql are exactly what scripts/sample-tags.mjs prints from
// supabase/sample-photos/tags.json.
//   node --experimental-strip-types src/lib/sample-tags.test.mjs

import fs from "node:fs";
import { sampleItems, sampleTags, sampleTagsValues } from "../../scripts/sample-tags.mjs";
import { hasMaterialAndColour } from "./ai/tag-words.ts";

let pass = 0, fail = 0;
function is(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label} — expected ${e}, got ${a}`); }
}

const items = sampleItems();
const tags = sampleTags();
const photos = JSON.parse(fs.readFileSync(new URL("../../supabase/sample-photos/photos.json", import.meta.url), "utf8"));

is("all 24 sample items are read from the seed", items.length, 24);
is("tags are written for exactly the photographed names", Object.keys(tags).sort(), Object.keys(photos).sort());
is("every sample item has tags", items.filter(([name]) => !tags[name]?.length).map(([name]) => name), []);
is("every item's tags name a material and a colour",
  Object.entries(tags).filter(([, t]) => !hasMaterialAndColour(t)).map(([name]) => name), []);
is("mahogany cane is wood, and brown", ["wood", "brown"].every((t) => tags["Walking cane, mahogany"].includes(t)), true);
is("the navy crown is blue", tags["Royal crown, blue velvet"].includes("blue"), true);
is("the curtains' rust is orange", tags["Curtains, paisley (pair)"].includes("orange"), true);
is("the telephone's cord doesn't make it rope", tags["Rotary telephone"].includes("rope"), false);
is("no tag that matches the whole theatre", Object.values(tags).flat().filter((t) => ["prop", "stage", "theatrical"].includes(t)), []);

const values = sampleTagsValues();
for (const file of ["migrations/016_sample_tags.sql", "schema.sql"]) {
  const sql = fs.readFileSync(new URL(`../../supabase/${file}`, import.meta.url), "utf8");
  is(`${file} carries exactly the generated tags`, sql.includes(values), true);
}

console.log(`════ ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
