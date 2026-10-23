"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useContextMenu, type MenuItem } from "@/components/context-menu";

export type PlaceInside = { id: string; name: string; href: string; itemCount: number; placeCount: number };

/**
 * A place you walk into, on the Inventory page. A click goes in; a
 * right-click shows what's inside it — Props Room A's shelves, Costume
 * Storage's racks — so you can go straight to one, or add another.
 */
export function PlaceTile({
  name,
  href,
  itemCount,
  placeCount,
  inside,
  addHref,
}: {
  name: string;
  href: string;
  itemCount: number;
  placeCount: number;
  inside: PlaceInside[];
  addHref: string;
}) {
  const router = useRouter();
  const context = useContextMenu(
    name,
    (): MenuItem[] => [
      ...(inside.length
        ? inside.map((child) => ({
            label: child.name,
            detail: `${child.itemCount} item${child.itemCount === 1 ? "" : "s"}${child.placeCount ? ` · ${child.placeCount} inside` : ""}`,
            onSelect: () => router.push(child.href),
          }))
        : [{ label: "Nothing inside yet", disabled: true, onSelect: () => {} }]),
      { label: "Add a shelf or box…", onSelect: () => router.push(addHref) },
    ],
    { onALink: true }
  );

  return (
    <>
      {context.menu}
      <Link
        href={href}
        data-place-tile
        data-place-name={name}
        onContextMenu={context.onContextMenu}
        className="group flex min-h-16 items-start gap-2.5 rounded-lg border border-rule bg-surface px-3 py-2.5 transition-colors hover:border-accent-soft"
      >
        <span
          aria-hidden="true"
          data-hex-toggle
          className="hex mt-1 w-4 shrink-0 bg-honey transition-[rotate] duration-200 group-hover:rotate-90"
        />
        <span className="min-w-0">
          <span className="block truncate font-body text-sm font-medium text-foreground">{name}</span>
          <span className="block font-mono text-[11px] text-muted">
            {itemCount} item{itemCount === 1 ? "" : "s"}
            {placeCount > 0 ? ` · ${placeCount} inside` : ""}
          </span>
        </span>
      </Link>
    </>
  );
}
