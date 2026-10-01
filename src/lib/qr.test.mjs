// That a symbol this encoder produces is a QR code someone's phone will read.
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/qr.test.mjs
//
// A QR code is either exactly right or it is a picture of squares, and you
// cannot tell which by looking. So this file contains a reader written from the
// spec — separately from the encoder, with its own copy of the block table and
// its own field arithmetic — and every test encodes something and reads it
// back. A mistake would have to be made identically in both directions to slip
// through.
//
// The REFERENCE matrices below came from python-qrcode (byte mode, level M,
// its own choice of mask) and are checked module for module, so the encoder
// can't drift into some other self-consistent scheme. Regenerate with:
//   python3 -c "import qrcode; q=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=0); q.add_data(TEXT.encode()); q.make(fit=True); print(q.get_matrix())"

import { encodeQr, penalty } from "./qr.ts";
import { qrSymbol } from "./qr-svg.ts";

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}\n        expected ${b}\n        actual   ${a}`); }
}
function ok(label, condition, detail = "") {
  if (condition) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`); }
}

/* ══ A reader, from the spec ══ */

// Restated rather than imported: if the encoder's table is wrong, a shared
// table would agree with it and both would be wrong together.
const BLOCKS_M = {
  1: [[1, 26, 16]], 2: [[1, 44, 28]], 3: [[1, 70, 44]], 4: [[2, 50, 32]],
  5: [[2, 67, 43]], 6: [[4, 43, 27]], 7: [[4, 49, 31]],
  8: [[2, 60, 38], [2, 61, 39]], 9: [[3, 58, 36], [2, 59, 37]],
  10: [[4, 69, 43], [1, 70, 44]],
};
const ALIGNMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Every module the data stream is not allowed to use. */
function functionModules(size, version) {
  const taken = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (r, c) => { if (r >= 0 && r < size && c >= 0 && c < size) taken[r][c] = true; };

  for (const [br, bc] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r += 1) for (let c = -1; c <= 7; c += 1) mark(br + r, bc + c);
  }
  for (const r of ALIGNMENT[version]) for (const c of ALIGNMENT[version]) {
    if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) mark(r + dr, c + dc);
  }
  for (let i = 0; i < size; i += 1) { mark(6, i); mark(i, 6); }
  for (let i = 0; i < 9; i += 1) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i += 1) { mark(8, size - 1 - i); mark(size - 1 - i, 8); }
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      mark(size - 11 + (i % 3), Math.floor(i / 3));
      mark(Math.floor(i / 3), size - 11 + (i % 3));
    }
  }
  return taken;
}

/** The second copy of the format information, BCH-checked. */
function readFormat(modules) {
  const size = modules.length;
  let raw = 0;
  for (let i = 0; i <= 7; i += 1) if (modules[8][size - 1 - i]) raw |= 1 << i;
  for (let i = 8; i <= 14; i += 1) if (modules[size - 15 + i][8]) raw |= 1 << i;

  const bits = raw ^ 0b101010000010010;
  let remainder = bits;
  for (let i = 14; i >= 10; i -= 1) {
    if ((remainder >>> i) & 1) remainder ^= 0b10100110111 << (i - 10);
  }
  return { level: (bits >>> 13) & 0b11, mask: (bits >>> 10) & 0b111, valid: remainder === 0 };
}

function readVersionInfo(modules) {
  const size = modules.length;
  let raw = 0;
  for (let i = 0; i < 18; i += 1) {
    if (modules[size - 11 + (i % 3)][Math.floor(i / 3)]) raw |= 1 << i;
  }
  let remainder = raw;
  for (let i = 17; i >= 12; i -= 1) {
    if ((remainder >>> i) & 1) remainder ^= 0b1111100100101 << (i - 12);
  }
  return { version: raw >>> 12, valid: remainder === 0 };
}

