"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  buildLocationTree,
  flattenLocationTree,
  matchLocations,
  type LocationNode,
  type LocationTreeNode,
} from "@/lib/locations";

/**
 * Choosing where something lives, by walking in rather than by scrolling a
 * list of every bin in the building.
 *
 * The old control was a `<select>` of full paths — "Props Room A / Shelf 3 /
 * Shakespeare box" — which is fine at a dozen locations and unreadable at two
 * hundred: every option is prefixed by the same few words, so you read to the
 * end of each line to tell them apart. Here, opening a room shows what is in
 * that room and nothing else.
 *
 * Two ways in, because people arrive knowing different things. If you know
 * roughly where it goes, you walk: rooms, then shelves, then boxes. If you
 * know what the box is called, you type, and the list flattens to full paths
 * across the whole tree so you can see which "Shakespeare box" you mean.
 *
 * A container is also a place in its own right — things live loose on a shelf,
 * not only in the boxes on it — so every row can be chosen, and the arrow that
 * walks into it is a separate control beside it.
 */
/** How tall the list would like to be, given the room. */
const LIST_HEIGHT = 256;
/** And the least it can be and still be worth opening. */
const MIN_LIST_HEIGHT = 96;
/** Roughly what the panel costs above the list: the search box, a breadcrumb. */
const PANEL_CHROME = 88;
/** How wide it would like to be, for a full path. */
const PANEL_WIDTH = 384;
/** Breathing room kept between the panel and the edge of the window. */
const WINDOW_MARGIN = 12;

type Fit = { dropUp: boolean; alignRight: boolean; maxWidth: number; listHeight: number };

