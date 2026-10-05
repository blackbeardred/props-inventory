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
 * Colours are the Propolis tokens: cream behind the splash screen, ink for
 * the status bar on Android.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Props & Costume Inventory",
    short_name: "Props",
    description: "Props, costumes, where they live, and what each production has pulled.",
    id: "/",
    start_url: "/inventory",
    scope: "/",
    display: "standalone",
    background_color: "#FBF7EC",
    theme_color: "#2A2219",
    categories: ["productivity", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Inventory", url: "/inventory", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Productions", url: "/productions", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Add an item", url: "/items/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
