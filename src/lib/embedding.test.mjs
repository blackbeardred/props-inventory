// Tests for the parts of the fingerprinting that are arithmetic rather than
// machine learning. CLIP itself needs a browser and a 40MB download, so it is
// exercised by hand on the fingerprint page, not here — but everything that
// decides what reaches the database is checked here, because a malformed
// vector doesn't fail loudly, it quietly matches the wrong prop.
//
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/embedding.test.mjs

import assert from "node:assert/strict";
import {
  EMBEDDING_DIMENSIONS,
  checkEmbedding,
  l2Normalize,
  similarity,
  toVectorLiteral,
} from "@/lib/embedding";

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}\n        ${error.message}`);
  }
}

const filled = (value) => new Float32Array(EMBEDDING_DIMENSIONS).fill(value);

console.log("── l2Normalize");
test("scales a vector to unit length", () => {
  const out = l2Normalize([3, 4]);
  assert.deepEqual(out, [0.6, 0.8]);
});
test("leaves an already-normal vector alone", () => {
  const out = l2Normalize([1, 0, 0]);
  assert.deepEqual(out, [1, 0, 0]);
});
test("keeps direction, only magnitude changes", () => {
  const out = l2Normalize([2, 4, 4]);
  assert.equal(Math.round(out[1] / out[0]), 2);
});
test("a zero vector comes back unchanged, not as NaNs", () => {
  // Cosine distance against a zero vector is undefined. Postgres would take
  // NaNs happily and then rank nonsense.
  const out = l2Normalize([0, 0, 0]);
  assert.deepEqual(out, [0, 0, 0]);
});
test("handles a Float32Array as readily as an array", () => {
  const out = l2Normalize(filled(0.5));
  assert.equal(out.length, EMBEDDING_DIMENSIONS);
  assert.ok(Math.abs(Math.hypot(...out) - 1) < 1e-6);
});
test("the result really is unit length", () => {
  const values = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => Math.sin(i));
  assert.ok(Math.abs(Math.hypot(...l2Normalize(values)) - 1) < 1e-6);
});

console.log("── checkEmbedding");
test("accepts the right shape", () => {
  assert.equal(checkEmbedding(filled(0.1)), null);
});
test("rejects too few numbers, and says how many it got", () => {
  const problem = checkEmbedding([1, 2, 3]);
  assert.match(problem, /got 3/);
});
test("rejects too many", () => {
  assert.ok(checkEmbedding(new Float32Array(768)));
});
test("rejects a NaN", () => {
  const values = filled(0.1);
  values[7] = NaN;
  assert.match(checkEmbedding(values), /isn't a number/);
});
test("rejects an Infinity", () => {
  const values = filled(0.1);
  values[0] = Infinity;
  assert.ok(checkEmbedding(values));
});
test("an empty vector is refused rather than treated as zero-length", () => {
  assert.ok(checkEmbedding([]));
});

console.log("── toVectorLiteral");
test("writes pgvector's bracketed form", () => {
  assert.equal(toVectorLiteral([1, 0.5, -0.25]), "[1.000000,0.500000,-0.250000]");
});
test("keeps six decimals, well inside float32", () => {
  assert.equal(toVectorLiteral([0.123456789]), "[0.123457]");
});
test("never emits scientific notation, which Postgres would reject", () => {
  // toString() on a small number gives "1e-7"; toFixed does not.
  assert.equal(toVectorLiteral([0.0000001]), "[0.000000]");
  assert.ok(!toVectorLiteral([1e-9, 2e-8]).includes("e"));
});
test("a full-length vector has 512 numbers in it", () => {
  const literal = toVectorLiteral(filled(0.01));
  assert.equal(literal.split(",").length, EMBEDDING_DIMENSIONS);
  assert.ok(literal.startsWith("[") && literal.endsWith("]"));
});

console.log("── similarity");
test("a fingerprint against itself is 1", () => {
  const values = l2Normalize([0.2, 0.9, 0.4]);
  assert.ok(Math.abs(similarity(values, values) - 1) < 1e-9);
});
test("two unrelated directions score 0", () => {
  assert.ok(Math.abs(similarity([1, 0], [0, 1])) < 1e-9);
});
test("the opposite direction scores -1", () => {
  assert.ok(similarity([1, 0], [-1, 0]) < -0.99);
});
test("a near-match scores high but not 1", () => {
  const score = similarity([1, 0], l2Normalize([0.95, 0.05]));
  assert.ok(score > 0.9 && score < 1);
});
test("mismatched lengths score 0 rather than throwing", () => {
  assert.equal(similarity([1, 0], [1, 0, 0]), 0);
});
test("normalising first doesn't change the score", () => {
  const a = [3, 1, 4];
  const b = [1, 5, 9];
  const raw = similarity(a, b);
  const normalised = similarity(l2Normalize(a), l2Normalize(b));
  assert.ok(Math.abs(raw - normalised) < 1e-9);
});

console.log("");
console.log(`════ ${passed} passed, ${failed} failed ════`);
process.exit(failed === 0 ? 0 : 1);
