"use client";

import { useEffect, useState } from "react";

/**
 * Registers the service worker (public/sw.js), in production only.
 *
 * Not in development: a worker that keeps copies of pages makes `next dev`
 * serve yesterday's page after an edit, which is exactly the confusion it
 * would cause. Registered after the page has loaded so it never competes
 * with what the person came for.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // No worker means no offline copies. Everything online still works,
        // so there's nothing to tell anyone.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}

/**
 * Forgets every page kept for offline use. Called from the sign-in page, which
 * is where both logging out and an expired session land — the kept pages are
 * the last person's inventory, and the next person on a shared phone shouldn't
 * be able to open them with the wifi off.
 */
export function ClearOfflinePages() {
  useEffect(() => {
    if (typeof caches === "undefined") return;
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith("props-pages-")).map((key) => caches.delete(key))
        )
      )
      .catch(() => {});
  }, []);

  return null;
}

/**
 * A line across the top when there's no connection, so a page opened from
 * the offline copy doesn't pass itself off as live.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <p
      role="status"
      data-print-hide
      className="border-b border-rule bg-warning/25 px-6 py-2 text-center font-body text-sm text-warning-ink"
    >
      No connection. This is the copy this device saw last; checklist ticks are kept and sent
      when you’re back online.
    </p>
  );
}
