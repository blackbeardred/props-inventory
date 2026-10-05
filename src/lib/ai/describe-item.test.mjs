// What the "fill in from the photo" reader has to survive from the model.
// Run with:
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/ai/describe-item.test.mjs

import { parsePhotoSuggestion, cleanTags, mergeTags } from "./describe-item-parse.ts";

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}\n        expected ${b}\n        actual   ${a}`); }
}

console.log("── the user's example: a white cup");
const cup = parsePhotoSuggestion(JSON.stringify({
  name: "White cup",
  category: "prop",
  description: "Plain white ceramic cup with a curved handle, no markings.",
  condition: null,
  tags: ["cup", "mug", "ceramic", "white", "drink", "tableware", "kitchen"],
}));
eq("named as it would be on a shelf label", cup?.name, "White cup");
eq("a prop", cup?.category, "prop");
eq("described", cup?.description, "Plain white ceramic cup with a curved handle, no markings.");
eq("no condition guessed", cup?.condition, null);
eq("the hidden tags", cup?.tags, ["cup", "mug", "ceramic", "white", "drink", "tableware", "kitchen"]);

console.log("── tidying what the model writes");
const messy = parsePhotoSuggestion('```json\n{"name": "  \\"red velvet cloak.\\" ", "category": "Costume", "condition": "Needs repair", "tags": ["Cloak", "cloak", "  Velvet ", "", 4, "' + "x".repeat(41) + '"]}\n```');
eq("fences, quotes, full stop and spacing gone; capitalised", messy?.name, "Red velvet cloak");
eq("category read whatever the case", messy?.category, "costume");
eq("'Needs repair' understood", messy?.condition, "needs_repair");
eq("tags lowercased, de-duplicated, junk dropped", messy?.tags, ["cloak", "velvet"]);
eq("no description is an empty string", messy?.description, "");
eq("a sentence around the object is ignored", parsePhotoSuggestion('Here you go: {"name": "brass bell"} Hope that helps.')?.name, "Brass bell");
eq("an unknown category is a prop", parsePhotoSuggestion('{"name": "Chair", "category": "furniture"}')?.category, "prop");
eq("an unknown condition is dropped", parsePhotoSuggestion('{"name": "Chair", "condition": "vintage"}')?.condition, null);
const long = parsePhotoSuggestion(JSON.stringify({ name: "Antique ".repeat(12) + "lamp", description: "word ".repeat(100) }));
eq("a long name is cut at a word", long?.name.length <= 60 && !long?.name.endsWith(" "), true);
eq("a long description is cut with an ellipsis", long?.description.endsWith("…") && long.description.length <= 300, true);

console.log("── nothing usable");
eq("not JSON", parsePhotoSuggestion("I can't tell what this is."), null);
eq("an array", parsePhotoSuggestion('["cup"]'), null);
eq("no name", parsePhotoSuggestion('{"category": "prop"}'), null);
eq("a blank name", parsePhotoSuggestion('{"name": "  ."}'), null);

console.log("── tags from the form and at save");
eq("only strings, at most 15", cleanTags([..."abcdefghijklmnopq"].map((c) => c + c)).length, 15);
eq("not a list: none", cleanTags("cup,mug"), []);
eq("save's tags first, then the photo's, no repeats", mergeTags(["cup", "white"], ["white", "ceramic"]), ["cup", "white", "ceramic"]);
eq("capped at 20", mergeTags([..."abcdefghijklmno"].map((c) => c + "1"), [..."abcdefghij"].map((c) => c + "2")).length, 20);

console.log("");
console.log(`════ ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
