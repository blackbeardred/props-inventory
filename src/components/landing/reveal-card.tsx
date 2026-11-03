"use client";

/**
 * A landing-page card that shows only its heading until it's tapped, then
 * opens in place to show the rest.
 *
 * It follows the app's own hexagon rule rather than inventing a new control:
 * the hexagon means "this opens". Honey when shut, ink and turned 90° when
 * open, and a shut one turns under the pointer. The panel animates
 * grid-template-rows 0fr → 1fr, like the item cell, so it opens to exactly
 * the height of what's inside, however long the text runs.
 *
 * The hidden text stays in the page, so search engines and Ctrl+F still find
 * it. `inert` keeps a closed panel out of the tab order and away from screen
 * readers until it's opened.
 */

import { useId, useState, type ReactNode } from "react";

export function RevealCard({
  heading,
  layout,
  hexClassName,
  headingClassName,
  className,
  children,
}: {
  /** What shows while the card is shut. */
  heading: ReactNode;
  /** "stack": the hexagon sits above the heading. "inline": beside it. */
  layout: "stack" | "inline";
  /** The hexagon's width, e.g. "w-8". Give it a width only: `.hex` sets its own height. */
  hexClassName: string;
  headingClassName: string;
  /** The card itself (the list item). */
  className: string;
  /** What the card reveals when opened. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <li className={className}>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((was) => !was)}
          // Ringed on the button rather than the hexagon: a clip-path clips the
          // element's own outline. 44px tall at least, so it's thumb-sized.
          className={`group flex min-h-11 w-full cursor-pointer rounded-lg text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${
            layout === "stack" ? "flex-col items-start gap-4" : "items-center gap-2.5"
          }`}
        >
          <span
            aria-hidden="true"
            className={`hex inline-block shrink-0 transition-[rotate,background-color] duration-200 ease-out motion-reduce:transition-none ${hexClassName} ${
              open ? "rotate-90 bg-foreground" : "bg-honey motion-safe:group-hover:rotate-90"
            }`}
          />
          <span className={headingClassName}>{heading}</span>
        </button>
      </h3>
      <div
        id={panelId}
        inert={!open}
        data-reveal-panel
        className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        {/* The inner div owns the overflow, because a grid item can't hide its own. */}
        <div className="overflow-hidden">{children}</div>
      </div>
    </li>
  );
}
