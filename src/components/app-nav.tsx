"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Three places, not five. Items, Locations and Search were three ways into
 * the same list, and Account and Organization both held the invite code and
 * the theatre switcher; they're one Inventory and one Theatre page now. Each
 * tab also lights up for the pages that live under it — adding an item is
 * still "in" Inventory.
 */
const LINKS = [
  { href: "/inventory", label: "Inventory", also: ["/items", "/locations", "/search"] },
  { href: "/productions", label: "Productions", also: [] },
  { href: "/theatre", label: "Theatre", also: ["/account", "/organization"] },
] as const;

function isActive(pathname: string, link: (typeof LINKS)[number]): boolean {
  return [link.href, ...link.also].some(
    (href) => pathname === href || pathname.startsWith(`${href}/`)
  );
}

/**
 * The nav in the header, from tablet width up. Below that it is the tab bar
 * at the bottom of the screen instead.
 *
 * It used to be one row that wrapped. On every phone — 430 wide included —
 * the second line spilled out of a fixed-height header and the page painted
 * over it, so Search, Organization and the account link looked present and
 * could not be tapped. A bar at the bottom can't wrap, and it is where a thumb
 * already is.
 */
export function AppNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="hidden flex-wrap items-center gap-1 md:flex">
      {LINKS.map((link) => {
        const active = isActive(pathname, link);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 font-body text-sm transition-colors ${
              active
                // --accent-ink, not --accent: on its own 15% tint the plain
                // accent falls to 4.02:1. Same fix as the accent badge.
                ? "bg-accent-soft/15 font-medium text-accent-ink"
                : "text-muted hover:text-foreground"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The phone nav: three tabs along the bottom edge.
 *
 * Each tab carries the hexagon, meaning what it means everywhere else in the
 * app — honey when shut, ink when open — so the page you're on is the one
 * cell that's open, turned the same 90° an opened cell turns. Every tab is
 * the full height of the bar (56px) and a third of its width.
 *
 * Padded by the safe-area inset so it clears the iPhone home indicator; that
 * only reports a value because the root layout sets `viewport-fit=cover`.
 */
export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      data-print-hide
      className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-3">
        {LINKS.map((link) => {
          const active = isActive(pathname, link);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 px-0.5 font-body text-xs leading-none transition-colors ${
                  active ? "font-medium text-accent-ink" : "text-muted"
                }`}
              >
                <span
                  aria-hidden="true"
                  data-hex-toggle
                  className={`hex w-3.5 transition-[background-color,rotate] duration-200 ${
                    active ? "rotate-90 bg-foreground" : "bg-honey"
                  }`}
                />
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
