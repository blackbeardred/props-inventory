// A QR encoder, for printing a label per storage location.
//
// Hand-written for the same reason the .xlsx reader is: the job is bounded —
// a short URL, encoded once, rendered as squares — and the alternative is a
// dependency in the bundle and an npm install on someone's machine for
// something the spec describes completely.
//
// Scope: byte mode, error correction level M (recovers ~15%, which is right
// for a label that will get dusty), versions 1 to 10, which covers a URL of
// about 270 characters. Everything here is checked against a reference
// implementation in src/lib/qr.test.mjs rather than trusted.

/** A finished symbol: true is a dark module. */
export type QrMatrix = boolean[][];

/** How many data codewords fit at error level M, indexed by version. */
const DATA_CODEWORDS_M: Record<number, number> = {
  1: 16, 2: 28, 3: 44, 4: 64, 5: 86,
  6: 108, 7: 124, 8: 154, 9: 182, 10: 216,
};

/**
 * Error-correction blocks at level M: how many blocks of each shape, and how
 * many of a block's codewords are data. The rest are error correction, and a
 * symbol is only readable if every block gets exactly its own share.
 */
const EC_BLOCKS_M: Record<number, { count: number; total: number; data: number }[]> = {
  1: [{ count: 1, total: 26, data: 16 }],
  2: [{ count: 1, total: 44, data: 28 }],
  3: [{ count: 1, total: 70, data: 44 }],
  4: [{ count: 2, total: 50, data: 32 }],
  5: [{ count: 2, total: 67, data: 43 }],
  6: [{ count: 4, total: 43, data: 27 }],
  7: [{ count: 4, total: 49, data: 31 }],
  8: [{ count: 2, total: 60, data: 38 }, { count: 2, total: 61, data: 39 }],
  9: [{ count: 3, total: 58, data: 36 }, { count: 2, total: 59, data: 37 }],
  10: [{ count: 4, total: 69, data: 43 }, { count: 1, total: 70, data: 44 }],
};

/** Centres of the alignment patterns, by version. */
const ALIGNMENT_CENTRES: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const MAX_VERSION = 10;

/* ── Galois field arithmetic, for the error-correction codewords ── */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // the QR field's primitive polynomial
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}

function multiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** The generator polynomial for `degree` error-correction codewords. */
function generatorPolynomial(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= multiply(poly[j], 1);
      next[j + 1] ^= multiply(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function errorCorrectionFor(data: number[], count: number): number[] {
  const generator = generatorPolynomial(count);
  const remainder = new Array<number>(count).fill(0);

  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < count; i += 1) {
      remainder[i] ^= multiply(generator[i + 1], factor);
    }
  }
  return remainder;
}

/* ── Bit stream ── */

class Bits {
  readonly values: number[] = [];

  push(value: number, length: number) {
    for (let i = length - 1; i >= 0; i -= 1) {
      this.values.push((value >>> i) & 1);
    }
  }

  get length() {
    return this.values.length;
  }
}

/** The smallest version whose data capacity fits this many bytes. */
function versionFor(byteLength: number): number {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const countBits = version < 10 ? 8 : 16;
    const needed = 4 + countBits + byteLength * 8;
    if (needed <= DATA_CODEWORDS_M[version] * 8) return version;
  }
  throw new Error("That text is too long for a printable QR code.");
}

function dataCodewords(text: string, version: number): number[] {
  const bytes = new TextEncoder().encode(text);
  const capacity = DATA_CODEWORDS_M[version];
  const bits = new Bits();

  bits.push(0b0100, 4); // byte mode
  bits.push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) bits.push(byte, 8);

  // Terminator, then pad to a whole byte.
  const remaining = capacity * 8 - bits.length;
  bits.push(0, Math.min(4, remaining));
  while (bits.length % 8 !== 0) bits.push(0, 1);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits.values[i + j];
    codewords.push(byte);
  }

  // The two pad bytes the spec names, alternating, until the block is full.
  const PAD = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < capacity) {
    codewords.push(PAD[padIndex % 2]);
    padIndex += 1;
  }
  return codewords;
}

/** Data and error-correction codewords, interleaved as the spec requires. */
function finalCodewords(text: string, version: number): number[] {
  const data = dataCodewords(text, version);
  const groups = EC_BLOCKS_M[version];

  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  for (const group of groups) {
    for (let i = 0; i < group.count; i += 1) {
      const slice = data.slice(offset, offset + group.data);
      offset += group.data;
      blocks.push({ data: slice, ec: errorCorrectionFor(slice, group.total - group.data) });
    }
  }

  const out: number[] = [];
  const longestData = Math.max(...blocks.map((block) => block.data.length));
  for (let i = 0; i < longestData; i += 1) {
    for (const block of blocks) {
      if (i < block.data.length) out.push(block.data[i]);
    }
  }
  const longestEc = Math.max(...blocks.map((block) => block.ec.length));
  for (let i = 0; i < longestEc; i += 1) {
    for (const block of blocks) {
      if (i < block.ec.length) out.push(block.ec[i]);
    }
  }
  return out;
}

