"use client";

import { useEffect } from "react";
import { ITEMS_VIEW_COOKIE } from "@/lib/items-view";

/**
 * Remembers List or Grid for the next time the items page is opened without
 * one in the address bar. A year, scoped to the site, and nothing but the
 * word "list" or "grid" — it's a preference, not a session.
 */
export function RememberView({ view }: { view: "list" | "grid" }) {
  useEffect(() => {
    try {
      document.cookie = `${ITEMS_VIEW_COOKIE}=${view}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    } catch {
      // Cookies blocked: the page still works, it just forgets.
    }
  }, [view]);

  return null;
}
