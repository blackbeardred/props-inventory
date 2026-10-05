"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";

/**
 * Right-click on a computer does what a swipe does on a phone.
 *
 * Every row that can be swiped also answers a right-click (and the keyboard's
 * menu key, or Shift+F10) with a small menu of the same actions, so nobody at
 * a desk has to open a card to find them. The browser's own menu is still one
 * Shift away, and stays put on links, fields and selected text, where "open in
 * a new tab" or "copy" is what a right-click is for.
 *
 * Not on touch: Android raises the same event for a long press, and there the
 * swipe is the gesture. One menu at a time, drawn in a portal so a row's
 * transform or overflow can't clip or misplace it.
 */

export type MenuItem = {
  label: string;
  /** A quieter second line, e.g. what a disabled item is waiting for. */
  detail?: string;
  disabled?: boolean;
  onSelect: () => void;
};

let lastPointerWasTouch = false;
let closeOpenMenu: (() => void) | null = null;

if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (event) => {
      lastPointerWasTouch = event.pointerType === "touch";
    },
    { capture: true, passive: true }
  );
}

function wantsBrowserMenu(event: ReactMouseEvent): boolean {
  if (event.shiftKey) return true;
  const target = event.target as Element;
  if (target.closest("a, input, textarea, select, [contenteditable='true']")) return true;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && selection.toString().trim()) return true;
  return false;
}

/**
 * Gives a row a right-click menu. Spread `onContextMenu` onto the row and
 * render `menu` anywhere inside it. Items are worked out when the menu opens,
 * so they always match the row as it is now.
 */
export function useContextMenu(title: string, getItems: () => MenuItem[]) {
  const [open, setOpen] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const close = useCallback(() => setOpen(null), []);

  function onContextMenu(event: ReactMouseEvent) {
    const fromKeyboard = event.clientX === 0 && event.clientY === 0;
    if (lastPointerWasTouch && !fromKeyboard) return;
    if (wantsBrowserMenu(event)) return;
    const items = getItems();
    if (items.length === 0) return;
    event.preventDefault();
    closeOpenMenu?.();

    // From the keyboard the event has no pointer position: open by the row.
    let { clientX: x, clientY: y } = event;
    if (fromKeyboard) {
      const box = (event.currentTarget as Element).getBoundingClientRect();
      x = box.left + 24;
      y = box.top + Math.min(box.height, 48);
    }
    setOpen({ x, y, items });
  }

  const menu = open ? (
    <MenuPanel
      title={title}
      x={open.x}
      y={open.y}
      items={open.items}
      onClose={close}
    />
  ) : null;

  return { onContextMenu, menu, isOpen: open !== null };
}

function MenuPanel({
  title,
  x,
  y,
  items,
  onClose,
}: {
  title: string;
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: x, top: y });
  const returnFocus = useRef<Element | null>(null);

  // Kept inside the window: flipped up or left when it would run off.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const margin = 8;
    const left = x + box.width + margin > window.innerWidth ? Math.max(margin, x - box.width) : x;
    const top = y + box.height + margin > window.innerHeight ? Math.max(margin, y - box.height) : y;
    // Measured, then placed: the size isn't known until it has rendered once.
    setPlace({ left, top });
  }, [x, y]);

  useEffect(() => {
    returnFocus.current = document.activeElement;
    closeOpenMenu = onClose;
    ref.current?.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onAway = () => onClose();
    // Closed by the page actually moving, not by a scroll event that was
    // already on its way when the menu opened (a scroll-into-view settling).
    const from = { x: window.scrollX, y: window.scrollY };
    const onScroll = () => {
      if (Math.abs(window.scrollY - from.y) > 4 || Math.abs(window.scrollX - from.x) > 4) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onAway);
    window.addEventListener("blur", onAway);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onAway);
      window.removeEventListener("blur", onAway);
      if (closeOpenMenu === onClose) closeOpenMenu = null;
      if (returnFocus.current instanceof HTMLElement) returnFocus.current.focus({ preventScroll: true });
    };
  }, [onClose]);

  function onKeyDown(event: ReactKeyboardEvent) {
    const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not([disabled])") ?? [])];
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      all[(at + 1) % all.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      all[(at - 1 + all.length) % all.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      all[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      all[all.length - 1]?.focus();
    }
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={title}
      data-context-menu
      data-print-hide
      onKeyDown={onKeyDown}
      // Its own right-click shouldn't open another one, or the browser's.
      onContextMenu={(event) => event.preventDefault()}
      style={{ left: place.left, top: place.top }}
      className="fixed z-[60] w-64 overflow-hidden rounded-lg border border-rule bg-background py-1 shadow-xl"
    >
      <p className="truncate px-3 pb-1 pt-1.5 font-mono text-[11px] text-muted">{title}</p>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
          className="flex w-full items-start gap-2.5 px-3 py-2 text-left font-body text-sm text-foreground outline-none transition-colors hover:bg-surface focus-visible:bg-surface disabled:cursor-default disabled:text-muted disabled:hover:bg-transparent"
        >
          <span
            aria-hidden="true"
            className={`hex mt-1 w-2.5 shrink-0 ${item.disabled ? "bg-rule" : "bg-honey"}`}
          />
          <span className="min-w-0">
            <span className="block truncate">{item.label}</span>
            {item.detail ? (
              <span className="block truncate font-mono text-[11px] text-muted">{item.detail}</span>
            ) : null}
          </span>
        </button>
      ))}
      <p className="mt-1 border-t border-dashed border-rule px-3 pb-1 pt-1.5 font-mono text-[10px] text-muted">
        Shift + right-click for the browser’s menu
      </p>
    </div>,
    document.body
  );
}
