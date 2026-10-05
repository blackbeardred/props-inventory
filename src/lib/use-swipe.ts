import { useRef, useState } from "react";
import type { TouchEvent } from "react";

/** How far a row travels before letting go does the thing. */
export const SWIPE_THRESHOLD = 110;
/** Movement under this is a tap or a wobble, not a swipe. */
const SLOP = 12;

function startedOnAControl(target: EventTarget | null): boolean {
  return Boolean(
    target instanceof Element && target.closest("button, input, a, select, textarea, label")
  );
}

/**
 * A leftward swipe on a row or a tile: the shared mechanics behind "swipe an
 * item to add it to a production" and "swipe a pull-list line to mark it
 * pulled".
 *
 * Touch only, so a desktop never sees it; every swipe has a button doing the
 * same thing for a mouse, a keyboard or a screen reader. A gesture that starts
 * mostly vertical is left to the page as a scroll. Past the threshold the
 * travel is damped, so the row can be pulled a little further but visibly
 * resists, and letting go short of it springs back and does nothing.
 *
 * Put `touch-action: pan-y` on the element that takes the handlers: the browser
 * keeps vertical scrolling and hands horizontal movement to the row.
 */
export function useSwipeLeft(
  onCommit: () => void,
  {
    enabled = true,
    startOnControls = false,
  }: {
    enabled?: boolean;
    /** For a row that is itself a button: let the swipe start on it, and use
     *  justSwiped() in its onClick. */
    startOnControls?: boolean;
  } = {}
) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ x: number; y: number; swiping: boolean } | null>(null);
  const travelled = useRef(0);
  const swipedAt = useRef(0);

  function onTouchStart(event: TouchEvent) {
    if (!enabled) return;
    if (!startOnControls && startedOnAControl(event.target)) return;
    // From anywhere on the row, the very edge of the screen included: the
    // user asked for a swipe begun at the side to count. (Leftward also stays
    // clear of the iPhone's own back gesture, which starts at the left edge.)
    const touch = event.touches[0];
    gesture.current = { x: touch.clientX, y: touch.clientY, swiping: false };
  }

  function onTouchMove(event: TouchEvent) {
    const start = gesture.current;
    if (!start) return;
    const touch = event.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    if (!start.swiping) {
      if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) {
        gesture.current = null;
        return;
      }
      if (Math.abs(dx) < SLOP || Math.abs(dx) <= Math.abs(dy)) return;
      start.swiping = true;
      setDragging(true);
    }

    const distance = Math.max(0, -dx);
    const eased =
      distance > SWIPE_THRESHOLD
        ? SWIPE_THRESHOLD + (distance - SWIPE_THRESHOLD) * 0.35
        : distance;
    travelled.current = eased;
    setOffset(-eased);
  }

  function finish(allowCommit: boolean) {
    const start = gesture.current;
    gesture.current = null;
    if (!start?.swiping) return;
    swipedAt.current = Date.now();
    const commit = allowCommit && travelled.current >= SWIPE_THRESHOLD;
    travelled.current = 0;
    setDragging(false);
    setOffset(0);
    if (commit) onCommit();
  }

  return {
    offset,
    dragging,
    /** Far enough that letting go now will do it. */
    armed: -offset >= SWIPE_THRESHOLD,
    /** True just after a swipe, so the click some browsers still send at the
     *  end of one doesn't also open or close the card. */
    justSwiped: () => Date.now() - swipedAt.current < 400,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd: () => finish(true),
      // An interrupted gesture (a call coming in, the OS taking over) never
      // counts, however far it had got.
      onTouchCancel: () => finish(false),
    },
    style: {
      transform: offset ? `translateX(${offset}px)` : undefined,
      // Inline, so it replaces the element's own transition: keep the colour
      // ones a hover or a selection would have had.
      transition: dragging
        ? "none"
        : "transform 160ms ease-out, background-color 150ms, border-color 150ms",
      touchAction: "pan-y",
    } as const,
  };
}
