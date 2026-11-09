"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * One costume on a pull list (migration 019): "Margaret costume · 7 pieces ·
 * 3 pulled", which opens to show each piece.
 *
 * It follows the app's hexagon rule: the hexagon means "this opens". Honey
 * when shut, ink and turned 90° when open. The panel animates
 * grid-template-rows 0fr → 1fr, so it opens to exactly the height of its
 * pieces. A shut panel is `inert`, out of the tab order and away from screen
 * readers, but its pieces stay in the page.
 */
export function CostumeRow({
  id,
  name,
  pieces,
  pulled,
  defaultOpen,
  children,
}: {
  id: string;
  name: string;
  pieces: number;
  pulled: number;
  /** Open on arrival: just made, just added to, or asked for (?open=). */
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const allOut = pieces > 0 && pulled === pieces;

  return (
    <li id={`costume-${id}`} data-costume={name} data-open={open ? "true" : "false"} className="scroll-mt-24">
      <button
        type="button"
        data-costume-toggle
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
        className="group flex min-h-11 w-full cursor-pointer items-center gap-3 px-5 py-3 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent md:px-0"
      >
        <span
          aria-hidden="true"
          className={`hex inline-block w-5 shrink-0 transition-[rotate,background-color] duration-200 ease-out motion-reduce:transition-none ${
            open ? "rotate-90 bg-foreground" : "bg-honey motion-safe:group-hover:rotate-90"
          }`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-body text-sm font-semibold text-foreground">{name}</span>
          <span className="block font-mono text-[11px] text-muted" data-costume-summary>
            {pieces} piece{pieces === 1 ? "" : "s"}
            {pieces ? ` · ${allOut ? "all pulled" : `${pulled} pulled`}` : " yet"}
          </span>
        </span>
      </button>
      <div
        id={panelId}
        inert={!open}
        data-costume-panel
        className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        {/* The inner div owns the overflow, because a grid item can't hide its own. */}
        <div className="overflow-hidden">
          <div className="border-l-2 border-honey/50 pb-3 md:ml-2.5 md:pl-4">{children}</div>
        </div>
      </div>
    </li>
  );
}
