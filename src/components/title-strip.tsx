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
      <svg viewBox="0 0 120 116" width="15" style={{ display: "block" }}>
        <rect x="16" y="0.6" width="16" height="111.4" fill="currentColor" />
        <polygon
          points="28,44 49,7.6 91,7.6 112,44 91,80.4 49,80.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="14"
          strokeLinejoin="miter"
        />
        <polygon points="47,44 58.5,24.1 81.5,24.1 93,44 81.5,63.9 58.5,63.9" fill="#C98A2C" />
      </svg>
      <span>Propolis</span>
    </div>
  );
}
