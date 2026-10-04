import Link from "next/link";
import type { ReactNode } from "react";

/** One half of the list/grid switch on the items page. */
export function ViewTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`inline-flex min-h-10 items-center rounded px-4 font-body text-sm transition-colors ${
        active
          ? "bg-accent font-medium text-background"
          : "text-muted hover:bg-surface hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}

/**
 * One item as a picture.
 *
 * Names in a props store are approximate — "the small urn", "the good
 * candlestick" — so a wall of photographs is often the faster way to find
 * something than a column of text. Deliberately plain props rather than a
 * database row: the same tile should work for search results later.
 */
export function ItemTile({
  href,
  name,
  photoUrl,
  locationName,
  quantity,
  inUseIn,
}: {
  href: string;
  name: string;
  photoUrl?: string;
  /** Null for an item that isn't shelved anywhere yet. */
  locationName: string | null;
  quantity: number;
  /** The production it's out on, if it is. */
  inUseIn?: string;
}) {
  return (
    <li>
      <Link
        href={href}
        // Full height, so a two-line name doesn't leave the tiles beside it
        // sitting short — which reads as a broken row rather than a long name.
        className="group flex h-full flex-col overflow-hidden rounded-lg border border-rule bg-surface transition-colors hover:border-accent-soft"
      >
        <div className="relative aspect-square shrink-0 bg-background">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed URL from a private bucket
            <img src={photoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <span className="flex h-full w-full items-center justify-center px-2 text-center font-body text-xs text-muted">
              No photo
            </span>
          )}

          {quantity > 1 ? (
            <span className="absolute right-1.5 top-1.5 rounded bg-surface/90 px-1.5 py-0.5 font-body text-xs text-foreground">
              ×{quantity}
            </span>
          ) : null}

          {inUseIn ? (
            <span
              title={`In use in ${inUseIn}`}
              className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-surface/90 px-1.5 py-0.5 font-body text-xs text-foreground"
            >
              <span
                aria-hidden="true"
                className="inline-block h-[7px] w-[7px] rounded-full bg-in-use"
              />
              In use
            </span>
          ) : null}
        </div>

        <div className="p-2.5">
          <p className="line-clamp-2 font-body text-sm font-medium text-foreground group-hover:underline">
            {name}
          </p>
          <p className="mt-1 line-clamp-1 font-body text-xs text-muted">
            {locationName ?? "Unassigned"}
          </p>
        </div>
      </Link>
    </li>
  );
}