export function LocationPicker({
  nodes,
  value,
  onChange,
  label,
  noneLabel = "Unassigned",
  /** Hidden from the list and from search — a location can't live inside itself. */
  excludeId,
  placeholder = "Type to find a shelf, box or room",
}: {
  nodes: LocationNode[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  noneLabel?: string;
  excludeId?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /** Ids from the outermost space to the one whose contents are showing. */
  const [trail, setTrail] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  /** Where the panel can go without leaving the window. Re-measured, not
   *  assumed: see measure(). */
  const [fit, setFit] = useState<Fit>({
    dropUp: false,
    alignRight: false,
    maxWidth: PANEL_WIDTH,
    listHeight: LIST_HEIGHT,
  });

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const tree = useMemo(() => buildLocationTree(nodes), [nodes]);
  const flat = useMemo(() => flattenLocationTree(tree), [tree]);
  const byId = useMemo(() => new Map(flat.map((n) => [n.id, n])), [flat]);

  const hidden = useMemo(() => {
    if (!excludeId) return new Set<string>();
    const node = byId.get(excludeId);
    if (!node) return new Set<string>();
    // The location and everything inside it: making a room a child of its own
    // shelf detaches both from the tree.
    return new Set(flattenLocationTree([node]).map((n) => n.id));
  }, [excludeId, byId]);

  const chosen = value ? byId.get(value) : undefined;

  /** The container whose contents are on screen, if we've walked into one. */
  const here = trail.length > 0 ? byId.get(trail[trail.length - 1]) : undefined;

  type Row =
    | { kind: "none" }
    | { kind: "up"; to: string[]; name: string }
    | { kind: "self"; node: LocationTreeNode }
    | { kind: "location"; node: LocationTreeNode; showPath: boolean };

  const rows = useMemo<Row[]>(() => {
    if (query.trim()) {
      const found = matchLocations(flat, query).filter((n) => !hidden.has(n.id));
      return found.slice(0, 50).map((node) => ({ kind: "location", node, showPath: true }));
    }

    const list: Row[] = [];
    if (here) {
      list.push({
        kind: "up",
        to: trail.slice(0, -1),
        name: trail.length > 1 ? (byId.get(trail[trail.length - 2])?.name ?? "") : "",
      });
      list.push({ kind: "self", node: here });
    } else {
      list.push({ kind: "none" });
    }

    const siblings = here ? here.children : tree;
    for (const node of siblings) {
      if (!hidden.has(node.id)) list.push({ kind: "location", node, showPath: false });
    }
    return list;
  }, [query, flat, hidden, here, trail, byId, tree]);

  /**
   * Where the panel fits right now.
   *
   * Measured rather than assumed, because every lazy answer is wrong
   * somewhere: this field is the last row of the item form and sits in the
   * right-hand column of a two-column grid, so "always below" puts it off the
   * bottom of a short window and "always left-aligned" puts it off the side of
   * a phone.
   *
   * It reads the *visual* viewport, not window.innerHeight. On a phone, tapping
   * this field opens the keyboard, and the keyboard does not change
   * innerHeight — it covers the bottom of it. A panel measured against
   * innerHeight is a panel measured against a strip of screen that is now
   * underneath the keyboard, which is exactly where its search box would end
   * up while you were typing into it.
   */
  const measure = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;

    const vv = window.visualViewport;
    const viewTop = vv ? vv.offsetTop : 0;
    const viewLeft = vv ? vv.offsetLeft : 0;
    const viewHeight = vv ? vv.height : window.innerHeight;
    const viewWidth = vv ? vv.width : window.innerWidth;

    const below = viewTop + viewHeight - rect.bottom - WINDOW_MARGIN;
    const above = rect.top - viewTop - WINDOW_MARGIN;
    const dropUp = below < LIST_HEIGHT + PANEL_CHROME && above > below;
    const room = (dropUp ? above : below) - PANEL_CHROME;

    const maxWidth = Math.min(PANEL_WIDTH, viewWidth - 2 * WINDOW_MARGIN);

    const next: Fit = {
      dropUp,
      alignRight: rect.left - viewLeft + maxWidth > viewWidth - WINDOW_MARGIN,
      maxWidth,
      // Never below the floor: a list two rows tall is worse than one that
      // overlaps a little and can be scrolled.
      listHeight: Math.max(MIN_LIST_HEIGHT, Math.min(LIST_HEIGHT, room)),
    };

    setFit((current) =>
      current.dropUp === next.dropUp &&
      current.alignRight === next.alignRight &&
      current.maxWidth === next.maxWidth &&
      current.listHeight === next.listHeight
        ? current
        : next,
    );
  }, []);

  // Open where the chosen thing lives, not at the top — editing an item filed
  // four deep should not start the walk over.
  function openPanel() {
    setQuery("");
    setTrail(chosen ? chosen.trail : []);
    setActive(0);
    measure();
    setOpen(true);
  }

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // The keyboard opening, the page scrolling, the phone being turned — all of
  // them move the ground under an open panel, and none of them fire anything
  // that a measurement taken once at open time would hear about.
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const onChange = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const vv = window.visualViewport;
    vv?.addEventListener("resize", onChange);
    vv?.addEventListener("scroll", onChange);
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", onChange);
      vv?.removeEventListener("scroll", onChange);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Clamped at render rather than corrected afterwards: the list changes under
  // the cursor on every keystroke, and storing an index that is briefly past
  // the end means a render where it points at nothing.
  const activeIndex = Math.min(active, Math.max(rows.length - 1, 0));

  function choose(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  function walkInto(node: LocationTreeNode) {
    setTrail([...node.trail, node.id]);
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  }

  function activate(row: Row) {
    if (row.kind === "up") {
      setTrail(row.to);
      setActive(0);
      return;
    }
    // A room with shelves in it opens; a shelf with nothing in it is the
    // answer. To file something in the room itself, open it and take the
    // "Put it in … itself" row waiting at the top. Searching is different:
    // you typed that box's name, so tapping it means that box.
    if (row.kind === "location" && !row.showPath && row.node.children.length > 0) {
      walkInto(row.node);
      return;
    }
    choose(row.kind === "none" ? "" : row.node.id);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + rows.length) % Math.max(rows.length, 1));
      return;
    }
    const row = rows[activeIndex];
    if (event.key === "Enter") {
      event.preventDefault();
      if (row) activate(row);
      return;
    }
    // Right walks in, left walks out — the same two keys a file tree uses.
    // Right still works from a search result, which Enter would choose.
    if (event.key === "ArrowRight" && row?.kind === "location" && row.node.children.length > 0) {
      event.preventDefault();
      walkInto(row.node);
      return;
    }
    if (event.key === "ArrowLeft" && !query && trail.length > 0) {
      event.preventDefault();
      setTrail(trail.slice(0, -1));
      setActive(0);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <span className="mb-1.5 block font-body text-sm text-muted">{label}</span>

      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md border border-rule bg-surface px-3 py-2 text-left font-body text-sm outline-none transition-colors hover:border-accent-soft focus-visible:border-accent"
      >
        <span className={`min-w-0 flex-1 truncate ${chosen ? "text-foreground" : "text-muted"}`}>
          {chosen ? chosen.path : noneLabel}
        </span>
        <span
          aria-hidden="true"
          className={`hex w-[11px] shrink-0 transition-[rotate] duration-200 ease-out ${
            open ? "rotate-90 bg-foreground" : "bg-honey"
          }`}
          data-hex-toggle
        />
      </button>

      {open ? (
        <div
          // Wide enough for a full path when there is one to show, never
          // narrower than the field, and never past the edge of the window.
          style={{ maxWidth: fit.maxWidth }}
          className={`absolute z-20 w-max min-w-full overflow-hidden rounded-md border border-rule bg-background shadow-lg ${
            fit.dropUp ? "bottom-full mb-1" : "top-full mt-1"
          } ${fit.alignRight ? "right-0" : "left-0"}`}
        >
          <div className="border-b border-rule p-2">
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-autocomplete="list"
              value={query}
              placeholder={placeholder}
              // Box names are names: a phone capitalising and autocorrecting
              // them turns "Rack 3" into "Rack 3." and finds nothing.
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              className="w-full rounded border border-rule bg-surface px-2 py-1.5 font-body text-sm text-foreground outline-none transition-colors focus:border-accent"
            />
          </div>

          {!query && here ? (
            <p className="truncate border-b border-rule px-3 py-1.5 font-mono text-[11px] text-muted">
              {here.path}
            </p>
          ) : null}

          <ul
            id={listboxId}
            role="listbox"
            // overscroll-contain so flicking past the end of the list on a
            // phone doesn't hand the scroll to the page behind it.
            style={{ maxHeight: fit.listHeight }}
            className="overflow-y-auto overscroll-contain py-1"
          >
            {rows.length === 0 ? (
              <li className="px-3 py-2 font-body text-sm text-muted">
                Nothing here matches “{query.trim()}”.
              </li>
            ) : null}

            {rows.map((row, index) => {
              const isActive = index === activeIndex;
              const key =
                row.kind === "none" ? "none"
                : row.kind === "up" ? "up"
                : row.kind === "self" ? `self-${row.node.id}`
                : row.node.id;

              const selected =
                (row.kind === "none" && !value) ||
                ((row.kind === "location" || row.kind === "self") && row.node.id === value);

              // Browsing, and there is something inside: the row opens it.
              // Searching, or nothing inside: the row is the answer.
              const opens = row.kind === "location" && !row.showPath && row.node.children.length > 0;

              return (
                <li key={key} role="option" aria-selected={selected && !opens}>
                  <button
                    type="button"
                    onClick={() => activate(row)}
                    onMouseEnter={() => setActive(index)}
                    aria-label={
                      opens && row.kind === "location"
                        ? `Open ${row.node.name}, ${row.node.children.length} inside`
                        : undefined
                    }
                    // One control, the whole width of the row. Roomier on a
                    // phone, where this is a thumb rather than a pointer.
                    className={`group flex w-full items-center gap-2 px-3 py-2.5 text-left font-body text-sm outline-none sm:py-1.5 ${
                      isActive ? "bg-accent-soft/15" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      {row.kind === "none" ? (
                        <span className="text-muted">{noneLabel}</span>
                      ) : row.kind === "up" ? (
                        <span className="font-mono text-[11px] text-muted">
                          ← {row.name ? `Back to ${row.name}` : "Back to the top"}
                        </span>
                      ) : row.kind === "self" ? (
                        <span className="text-foreground">
                          Put it in <span className="font-medium">{row.node.name}</span> itself
                        </span>
                      ) : (
                        <>
                          <span className="block truncate text-foreground">{row.node.name}</span>
                          {row.showPath && row.node.trail.length > 0 ? (
                            <span className="block truncate font-mono text-[11px] text-muted">
                              {row.node.path.slice(0, -row.node.name.length - 3)}
                            </span>
                          ) : null}
                        </>
                      )}
                    </span>

                    {opens && row.kind === "location" ? (
                      // The hexagon says this one opens rather than answers,
                      // and turns to say so again under the pointer.
                      <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-muted">
                        {row.node.children.length}
                        <span
                          aria-hidden="true"
                          data-hex-toggle
                          className="hex w-[9px] bg-honey transition-[rotate] duration-200 ease-out group-hover:rotate-90 group-focus-visible:rotate-90"
                        />
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
