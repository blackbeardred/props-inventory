"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/locations", label: "Locations" },
  { href: "/items", label: "Items" },
  { href: "/productions", label: "Productions" },
  { href: "/search", label: "Search" },
  { href: "/organization", label: "Organization" },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((link) => {
        const active =
          pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 font-body text-sm transition-colors ${
              active
                ? "bg-surface text-foreground"
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