/* ── Laying out the symbol ── */

type Grid = {
  modules: (boolean | null)[][];
  reserved: boolean[][];
  size: number;
};

function emptyGrid(version: number): Grid {
  const size = version * 4 + 17;
  return {
    size,
    modules: Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null)),
    reserved: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  };
}

function place(grid: Grid, row: number, column: number, dark: boolean) {
  grid.modules[row][column] = dark;
  grid.reserved[row][column] = true;
}

function drawFinder(grid: Grid, row: number, column: number) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const y = row + r;
      const x = column + c;
      if (y < 0 || y >= grid.size || x < 0 || x >= grid.size) continue;
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      place(grid, y, x, inRing || inCore);
    }
  }
}

function drawAlignment(grid: Grid, version: number) {
  const centres = ALIGNMENT_CENTRES[version];
  for (const row of centres) {
    for (const column of centres) {
      // Not where the finders already are.
      const nearFinder =
        (row === 6 && column === 6) ||
        (row === 6 && column === grid.size - 7) ||
        (row === grid.size - 7 && column === 6);
      if (nearFinder) continue;

      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const edge = Math.max(Math.abs(r), Math.abs(c));
          place(grid, row + r, column + c, edge !== 1);
        }
      }
    }
  }
}

function drawTiming(grid: Grid) {
  for (let i = 8; i < grid.size - 8; i += 1) {
    const dark = i % 2 === 0;
    place(grid, 6, i, dark);
    place(grid, i, 6, dark);
  }
}

function reserveFormat(grid: Grid) {
  for (let i = 0; i < 9; i += 1) {
    if (!grid.reserved[8][i]) grid.reserved[8][i] = true;
    if (!grid.reserved[i][8]) grid.reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i += 1) {
    grid.reserved[8][grid.size - 1 - i] = true;
    grid.reserved[grid.size - 1 - i][8] = true;
  }
  // The one module that is always dark.
  place(grid, grid.size - 8, 8, true);
}

/**
 * Version 7 and up carry their own version number in two 3×6 blocks beside the
 * lower-left and upper-right finders, BCH-coded.
 *
 * Leaving this out is invisible in a picture — the symbol looks like a QR code,
 * and the small versions that don't need it scan perfectly — but no reader will
 * touch a version 7+ symbol without it. Found by decoding every version this
 * encoder can produce rather than by looking at them.
 */
function drawVersion(grid: Grid, version: number) {
  if (version < 7) return;

  let bits = version << 12;
  for (let i = 17; i >= 12; i -= 1) {
    if ((bits >>> i) & 1) bits ^= 0b1111100100101 << (i - 12);
  }
  const value = (version << 12) | bits;

  for (let i = 0; i < 18; i += 1) {
    const dark = ((value >>> i) & 1) === 1;
    const along = Math.floor(i / 3);
    const across = i % 3;
    place(grid, grid.size - 11 + across, along, dark);
    place(grid, along, grid.size - 11 + across, dark);
  }
}