/** Reads a symbol back to the text it carries, refusing anything malformed. */
function readQr(modules) {
  const size = modules.length;
  if ((size - 17) % 4 !== 0) throw new Error(`not a QR size: ${size}`);
  const version = (size - 17) / 4;

  const format = readFormat(modules);
  if (!format.valid) throw new Error("format information fails its BCH check");
  if (format.level !== 0b00) throw new Error(`error level is not M (got ${format.level})`);
  if (version >= 7) {
    const info = readVersionInfo(modules);
    if (!info.valid) throw new Error("version information fails its BCH check");
    if (info.version !== version) throw new Error(`version says ${info.version}, size says ${version}`);
  }

  const taken = functionModules(size, version);
  const bits = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const column of [right, right - 1]) {
        if (taken[row][column]) continue;
        const dark = MASKS[format.mask](row, column) ? !modules[row][column] : modules[row][column];
        bits.push(dark ? 1 : 0);
      }
    }
    upward = !upward;
  }

  const stream = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    stream.push(byte);
  }

  // Undo the interleave: the shapes of the blocks say where each byte came from.
  const shapes = [];
  for (const [count, total, data] of BLOCKS_M[version]) {
    for (let i = 0; i < count; i += 1) shapes.push({ total, data });
  }
  const blocks = shapes.map(() => ({ data: [], ec: [] }));
  let cursor = 0;
  const longestData = Math.max(...shapes.map((s) => s.data));
  for (let i = 0; i < longestData; i += 1) {
    for (let b = 0; b < shapes.length; b += 1) {
      if (i < shapes[b].data) blocks[b].data.push(stream[cursor++]);
    }
  }
  const longestEc = Math.max(...shapes.map((s) => s.total - s.data));
  for (let i = 0; i < longestEc; i += 1) {
    for (let b = 0; b < shapes.length; b += 1) {
      if (i < shapes[b].total - shapes[b].data) blocks[b].ec.push(stream[cursor++]);
    }
  }

  // An undamaged block has zero syndromes. Anything else means the error
  // correction was computed over the wrong bytes.
  blocks.forEach((block, index) => {
    const codewords = [...block.data, ...block.ec];
    const ecCount = shapes[index].total - shapes[index].data;
    for (let j = 0; j < ecCount; j += 1) {
      let syndrome = 0;
      for (let i = 0; i < codewords.length; i += 1) {
        syndrome ^= mul(codewords[i], EXP[((codewords.length - 1 - i) * j) % 255]);
      }
      if (syndrome !== 0) throw new Error(`block ${index} fails error correction (syndrome ${j})`);
    }
  });

  const data = blocks.flatMap((block) => block.data);
  const dataBits = data.flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((s) => (byte >>> s) & 1));
  const take = (from, count) => dataBits.slice(from, from + count).reduce((n, bit) => (n << 1) | bit, 0);

  const mode = take(0, 4);
  if (mode !== 0b0100) throw new Error(`not byte mode (got ${mode.toString(2)})`);
  const countBits = version < 10 ? 8 : 16;
  const length = take(4, countBits);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = take(4 + countBits + i * 8, 8);
  return { text: new TextDecoder().decode(bytes), version, mask: format.mask };
}

/* ══ Reference matrices, module for module ══ */

