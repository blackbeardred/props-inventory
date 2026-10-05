// Combining the name search with the picture, and when that's sure enough to tick.
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/visual-match.test.mjs

import {
  describeSimilarity,
  mergeCandidates,
  pickObvious,
  picturesDisagree,
  MAX_MERGED,
  SAME_PICTURE_SIMILARITY,
  STRONG_SIMILARITY,
  worthKeepingAsReference,
} from "./visual-match.ts";

let pass = 0, fail = 0;
function is(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label} — expected ${e}, got ${a}`); }
}

const item = (id, name, extra = {}) => ({ id, name, ...extra });
const hit = (id, name, similarity, extra = {}) => ({ id, name, similarity, ...extra });
const ids = (list) => list.map((c) => c.id);

console.log("── describeSimilarity");
is("0.95 is strong", describeSimilarity(0.95), "strong");
is("0.9 exactly is strong", describeSimilarity(0.9), "strong");
is("0.8 is likely", describeSimilarity(0.8), "likely");
is("0.75 exactly is likely", describeSimilarity(0.75), "likely");
is("0.7 is weak", describeSimilarity(0.7), "weak");

console.log("");
console.log("── mergeCandidates");
{
  const merged = mergeCandidates([item("a", "Goblet"), item("b", "Goblet stand")], []);
  is("no pictures: name order kept", ids(merged), ["a", "b"]);
  is("no pictures: every similarity is null", merged.map((c) => c.similarity), [null, null]);
  is("no pictures: all found by name", merged.map((c) => c.foundBy), ["name", "name"]);
}
{
  // The case the whole feature is for: the name search can't find it.
  const merged = mergeCandidates([], [hit("c", "Chalice, pewter", 0.88)]);
  is("a picture-only match is offered", ids(merged), ["c"]);
  is("…and says it came from the picture", merged[0].foundBy, "picture");
}
{
  const merged = mergeCandidates([], [hit("c", "Chalice", 0.6)]);
  is("a weak picture-only match is dropped", ids(merged), []);
}
{
  const merged = mergeCandidates(
    [item("a", "Candlestick"), item("b", "Candlestick"), item("c", "Candlestick")],
    [hit("c", "Candlestick", 0.93), hit("a", "Candlestick", 0.8)]
  );
  is("closest picture first, then the rest in name order", ids(merged), ["c", "a", "b"]);
  is("both-found is marked as such", merged.map((c) => c.foundBy), ["both", "both", "name"]);
}
{
  // A name result that the picture says is weakly alike keeps its name slot
  // rather than being shoved below name results with no picture at all.
  const merged = mergeCandidates(
    [item("a", "Tankard"), item("b", "Tankard stand")],
    [hit("a", "Tankard", 0.5)]
  );
  is("weak similarity doesn't reorder name results", ids(merged), ["a", "b"]);
  is("…but the weak score is still recorded", merged[0].similarity, 0.5);
}
{
  const merged = mergeCandidates(
    [item("a", "Tankard", { alreadyListed: true })],
    [hit("a", "Tankard", 0.91, { alreadyListed: false })]
  );
  is("the name result's own fields win when both found it", merged[0].alreadyListed, true);
}
{
  const merged = mergeCandidates([item("a", "A"), item("a", "A")], [hit("b", "B", 0.8), hit("b", "B", 0.85)]);
  is("duplicates collapse", ids(merged), ["b", "a"]);
  is("…keeping the higher score", merged[0].similarity, 0.85);
}
{
  const many = Array.from({ length: 12 }, (_, i) => item(`n${i}`, `Thing ${i}`));
  is("capped", mergeCandidates(many, [hit("p", "P", 0.8)]).length, MAX_MERGED);
  is("the cap keeps the picture match", ids(mergeCandidates(many, [hit("p", "P", 0.8)]))[0], "p");
}

console.log("");
console.log("── pickObvious");
{
  const merged = mergeCandidates([item("a", "Pewter tankard"), item("b", "Tankard stand")], []);
  is("no pictures: same as before — the name match", pickObvious("pewter tankard", merged)?.id, "a");
}
{
  const merged = mergeCandidates([], [hit("c", "Chalice, pewter", 0.97)]);
  is("a picture alone never ticks anything", pickObvious("goblet", merged), null);
}
{
  // Six candlesticks, all called the same thing; the picture says which.
  const merged = mergeCandidates(
    [item("a", "Brass candlestick"), item("b", "Brass candlestick"), item("c", "Brass candlestick")],
    [hit("b", "Brass candlestick", 0.92), hit("a", "Brass candlestick", 0.81)]
  );
  is("several names agree: the one that looks most alike", pickObvious("brass candlestick", merged)?.id, "b");
}
{
  const merged = mergeCandidates(
    [item("a", "Brass candlestick"), item("b", "Brass candlestick")],
    [hit("b", "Brass candlestick", 0.6)]
  );
  is("a weak score still beats no score", pickObvious("brass candlestick", merged)?.id, "b");
}
{
  // The name says one thing, the picture strongly says another.
  const merged = mergeCandidates(
    [item("a", "Pewter tankard")],
    [hit("z", "Wooden tankard", 0.94), hit("a", "Pewter tankard", 0.55)]
  );
  is("the picture contradicting the name ticks nothing", pickObvious("pewter tankard", merged), null);
}
{
  const merged = mergeCandidates(
    [item("a", "Pewter tankard")],
    [hit("z", "Wooden tankard", 0.94), hit("a", "Pewter tankard", 0.8)]
  );
  is("not a contradiction if the name match also looks alike", pickObvious("pewter tankard", merged)?.id, "a");
}
{
  const merged = mergeCandidates([item("a", "Pewter tankard")], [hit("z", "Wooden tankard", 0.94)]);
  is("no score for the name match is not a contradiction", pickObvious("pewter tankard", merged)?.id, "a");
}
{
  const merged = mergeCandidates([item("a", "Ladderback chair, carved oak")], [hit("a", "Ladderback chair, carved oak", 0.99)]);
  is("a vague name doesn't tick, however alike the picture", pickObvious("chair", merged), null);
}
is("nothing to choose from", pickObvious("anything", []), null);

console.log("");
console.log("── picturesDisagree");
{
  const vetoed = mergeCandidates(
    [item("a", "Pewter tankard")],
    [hit("z", "Wooden tankard", 0.94), hit("a", "Pewter tankard", 0.55)]
  );
  is("a vetoed name match is a disagreement", picturesDisagree("pewter tankard", vetoed), true);
  const agreed = mergeCandidates([item("a", "Pewter tankard")], [hit("a", "Pewter tankard", 0.92)]);
  is("agreement is not", picturesDisagree("pewter tankard", agreed), false);
  const nothing = mergeCandidates([], [hit("c", "Chalice", 0.97)]);
  is("no name match at all is not a disagreement", picturesDisagree("goblet", nothing), false);
}

console.log("");
console.log("── worthKeepingAsReference");
is("a different photo of the same thing is kept", worthKeepingAsReference(0.86), true);
is("a weak but confirmed match is kept (a person said so)", worthKeepingAsReference(0.41), true);
is("a match made by name alone is kept", worthKeepingAsReference(null), true);
is("…and one with no score at all", worthKeepingAsReference(undefined), true);
is("the item's own photo chosen again is not", worthKeepingAsReference(0.999), false);
is("the line sits exactly at SAME_PICTURE_SIMILARITY", worthKeepingAsReference(SAME_PICTURE_SIMILARITY), false);
is("just under it is kept", worthKeepingAsReference(SAME_PICTURE_SIMILARITY - 0.001), true);
is("a nonsense score doesn't throw a photo away", worthKeepingAsReference(Number.NaN), true);
is("…and the line is above 'almost certainly'", SAME_PICTURE_SIMILARITY > STRONG_SIMILARITY, true);

console.log("");
console.log(`════ ${pass} passed, ${fail} failed ════`);
if (fail > 0) process.exit(1);
