// Turning a QR matrix into something a printer can put on paper.
//
// One <path> of merged horizontal runs rather than a rect per module: a
// version 10 symbol is 3,249 modules, and a sheet of thirty labels made of
// individual rects is a megabyte of markup that a browser lays out slowly and
// a printer renders with hairline gaps between the squares.

import { encodeQr } from "./qr";

export type QrSymbol = {
  /** An SVG path, in module units, ready for fill-rule nonzero. */
  path: string;
  /** The side of the viewBox, including the quiet zone. */
  extent: number;
};

/**
 * The four-module quiet zone the spec asks for. Scanners lock on much faster
 * with it, and on a label it costs nothing: it is the white paper already
 * round the code.
 */
const QUIET_ZONE = 4;

export function qrSymbol(text: string, quietZone: number = QUIET_ZONE): QrSymbol {
  const modules = encodeQr(text);
  const size = modules.length;

  const parts: string[] = [];
  for (let row = 0; row < size; row += 1) {
    let column = 0;
    while (column < size) {
      if (!modules[row][column]) {
        column += 1;
        continue;
      }
      let run = 1;
      while (column + run < size && modules[row][column + run]) run += 1;
      parts.push(`M${column + quietZone} ${row + quietZone}h${run}v1h-${run}z`);
      column += run;
    }
  }

  return { path: parts.join(""), extent: size + quietZone * 2 };
}
