"use client";

/**
 * A <details> dropdown that closes the way people expect a menu to: on a
 * click or tap anywhere outside it, on Escape, on choosing something in it,
 * and when the page changes.
 *
 * A bare <details> only closes when its own summary is clicked again, so a
 * menu built on one stays hanging open after you click away. The element
 * stays a <details>, so it still opens and closes without JavaScript; this only
 * adds the closing.
 *
 * Children can be server-rendered, forms with server actions included.
 */

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";

/** Any attribute a <details> takes (a class, a data- hook for tests), except
 *  its open state and submit handler, which this owns. */
type Props = Omit<ComponentPropsWithoutRef<"details">, "open" | "onSubmit">;

export function DismissableDetails({ children, ...rest }: Props) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const details = ref.current;
    if (!details) return;

    // pointerdown rather than click, so it closes the moment the press lands,
    // for a mouse and a finger alike, and before whatever was pressed reacts.
    const onPointerDown = (event: PointerEvent) => {
      if (details.open && !details.contains(event.target as Node)) details.open = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !details.open) return;
      details.open = false;
      // Back to where the menu was opened from, so keyboard focus isn't lost.
      details.querySelector("summary")?.focus();
    };

    // Choosing a link in the menu closes it. A download (the export menu)
    // stays on the same page, so the route-change rule below never fires.
    // Closed on the next tick, so the link's own navigation or download
    // goes ahead first.
    const onClick = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest?.("a[href]")) {
        setTimeout(() => {
          details.open = false;
        }, 0);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    details.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      details.removeEventListener("click", onClick);
    };
  }, []);

  // The header lives in the layout, which doesn't remount when you follow a
  // link from the menu, so without this it would still be open on the next page.
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);

  return (
    <details
      {...rest}
      ref={ref}
      // Choosing something (switching theater submits a form) closes it too.
      onSubmit={() => {
        if (ref.current) ref.current.open = false;
      }}
    >
      {children}
    </details>
  );
}