const REFERENCE = {
  shortUrl: {
    text: "https://props.example.org/l/abc123",
    mask: 3,
    version: 3,
    rows: [
      "11111110110001110111101111111",
      "10000010100001001010101000001",
      "10111010010110001010101011101",
      "10111010111010110101001011101",
      "10111010010010101111101011101",
      "10000010001111011101101000001",
      "11111110101010101010101111111",
      "00000000100110011100000000000",
      "10110111010101011111001001011",
      "10100000111011110011101110001",
      "11001110100111001010100100110",
      "11000000101110011011110000001",
      "01010111011010111111010101100",
      "01100100101000110001001000111",
      "01111011000001001111010110111",
      "00001101101000100000011100010",
      "00111110011110101010010111010",
      "01000001101110111100100101110",
      "10011111111101111000100000100",
      "00011001010111100100010100100",
      "01110110000001100100111111100",
      "00000000111000000110100011111",
      "11111110101110101011101011010",
      "10000010100001111010100011000",
      "10111010010110010100111110110",
      "10111010101011011101110011001",
      "10111010100011001001010100101",
      "10000010001001000000111011010",
      "11111110110100100011100101010",
    ],
  },
  uuidUrl: {
    text: "https://props-inventory.vercel.app/items?location=3f8c1a20-7b44-4e8e-9a11-2c5d6e7f8a90",
    mask: 6,
    version: 6,
    rows: [
      "11111110101110001110000011100000101111111",
      "10000010110101101011011001100101101000001",
      "10111010111110110001101011111111101011101",
      "10111010011000110010000000110000101011101",
      "10111010100001111001100001000111001011101",
      "10000010011100110000110100100110101000001",
      "11111110101010101010101010101010101111111",
      "00000000010110111011000011010010000000000",
      "10011111111001101100000010111100110010111",
      "10111101111001011001100101111101000010000",
      "10001010001010100010011101011110011110100",
      "00100100000011110100001100111101111111010",
      "00010111010000101000100100011000011100001",
      "10000001100010010011000011101001111111111",
      "11010011010101010000011001101001111000111",
      "00000100001011001011000010010010110101110",
      "10100110110010010011000101101010010000010",
      "00110000001010011001001011011111010010000",
      "11000110000011010001011100010111111110101",
      "10110100000110000110101010101000110010101",
      "00110111011101111001111011110011001101111",
      "00111101010111000011100101110001110011100",
      "10000111011111111000111100111010101010000",
      "10111100010110001111101010100110011110000",
      "10100011011101100000000110000001111000001",
      "11101001010101111010010100111010111010111",
      "01110011101011000101011011111001111001011",
      "01001101110111000011100100101011001011111",
      "11110010010100011010001111011001110101000",
      "11100001001010101100011101001010101111000",
      "11010111101110110001010011010100110110101",
      "11101101111001001011101101000000001100100",
      "11010010111000001101001110011110111111110",
      "00000000111000010011010100010100100010110",
      "11111110101001100110101100110001101011100",
      "10000010110001011101011110100011100010011",
      "10111010111101110111110011111101111110001",
      "10111010110101101100010100011110000101010",
      "10111010011110111001100000110100010111001",
      "10000010000110010111000100100001001011101",
      "11111110110101011111001001011001110010000",
    ],
  },
  versionTen: {
    text: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    mask: 1,
    version: 10,
    rows: [
      "111111101111110100110000101100110011001100110011001111111",
      "100000100001110010010010111011101110111011101001001000001",
      "101110101110010011100101010001001100010001000111001011101",
      "101110100001101011000101101100100011001100110101001011101",
      "101110100001010101000000111111101011001100110001001011101",
      "100000101000000011011000111000100110111011101110001000001",
      "111111101010101010101010101010101010101010101010101111111",
      "000000000001010100110100111000111011101110111010100000000",
      "101000110110100100011110001111101100110011001100000100101",
      "000101011110010011011101001011001100110011001101010010111",
      "111010111111101110100001010100010001000100010001000101001",
      "000010001000100100110010110100111011101110111010101111001",
      "000110110110100010011001100111001100110011001100010010010",
      "011001011110011011011001111101001100110011001101010010111",
      "111000111011111110100111010110010001000100010001000101001",
      "000110001000111010110001111110111011101110111010101111000",
      "000010110110110000001110011011001100110011001100010010010",
      "010001011000001101011101001011001100110011001101010010111",
      "110010111001111000100101010100010001000100010001000101001",
      "001011001010111101101100110111111011101110111010101111001",
      "000001110010110000011000000011001100110011001100010010010",
      "010011000101001100010001001011101100110011001101010010111",
      "000010110111011001010101010101110001000100010001000101001",
      "011011010010111100010100110110100011101110111010101111001",
      "010001111111110000011000000011000100110011001100010010010",
      "100011011101001100010001001011001100110011001101010010111",
      "000011111110100001011101001111100001000100010001111111001",
      "011010001011101100010100101000111011101110111011100011001",
      "010110101110011010011000011010101100110011001101101010010",
      "110010001100110011010001011000101100110011001101100010111",
      "110011111111110101011101001111110001000100010000111111001",
      "001101011011000010010100111011111011101110111011111011001",
      "010100100110010010011110101001001100110011001101110000010",
      "101010010100100001010110000100101100110011001101001100100",
      "111100110011100101011010100100110001000100010000001101000",
      "000001001001010100010110001011111011101110111011111011000",
      "010011100100011010000010011111001100110011001101110000011",
      "100010010100100101001101001110101100110011001101001100111",
      "110111110011100111011001011100110001000100010000001101001",
      "001011001001010111001000111111111011101110111011111011001",
      "010000100000111011110110001001001100110011001101110000010",
      "100000010010100101011101000100101100110011001101001100111",
      "010100110011000110010001000100110001000100010000001101001",
      "111010001011110111000000111011100011101110111011111011001",
      "010001101100011010101110001001111100110011001101110000010",
      "100010011011100101111101000101001100110011001101001100111",
      "101001100011111111100001000101110001000100010000001101001",
      "111110010010000110001000111011011011101110111011111011001",
      "000000111101011001101110011111101100110011001101111110010",
      "000000001011001101011101011000101100110011001100100010111",
      "111111101011110001100101011010110001000100010000101011001",
      "100000100011001110001100101000111011101110111010100011001",
      "101110100101000011101011101111101100110011001100111110010",
      "101110100011010101011011111110101100110011001101101110100",
      "101110101101101101100001010011010001000100010000110011011",
      "100000100011000010001101101011011011101110111010110011000",
      "111111101011001011100110001100001100110011001101000100001",
    ],
  },
};