function placeData(grid: Grid, codewords: number[]) {
  let bitIndex = 0;
  const bitAt = (index: number) => {
    const byte = codewords[index >> 3];
    if (byte === undefined) return false;
    return ((byte >>> (7 - (index & 7))) & 1) === 1;
  };

  let upward = true;
  for (let right = grid.size - 1; right >= 1; right -= 2) {
    // The vertical timing column is skipped entirely.
    if (right === 6) right = 5;

    for (let step = 0; step < grid.size; step += 1) {
      const row = upward ? grid.size - 1 - step : step;
      for (const column of [right, right - 1]) {
        if (grid.reserved[row][column]) continue;
        grid.modules[row][column] = bitAt(bitIndex);
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

const MASKS: ((row: number, column: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Format information: error level M with the chosen mask, BCH-coded. */
function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // 00 is level M
  let bits = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((bits >>> i) & 1) bits ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | bits) ^ 0b101010000010010;
}

function drawFormat(grid: Grid, mask: number) {
  const bits = formatBits(mask);
  const bitAt = (index: number) => ((bits >>> index) & 1) === 1;

  // Written twice, in two places, so a damaged corner doesn't cost the
  // reader the mask. Both copies run down column 8 and along row 8 — getting
  // those two the wrong way round is invisible until a scanner refuses.
  for (let i = 0; i <= 5; i += 1) grid.modules[i][8] = bitAt(i);
  grid.modules[7][8] = bitAt(6);
  grid.modules[8][8] = bitAt(7);
  grid.modules[8][7] = bitAt(8);
  for (let i = 9; i <= 14; i += 1) grid.modules[8][14 - i] = bitAt(i);

  // The second copy runs the other way about: the low bits along row 8 from
  // the right edge, the high bits up column 8 from the bottom. Reading them
  // off a working symbol was the only way to get this right.
  for (let i = 0; i <= 7; i += 1) grid.modules[8][grid.size - 1 - i] = bitAt(i);
  for (let i = 8; i <= 14; i += 1) grid.modules[grid.size - 15 + i][8] = bitAt(i);

  // One module is dark in every symbol ever made, and it sits in the middle
  // of that run, so it goes back afterwards.
  grid.modules[grid.size - 8][8] = true;
}

/**
 * The spec's four penalties, used to choose the least ugly mask.
 *
 * Exported so the test can check that the mask chosen really is the
 * lowest-scoring one.
 *
 * One judgement call: for the third penalty — a finder-like run of modules,
 * which a scanner can mistake for a real finder — the four light modules beside
 * it are counted as present when they fall off the edge of the symbol, because
 * a printed label has a quiet zone and that zone is light. The reference
 * implementations disagree here (python-qrcode requires all eleven modules to
 * be inside the symbol), so this encoder and that one often settle on different
 * masks while agreeing on every other module. Both scan.
 */
export function penalty(modules: boolean[][]): number {
  const size = modules.length;
  let score = 0;

  // Runs of five or more in a line.
  for (const transposed of [false, true]) {
    for (let a = 0; a < size; a += 1) {
      let run = 1;
      for (let b = 1; b < size; b += 1) {
        const current = transposed ? modules[b][a] : modules[a][b];
        const previous = transposed ? modules[b - 1][a] : modules[a][b - 1];
        if (current === previous) {
          run += 1;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          run = 1;
        }
      }
    }
  }

  // Two-by-two blocks of one colour.
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const value = modules[r][c];
      if (
        value === modules[r][c + 1] &&
        value === modules[r + 1][c] &&
        value === modules[r + 1][c + 1]
      ) {
        score += 3;
      }
    }
  }

  // The finder-like pattern, in either direction.
  const PATTERN = [true, false, true, true, true, false, true];
  const matches = (line: boolean[], at: number) =>
    PATTERN.every((value, index) => line[at + index] === value);
  const clear = (line: boolean[], from: number, to: number) => {
    for (let i = from; i < to; i += 1) {
      if (i >= 0 && i < size && line[i]) return false;
    }
    return true;
  };

  for (const transposed of [false, true]) {
    for (let a = 0; a < size; a += 1) {
      const line = transposed ? modules.map((row) => row[a]) : modules[a];
      for (let b = 0; b + 7 <= size; b += 1) {
        if (!matches(line, b)) continue;
        if (clear(line, b - 4, b) || clear(line, b + 7, b + 11)) score += 40;
      }
    }
  }

  // Imbalance between dark and light.
  const dark = modules.flat().filter(Boolean).length;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/**
 * Encodes text as a QR symbol. The matrix has no quiet zone; whatever renders
 * it is responsible for the margin, because that depends on the medium.
 */
export function encodeQr(text: string, options?: { mask?: number }): QrMatrix {
  if (!text) throw new Error("Nothing to encode.");

  const byteLength = new TextEncoder().encode(text).length;
  const version = versionFor(byteLength);
  const codewords = finalCodewords(text, version);

  const base = emptyGrid(version);
  drawFinder(base, 0, 0);
  drawFinder(base, 0, base.size - 7);
  drawFinder(base, base.size - 7, 0);
  drawAlignment(base, version);
  drawTiming(base);
  reserveFormat(base);
  drawVersion(base, version);
  placeData(base, codewords);

  let best: boolean[][] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  const masksToTry =
    options?.mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [options.mask];

  for (const mask of masksToTry) {
    const candidate: Grid = {
      size: base.size,
      reserved: base.reserved,
      modules: base.modules.map((row) => [...row]),
    };

    for (let r = 0; r < candidate.size; r += 1) {
      for (let c = 0; c < candidate.size; c += 1) {
        if (candidate.reserved[r][c]) continue;
        if (MASKS[mask](r, c)) candidate.modules[r][c] = !candidate.modules[r][c];
      }
    }
    drawFormat(candidate, mask);

    const modules = candidate.modules.map((row) => row.map((value) => value === true));
    const score = penalty(modules);
    if (score < bestScore) {
      bestScore = score;
      best = modules;
    }
  }

  return best!;
}
