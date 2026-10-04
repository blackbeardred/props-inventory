/*
 * The service worker: what lets the installed app open with no signal.
 *
 * Hand-written rather than generated, on purpose. Next has no built-in one,
 * the usual plugins lag behind Next releases, and a missing dependency has
 * broken a Vercel build on this project before. This is small enough to read
 * in one go, and every rule in it is one a person can check.
 *
 * Three kinds of request, three rules:
 *
 *  1. Build assets (/_next/static/…): cache first. Their file names change
 *     with every build, so a cached copy can never be stale — and without
 *     them a cached page is HTML with no JavaScript, so nothing can be ticked.
 *
 *  2. Page loads: network first. When the network answers, a copy is kept;
 *     when it doesn't, the last copy is shown, and failing that a small
 *     offline page. So a checklist opened in the office still opens in the
 *     basement. Only plain successful pages are kept — never a redirect,
 *     never an error — and never the sign-in pages, which have nothing
 *     useful to show offline.
 *
 *  3. Everything else — Supabase, server actions, the page data Next fetches
 *     when you tap a link — goes straight to the network, untouched. When
 *     that fails offline, Next falls back to a full page load, which rule 2
 *     then answers.
 *
 * Kept pages are the signed-in person's own, so the sign-in page clears them
 * (see clearOfflinePages in the app). That covers logging out and a session
 * running out alike.
 *
 * Bump VERSION when this file's rules change; old caches are dropped on the
 * next visit. It never touches caches it didn't make — the recognition
 * model lives in "transformers-cache" and must survive.
 */

const VERSION = "v1";
const STATIC_CACHE = `props-static-${VERSION}`;
const PAGES_CACHE = `props-pages-${VERSION}`;
const OFFLINE_URL = "/offline.html";

/** Enough for a few productions' worth of checklists, lists and items. */
const MAX_PAGES = 40;

/** Build files pile up across deploys; past this the oldest go. A deploy's
 *  worth is around a hundred. */
const MAX_STATIC = 400;

const PRECACHE = [
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

/** Pages with nothing worth showing offline, and that mustn't be kept. */
const NEVER_KEEP = ["/login", "/signup", "/auth", "/forgot-password", "/reset-password", "/onboarding"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            // Only ours, and only old ones.
            .filter((key) => key.startsWith("props-") && key !== STATIC_CACHE && key !== PAGES_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "clear-pages") {
    event.waitUntil(caches.delete(PAGES_CACHE));
  }
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

function neverKeep(url) {
  return NEVER_KEEP.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`));
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
    trim(cache, MAX_STATIC, PRECACHE);
  }
  return response;
}

/** Drops the oldest entries once there are more than `max`, sparing `keep`. */
async function trim(cache, max, keep = []) {
  const keys = (await cache.keys()).filter(
    (request) => !keep.includes(new URL(request.url).pathname)
  );
  const excess = keys.length - max;
  for (let i = 0; i < excess; i += 1) await cache.delete(keys[i]);
}

async function networkFirstPage(request, url) {
  try {
    const response = await fetch(request);
    const html = (response.headers.get("content-type") || "").includes("text/html");
    if (response.ok && response.type === "basic" && !response.redirected && html && !neverKeep(url)) {
      const cache = await caches.open(PAGES_CACHE);
      // Deleted first so a revisited page moves to the newest end, and the
      // trim drops the pages nobody has opened for longest.
      await cache.delete(request);
      await cache.put(request, response.clone());
      trim(cache, MAX_PAGES);
    }
    return response;
  } catch (error) {
    if (!neverKeep(url)) {
      const kept = await caches.match(request, { cacheName: PAGES_CACHE });
      if (kept) return kept;
    }
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Next's own page-data requests when following a link. Left to the network
  // so a failure makes Next fall back to a full page load, answered below.
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request, url));
  }
});