console.log("── Against python-qrcode, module for module");

// At a fixed mask, because that is the one place implementations legitimately
// differ: the spec's mask scoring counts the quiet zone as light modules, and
// python-qrcode does not, so the two libraries often prefer different masks
// while agreeing on every other module. Fixing the mask checks the data, the
// error correction, the layout and the format bits, and leaves the heuristic to
// the test below it.
for (const [name, reference] of Object.entries(REFERENCE)) {
  const rows = encodeQr(reference.text, { mask: reference.mask })
    .map((row) => row.map((v) => (v ? "1" : "0")).join(""));
  eq(`${name} is version ${reference.version}`, (rows.length - 17) / 4, reference.version);
  const differing = rows.reduce((total, row, index) => total + (row === reference.rows[index] ? 0 : 1), 0);
  ok(`${name} matches to the module`, differing === 0 && rows.length === reference.rows.length,
     `${differing} of ${rows.length} rows differ`);
}

console.log("");
console.log("── Choosing a mask");

// The heuristic itself: whatever encodeQr returns must be the lowest-scoring of
// the eight, and it must still read back. Which mask that turns out to be is the
// spec's business, not this test's.
for (const text of [
  "https://props.example.org/l/abc123",
  "https://props-inventory.vercel.app/items?location=3f8c1a20-7b44-4e8e-9a11-2c5d6e7f8a90",
  "Rack 3 shelf 2",
  "z".repeat(200),
]) {
  const scores = Array.from({ length: 8 }, (_unused, mask) => penalty(encodeQr(text, { mask })));
  const lowest = Math.min(...scores);
  const chosen = encodeQr(text);
  const asString = (symbol) => symbol.map((row) => row.map((v) => (v ? "1" : "0")).join("")).join("/");
  const matchesA = scores
    .map((score, mask) => ({ score, mask }))
    .filter((entry) => entry.score === lowest)
    .some((entry) => asString(encodeQr(text, { mask: entry.mask })) === asString(chosen));
  ok(`${text.slice(0, 28)}… gets the lowest-scoring mask`, matchesA,
     `scores ${scores.join(", ")}`);
  eq(`${text.slice(0, 28)}… still reads back`, readQr(chosen).text, text);
}

/* ══ Read back what was written ══ */

console.log("");
console.log("── Every symbol reads back as the text that went in");

const PAYLOADS = [
  ["one character", "A"],
  ["exactly fills version 1", "ABCDEFGHIJKLMN"],
  ["a short label URL", "https://props.example.org/l/abc123"],
  ["a location URL with a uuid", "https://props-inventory.vercel.app/items?location=3f8c1a20-7b44-4e8e-9a11-2c5d6e7f8a90"],
  ["accents and a pound sign", "Café crème brûlée — £20, naïve façade"],
  ["a box name someone typed", "Props Room A / Shelf 3 / Shakespeare box (fragile — glassware)"],
  ["long enough for two block groups", "Storage room B, rack 4, shelf 2, box 17 — Twelfth Night, Act II costumes and assorted glassware props for the banquet"],
  ["the longest this encoder takes", "z".repeat(200)],
];

for (const [label, text] of PAYLOADS) {
  try {
    const read = readQr(encodeQr(text));
    eq(`${label} reads back`, read.text, text);
  } catch (error) {
    fail += 1;
    console.log(`  FAIL  ${label} reads back\n        ${error.message}`);
  }
}

console.log("");
console.log("── And at every mask, not just the one the encoder prefers");

for (let mask = 0; mask <= 7; mask += 1) {
  const text = "https://props-inventory.vercel.app/items?location=3f8c1a20-7b44-4e8e-9a11-2c5d6e7f8a90";
  try {
    const read = readQr(encodeQr(text, { mask }));
    ok(`mask ${mask} reads back, and says it is mask ${mask}`,
       read.text === text && read.mask === mask,
       `read mask ${read.mask}, text ${read.text === text ? "ok" : "wrong"}`);
  } catch (error) {
    fail += 1;
    console.log(`  FAIL  mask ${mask} reads back\n        ${error.message}`);
  }
}

console.log("");
console.log("── Every version 1 to 10, including the ones that carry a version block");

