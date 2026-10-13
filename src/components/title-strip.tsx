/**
 * The top strip of the installed app on a computer.
 *
 * With "window-controls-overlay" in the manifest, Chrome and Edge drop the
 * title bar they'd otherwise draw over an installed app (the one carrying
 * the browser's own app menu, with "Uninstall…" in it) and leave the page
 * the whole window, bar the minimise / maximise / close buttons. This strip
 * takes that space: the name and mark, in ink like the bar it replaces, and
 * draggable, so the window can still be moved by its top edge.
 *
 * Hidden everywhere else, by CSS (globals.css, .title-strip): in a browser
 * tab, on a phone, and in an installed app still showing its title bar.
 */
export function TitleStrip() {
  return (
    <div className="title-strip" data-title-strip data-print-hide aria-hidden="true">
      {/* The Propolis mark ("Refined", public/brand/propolis-mark.svg),
          with the gap between mask and hexagon in the strip's ink. */}
      <svg viewBox="0 8 149.5 117" width="22" style={{ display: "block" }}>
        <polygon
          points="27.7,11 80.3,11 104.6,57 80.3,103 27.7,103 3.4,57"
          fill="#C98A2C"
          stroke="#C98A2C"
          strokeWidth="6"
          strokeLinejoin="round"
        />
        <g transform="translate(62 14) scale(0.95)">
          <path
            d="M10 8 Q50 0 90 8 L88 60 Q86 105 50 115 Q14 105 12 60 Z"
            fill="#FBF7EC"
            stroke="#2A2219"
            strokeWidth="6"
            strokeLinejoin="round"
          />
          <path d="M10 8 Q50 0 90 8 L88 60 Q86 105 50 115 Q14 105 12 60 Z" fill="#FBF7EC" />
          <path
            d="M26 40 Q35 29 44 40 M56 40 Q65 29 74 40"
            fill="none"
            stroke="#2A2219"
            strokeWidth="5.5"
            strokeLinecap="round"
          />
          <path d="M28 68 Q50 104 72 68 Z" fill="#2A2219" stroke="#2A2219" strokeWidth="3" strokeLinejoin="round" />
        </g>
      </svg>
      <span>Propolis</span>
    </div>
  );
}
