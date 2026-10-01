import type { QrSymbol } from "@/lib/qr-svg";

/**
 * A QR code, as squares on white.
 *
 * The colours are literal black and white rather than theme tokens on purpose.
 * A QR code is a contrast measurement: a scanner needs the dark modules
 * genuinely darker than the light ones, printers drop background colours by
 * default, and a code drawn in the app's ink-on-parchment palette would look
 * right on screen and fail on paper. `shapeRendering="crispEdges"` keeps the
 * module edges from being anti-aliased into grey at small sizes.
 */
export function QrCode({
  symbol,
  label,
  className,
}: {
  symbol: QrSymbol;
  /** What a screen reader should say — normally what the code points at. */
  label: string;
  className?: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${symbol.extent} ${symbol.extent}`}
      className={className}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={symbol.extent} height={symbol.extent} fill="#ffffff" />
      <path d={symbol.path} fill="#000000" />
    </svg>
  );
}
