// Leave-one-out recognition check: ranking like match_items, twins shared.
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/recognition-check.test.mjs

import { normalise, parseVector, rankItems, runCheck, share } from "./recognition-check.ts";

let pass = 0, fail = 0;
function is(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label} — expected ${e}, got ${a}`); }
}
const v = (...xs) => normalise(xs);
const pic = (key, itemId, ...xs) => ({ key, itemId, vector: v(...xs) });

console.log("── parseVector");
is("pgvector text", [...parseVector("[0.5,-1,2e-3]")].map((x) => +x.toFixed(4)), [0.5, -1, 0.002]);
is("nonsense is null", parseVector("[1,abc]"), null);
is("nothing is null", parseVector(null), null);

console.log("");
console.log("── rankItems");
const pictures = [
  pic("globe-own", "globe", 1, 0, 0),
  pic("globe-ref", "globe", 0.9, 0.1, 0),
  pic("tank-own", "tankard", 0, 1, 0),
  pic("c5-own", "c5", 0, 0, 1),
];
{
  const ranked = rankItems(v(1, 0, 0), pictures);
  is("closest first", ranked.map((r) => r.itemId), ["globe", "c5", "tankard"].sort((a, b) => (a === "globe" ? -1 : b === "globe" ? 1 : a.localeCompare(b))));
  is("an item scores as its best picture", +ranked[0].score.toFixed(3), 1);
  const skipped = rankItems(v(1, 0, 0), pictures, new Map(), "globe-own");
  is("leaving its own picture out, it scores by the other", +skipped[0].score.toFixed(3), +(0.9 / Math.hypot(0.9, 0.1)).toFixed(3));
}
{
  const twins = new Map([["c5", ["c5", "c6"]], ["c6", ["c5", "c6"]]]);
  const ranked = rankItems(v(0, 0, 1), pictures, twins);
  is("a twin with no picture of its own scores as its twin's", ranked.slice(0, 2).map((r) => [r.itemId, +r.score.toFixed(3)]), [["c5", 1], ["c6", 1]]);
}

console.log("");
console.log("── runCheck");
{
  const trials = [
    { key: "globe-ref", itemId: "globe", vector: v(0.9, 0.1, 0) },   // found first via its own photo
    { key: "tank-ref", itemId: "tankard", vector: v(0.8, 0.6, 0) }, // closer to the globe: missed
    { key: "c5-own", itemId: "c5", vector: v(0, 0, 1) },             // the only picture of c5: unscorable
  ];
  const all = [...pictures, pic("tank-ref", "tankard", 0.8, 0.6, 0)];
  const summary = runCheck(trials, all);
  is("counts what could be scored", [summary.scored, summary.unscorable], [2, 1]);
  is("first place", summary.first, 1);
  is("top three", summary.topThree, 2);
  const miss = summary.results.find((r) => r.key === "tank-ref");
  is("a miss says what came first and where the right one was", [miss.rank, miss.topItemId], [2, "globe"]);
  is("the held-out picture isn't matched against itself", summary.results[0].rank, 1);
}
{
  const twins = new Map([["c5", ["c5", "c6"]], ["c6", ["c5", "c6"]]]);
  const all = [...pictures, pic("c6-ref", "c6", 0.1, 0, 1)];
  const summary = runCheck([{ key: "c6-ref", itemId: "c6", vector: v(0.1, 0, 1) }], all, twins);
  is("a twin's picture finding its twin counts as right", summary.results[0].rank, 1);
}
is("share", share(17, 20), "17 of 20 (85%)");
is("share of nothing", share(0, 0), "none to test");

console.log("");
console.log(`════ ${pass} passed, ${fail} failed ════`);
if (fail > 0) process.exit(1);
