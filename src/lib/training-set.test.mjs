// The training-set layout: labels, twins sharing one, file names, the CSV.
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/training-set.test.mjs

import { PICTURES_PER_LABEL, labelSlug, planTrainingSet, trainingCsv, trainingReadme } from "./training-set.ts";

let pass = 0, fail = 0;
function is(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label} — expected ${e}, got ${a}`); }
}

console.log("── labelSlug");
is("lowercase and hyphens", labelSlug("Brass candlestick"), "brass-candlestick");
is("punctuation and accents go", labelSlug("Chaise-longue, velours (rouge)"), "chaise-longue-velours-rouge");
is("& reads as and", labelSlug("Cup & saucer"), "cup-and-saucer");
is("nothing usable gives a name anyway", labelSlug("—"), "item");
is("kept short, without a trailing hyphen", labelSlug("a ".repeat(40)).length <= 60 && !labelSlug("a ".repeat(40)).endsWith("-"), true);

const items = [
  { id: "c5", name: "Brass candlestick", category: "prop", photo_url: "org1/c5/a.jpg" },
  { id: "c6", name: "Brass candlestick", category: "prop", photo_url: "org1/c6/b.png" },
  { id: "t", name: "Pewter tankard", category: "prop", photo_url: "org1/t/t.jpg" },
  { id: "k", name: "Velvet cloak", category: "costume", photo_url: "org1/k/k.jpg" },
  { id: "n", name: "Bells", category: "prop", photo_url: null },
  { id: "s", name: "Pewter Tankard", category: "prop", photo_url: "org1/s/s.webp" },
];
const pictures = [
  { id: "r1", item_id: "c6", photo_path: "org1/c6/ref-1.jpg", source: "find_by_photo", similarity: 0.884 },
  { id: "r2", item_id: "t", photo_path: "org1/t/ref-2.jpg", source: "prop_table", similarity: null },
  { id: "r3", item_id: "s", photo_path: "org1/s/ref-3.jpg", source: "twin", similarity: null },
  { id: "r4", item_id: "gone", photo_path: "org1/gone/ref-4.jpg", source: "prop_table", similarity: null },
];
const twins = [{ item_id: "c5", twin_set: "S" }, { item_id: "c6", twin_set: "S" }];

console.log("");
console.log("── planTrainingSet");
{
  const plan = planTrainingSet(items, pictures, twins);
  is("only things with a confirmed picture, by default", plan.labels.map((l) => l.label), ["brass-candlestick", "pewter-tankard", "pewter-tankard-2"]);
  is("twins share one label", plan.labels[0].itemIds, ["c5", "c6"]);
  is("…with both their photos and the picture of one", plan.labels[0].files.map((f) => f.path), ["brass-candlestick/c5-photo.jpg", "brass-candlestick/c6-photo.png", "brass-candlestick/r1-find-by-photo.jpg"]);
  is("…and how many people confirmed", plan.labels[0].confirmed, 1);
  is("two different items with one name get two labels", plan.labels.slice(1).map((l) => l.itemIds), [["t"], ["s"]]);
  is("each file knows where it lives in storage", plan.labels[0].files[2].storagePath, "org1/c6/ref-1.jpg");
  is("a picture of an item that's gone is skipped", plan.files.some((f) => f.storagePath.includes("gone")), false);
  is("items left out are counted", plan.leftOut, 2);
  is("files are the labels' files, in order", plan.files.length, plan.labels.reduce((t, l) => t + l.files.length, 0));
  is("no two files share a path", new Set(plan.files.map((f) => f.path)).size, plan.files.length);
}
{
  const plan = planTrainingSet(items, pictures, twins, { includeUnconfirmed: true });
  is("asked for, items with only their own photo are in too", plan.labels.map((l) => l.label), ["brass-candlestick", "pewter-tankard", "pewter-tankard-2", "velvet-cloak"]);
  is("…but an item with no photo at all is still left out", plan.leftOut, 1);
}
is("nothing confirmed, nothing in it", planTrainingSet(items, [], twins).labels.length, 0);
is("labels don't shift when the input order does",
  planTrainingSet([...items].reverse(), [...pictures].reverse(), twins).files.map((f) => f.path),
  planTrainingSet(items, pictures, twins).files.map((f) => f.path));

console.log("");
console.log("── trainingCsv");
{
  const csv = trainingCsv(planTrainingSet(items, pictures, twins).files).split("\r\n");
  is("a header row", csv[0], "file,label,item_id,item_name,category,source,similarity");
  is("one row per file, then a final newline", csv.length, 1 + 7 + 1);
  is("scores to three places", csv.find((r) => r.includes("r1-")), "brass-candlestick/r1-find-by-photo.jpg,brass-candlestick,c6,Brass candlestick,prop,find_by_photo,0.884");
  const quoted = trainingCsv([{ path: "a/b.jpg", label: "a", itemId: "x", itemName: 'Chair, "the big one"', category: "prop", source: "photo", similarity: null }]).split("\r\n")[1];
  is("commas and quotes are escaped", quoted, 'a/b.jpg,a,x,"Chair, ""the big one""",prop,photo,');
}

console.log("");
console.log("── trainingReadme");
{
  const plan = planTrainingSet(items, pictures, twins);
  const text = trainingReadme(plan, { theatre: "SPARC", made: new Date("2026-10-05T12:00:00Z"), missing: ["org1/t/ref-2.jpg"] });
  is("names the theatre and date", text.startsWith("Training set for SPARC\r\nMade 2026-10-05"), true);
  is("counts what's actually in it", text.includes("3 labels, 6 pictures."), true);
  is("says how many are ready to train", text.includes(`0 labels have ${PICTURES_PER_LABEL} or more`), true);
  is("lists what couldn't be downloaded", text.includes("1 picture couldn't be downloaded and isn't included:\r\n  org1/t/ref-2.jpg"), true);
}

console.log("");
console.log(`════ ${pass} passed, ${fail} failed ════`);
if (fail > 0) process.exit(1);
