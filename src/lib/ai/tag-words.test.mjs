// Search-tag tidying: materials and colours get their everyday family word.
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/ai/tag-words.test.mjs
import { refineTags, hasMaterialAndColour } from "./tag-words.ts";

let pass = 0, fail = 0;
function is(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label} — expected ${e}, got ${a}`); }
}
const has = (tags, ...want) => want.every((w) => tags.includes(w));

is("mahogany in the name makes it wood (and brown)", has(refineTags(["cane", "walking stick"], "Walking cane, mahogany"), "wood", "brown"), true);
is("mahogany as a tag does too", has(refineTags(["cane", "mahogany"]), "wood", "brown"), true);
is("navy is blue", has(refineTags(["coat", "navy"]), "blue"), true);
is("brass is metal, and gold-coloured", has(refineTags(["candlestick", "brass"]), "metal", "gold"), true);
is("velvet is fabric", refineTags(["cloak", "velvet"]).includes("fabric"), true);
is("porcelain and china are ceramic", has(refineTags(["teapot", "porcelain"]), "ceramic") && has(refineTags(["plate"], "white china plate"), "ceramic"), true);
is("rust is orange", refineTags(["cap"], "orange/rust top cap").includes("orange"), true);
is("grey and gray both", has(refineTags(["charcoal"]), "grey", "gray"), true);
is("two-word shades count: olive green", refineTags(["jacket", "olive green"]).includes("green"), true);
is("cast iron is metal", refineTags(["anvil"], "Cast iron, black").includes("metal"), true);
is("noise words go", refineTags(["prop", "stage", "Theatrical", "crown", "theatre prop"]), ["crown"]);
is("lowercased, trimmed, no repeats", refineTags([" Crown ", "crown", "GOLD"]), ["crown", "gold", "yellow"]);
is("a coffee mug isn't brown, a rose isn't pink", refineTags(["mug", "rose"], "Coffee mug with a rose"), ["mug", "rose"]);
is("the theatre's cast isn't metal", refineTags(["poster"], "signed by the cast").includes("metal"), false);
is("families survive a long answer", refineTags(Array.from({ length: 30 }, (_, i) => `word${i}`), "oak").includes("wood"), true);
is("knows when material and colour are both there", [hasMaterialAndColour(["cane", "wood", "brown"]), hasMaterialAndColour(["cane", "wood"])], [true, false]);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
