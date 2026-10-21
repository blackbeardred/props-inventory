import type { MetadataRoute } from "next";

/**
 * What makes the site installable: a name, icons, and "standalone", which
 * opens it full screen from the home screen with no browser bar — the space
 * a phone in a storage room needs for the list, not for a URL.
 *
 * start_url is /inventory rather than / because the landing page is for people
 * who haven't signed up; someone opening the app from their home screen has.
 * A signed-out person is sent to log in from there as usual.
 *
 * Saved to a home screen or a computer as "Propolis". The icon is the
 * company mark ("Refined", chosen Oct 13): the honey hexagon and white
 * comedy mask, on green. Master files are in public/brand/; the app icons
 * (public/icons/, src/app/apple-icon.png, src/app/icon.svg) are drawn from
 * the same drawing.
 *
 * Colours are the Propolis tokens: cream behind the splash screen, ink for
 * the status bar on Android and the title strip on a computer.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Propolis",
    short_name: "Propolis",
    description: "Props, costumes, where they live, and what each production has pulled.",
    id: "/",
    start_url: "/inventory",
    scope: "/",
    display: "standalone",
    // On a computer, the installed app draws its own top strip (TitleStrip)
    // instead of the browser's title bar, which carried the browser's app
    // menu ("Uninstall…" among it). Browsers that don't do this fall back
    // to standalone.
    display_override: ["window-controls-overlay"],
    background_color: "#FBF7EC",
    theme_color: "#2A2219",
    categories: ["productivity", "business"],
    // Versioned file names (propolis-v2-…), not the old icon-192.png: an
    // app already installed on a computer keeps whatever it fetched at those
    // old addresses, and the service worker served them cache-first, so a
    // new drawing at the same URL never reached it. A new URL makes the
    // browser fetch the icon again on its next manifest check. Next time the
    // drawing changes, bump the version in these names (and in sw.js).
    icons: [
      { src: "/icons/propolis-v2-48.png", sizes: "48x48", type: "image/png", purpose: "any" },
      { src: "/icons/propolis-v2-96.png", sizes: "96x96", type: "image/png", purpose: "any" },
      { src: "/icons/propolis-v2-144.png", sizes: "144x144", type: "image/png", purpose: "any" },
      { src: "/icons/propolis-v2-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/propolis-v2-256.png", sizes: "256x256", type: "image/png", purpose: "any" },
      { src: "/icons/propolis-v2-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/propolis-v2-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/propolis-v2-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Inventory", url: "/inventory", icons: [{ src: "/icons/propolis-v2-96.png", sizes: "96x96" }] },
      { name: "Productions", url: "/productions", icons: [{ src: "/icons/propolis-v2-96.png", sizes: "96x96" }] },
      { name: "Add an item", url: "/items/new", icons: [{ src: "/icons/propolis-v2-96.png", sizes: "96x96" }] },
    ],
  };
}