// Byte counts that land on each version in turn: one below the next version's
// floor, so each is the largest payload its version can hold.
const seenVersions = new Set();
let checkedLengths = 0;
for (let length = 1; length <= 213; length += 1) {
  let read;
  try {
    read = readQr(encodeQr("x".repeat(length)));
  } catch (error) {
    fail += 1;
    console.log(`  FAIL  ${length} bytes reads back\n        ${error.message}`);
    continue;
  }
  if (read.text !== "x".repeat(length)) {
    fail += 1;
    console.log(`  FAIL  ${length} bytes reads back as itself`);
    continue;
  }
  seenVersions.add(read.version);
  checkedLengths += 1;
}
eq("every version got exercised", [...seenVersions].sort((a, b) => a - b),
   [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
eq("every length from 1 to 213 bytes read back", checkedLengths, 213);

/* ══ Structure ══ */

console.log("");
console.log("── The parts a scanner looks for first");

const symbol = encodeQr("https://props.example.org/l/abc123");
const size = symbol.length;

eq("square", symbol.every((row) => row.length === size), true);
eq("a size the spec allows", (size - 17) % 4, 0);

const finderCorners = [[0, 0], [0, size - 7], [size - 7, 0]];
ok("three finder patterns, each a ring round a block", finderCorners.every(([br, bc]) => {
  for (let r = 0; r < 7; r += 1) for (let c = 0; c < 7; c += 1) {
    const ring = r === 0 || r === 6 || c === 0 || c === 6;
    const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
    if (symbol[br + r][bc + c] !== (ring || core)) return false;
  }
  return true;
}));
ok("no fourth finder in the last corner", (() => {
  // An alignment pattern sits near that corner, so the check is that the 7×7
  // there is not a finder, not that it is empty.
  let matches = 0;
  for (let r = 0; r < 7; r += 1) for (let c = 0; c < 7; c += 1) {
    const ring = r === 0 || r === 6 || c === 0 || c === 6;
    const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
    if (symbol[size - 7 + r][size - 7 + c] === (ring || core)) matches += 1;
  }
  return matches < 49;
})());
ok("the timing patterns alternate", (() => {
  for (let i = 8; i < size - 8; i += 1) {
    if (symbol[6][i] !== (i % 2 === 0)) return false;
    if (symbol[i][6] !== (i % 2 === 0)) return false;
  }
  return true;
})());
ok("the module that is dark in every symbol ever made", symbol[size - 8][8] === true);

const small = encodeQr("A");
ok("version 1 carries no version block", (() => {
  // Below version 7 those 18 modules are ordinary data, so all that can be
  // said is that the field is not a valid version 1 declaration.
  const info = readVersionInfo(small);
  return !(info.valid && info.version === 1);
})());
const large = encodeQr("z".repeat(200));
const largeInfo = readVersionInfo(large);
ok("version 10 declares itself, BCH and all", largeInfo.valid && largeInfo.version === 10);

/* ══ Refusals ══ */

console.log("");
console.log("── What it refuses");

function throws(label, body) {
  try { body(); fail += 1; console.log(`  FAIL  ${label} (nothing thrown)`); }
  catch { pass += 1; console.log(`  PASS  ${label}`); }
}
throws("empty text", () => encodeQr(""));
throws("more than version 10 holds", () => encodeQr("z".repeat(217)));
ok("exactly what version 10 holds is fine", encodeQr("z".repeat(213)).length === 57);

console.log("");
console.log("── The SVG path draws the same symbol");

// The renderer merges runs of dark modules into one path segment each, which is
// where a picture quietly loses a module. Read the path back into a grid and
// compare it with what was encoded.
for (const text of ["A", "https://props.example.org/l/abc123", "z".repeat(200)]) {
  const modules = encodeQr(text);
  const size = modules.length;
  const quiet = 4;
  const { path, extent } = qrSymbol(text, quiet);

  const drawn = Array.from({ length: extent }, () => new Array(extent).fill(false));
  const segments = [...path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)];
  for (const [, x, y, run] of segments) {
    for (let i = 0; i < Number(run); i += 1) drawn[Number(y)][Number(x) + i] = true;
  }

  eq(`${text.slice(0, 20)}… viewBox leaves a quiet zone both sides`, extent, size + quiet * 2);
  ok(`${text.slice(0, 20)}… path is nothing but module runs`,
     segments.map((s) => s[0]).join("") === path,
     "the path contains something the reader above didn't recognise");
  ok(`${text.slice(0, 20)}… every module is drawn where it was encoded`, (() => {
    for (let r = 0; r < extent; r += 1) {
      for (let c = 0; c < extent; c += 1) {
        const inside = r >= quiet && r < quiet + size && c >= quiet && c < quiet + size;
        const expected = inside ? modules[r - quiet][c - quiet] : false;
        if (drawn[r][c] !== expected) return false;
      }
    }
    return true;
  })());
}

console.log("");
console.log(`════ ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
