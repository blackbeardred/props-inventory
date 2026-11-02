/**
 * The landing page's hero picture: seven hexagons (two prop photos, the mark
 * on green, brand-color cells and one outline) with a search card showing a
 * search for "wood" finding things nobody labeled wood. It's the Figma
 * design (Landing page, Nov 2026) in code.
 *
 * Cell positions are the Figma desktop geometry as percentages of the
 * honeycomb's own box, so it scales with the column. From md up the search
 * card overlaps the lower left, as in the desktop and tablet designs. On a
 * phone it sits under the honeycomb at full size, so it stays readable.
 */

type Cell =
  | { kind: "photo"; src: string; alt: string }
  | { kind: "mark" }
  | { kind: "fill"; className: string }
  | { kind: "outline" };

// x, y of each cell's top left, in the Figma desktop frame (cells 207 × 179).
const REGION = { x: 47, y: 21, w: 537, h: 560 };
const CELL = { w: 207, h: 179 };
const CELLS: Array<{ x: number; y: number; cell: Cell }> = [
  { x: 47, y: 116, cell: { kind: "mark" } },
  { x: 47, y: 306, cell: { kind: "fill", className: "bg-honey" } },
  { x: 212, y: 21, cell: { kind: "photo", src: "/landing/doublet.jpg", alt: "A black doublet with red trim" } },
  { x: 212, y: 211, cell: { kind: "fill", className: "bg-surface" } },
  { x: 377, y: 306, cell: { kind: "photo", src: "/landing/walking-cane.jpg", alt: "A mahogany walking cane" } },
  { x: 377, y: 116, cell: { kind: "outline" } },
  { x: 212, y: 402, cell: { kind: "fill", className: "bg-accent" } },
];

const pct = (n: number, of: number) => `${(n / of) * 100}%`;

function HexCell({ cell }: { cell: Cell }) {
  if (cell.kind === "outline") {
    return (
      <svg viewBox="0 0 207 179" className="block h-full w-full" aria-hidden="true">
        <polygon
          points="51.75,1 155.25,1 206,89.5 155.25,178 51.75,178 1,89.5"
          fill="none"
          stroke="var(--rule)"
          strokeWidth="2"
        />
      </svg>
    );
  }
  if (cell.kind === "photo") {
    return (
      <div className="hex h-full w-full overflow-hidden bg-surface">
        {/* eslint-disable-next-line @next/next/no-img-element -- small static photo from public/landing */}
        <img src={cell.src} alt={cell.alt} className="h-full w-full object-cover" loading="eager" />
      </div>
    );
  }
  if (cell.kind === "mark") {
    return (
      <div className="hex flex h-full w-full items-center justify-center bg-accent">
        {/* eslint-disable-next-line @next/next/no-img-element -- the brand mark, a static SVG */}
        <img src="/brand/propolis-mark.svg" alt="" className="ml-[6%] block w-[58%]" />
      </div>
    );
  }
  return <div className={`hex h-full w-full ${cell.className}`} aria-hidden="true" />;
}

const RESULTS = [
  ["Walking cane, mahogany", "Costume Storage"],
  ["Wheelbarrow, wooden", "Props Room B"],
  ["Map, framed", "Props Room A › Shelf A"],
];

function SearchCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-rule bg-background p-5 shadow-[0_18px_40px_-8px_rgba(42,34,25,0.22)] ${className}`}
      data-landing-search-card
    >
      <div className="flex items-center gap-2.5 rounded-xl bg-surface px-3.5 py-3">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="var(--muted)" strokeWidth="2" />
          <path d="m20 20-4-4" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="font-body text-base font-semibold text-foreground">wood</span>
        <span className="ml-auto font-body text-[13px] text-muted">3 matches</span>
      </div>
      <ul className="mt-3.5 space-y-3.5">
        {RESULTS.map(([name, where]) => (
          <li key={name} className="flex items-center gap-2.5">
            <span className="hex w-3 shrink-0 bg-honey" aria-hidden="true" />
            <span>
              <span className="block font-body text-[15px] font-semibold leading-snug text-foreground">{name}</span>
              <span className="block font-mono text-[11px] font-bold uppercase tracking-[0.04em] text-muted">{where}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Honeycomb() {
  return (
    <div className="w-full max-w-[350px] md:max-w-[540px] lg:max-w-[500px] xl:max-w-[537px]" data-landing-honeycomb>
      <div
        className="relative mx-auto w-[86%] md:w-full"
        style={{ aspectRatio: `${REGION.w} / ${REGION.h}` }}
        aria-label="Prop photos and the Propolis mark, in a honeycomb"
        role="img"
      >
        {CELLS.map(({ x, y, cell }, i) => (
          <div
            key={i}
            className="absolute"
            style={{
              left: pct(x - REGION.x, REGION.w),
              top: pct(y - REGION.y, REGION.h),
              width: pct(CELL.w, REGION.w),
              height: pct(CELL.h, REGION.h),
            }}
          >
            <HexCell cell={cell} />
          </div>
        ))}
        {/* Tablet and desktop: the card overlaps the lower left. */}
        <SearchCard className="absolute left-[-16%] top-[68%] hidden w-[330px] md:block" />
      </div>
      {/* Phone: under the honeycomb, full width. */}
      <SearchCard className="relative -mt-14 md:hidden" />
    </div>
  );
}
