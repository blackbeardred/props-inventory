"use client";

import { useEffect, useRef, useState } from "react";
import { searchItemsLive, type SearchResultItem } from "@/app/(app)/search/actions";

/**
 * Picking an item by typing, for forms that used to offer a dropdown of the
 * entire inventory.
 *
 * A theatre with a hundred props has a dropdown nobody can use, and the
 * hundred is the small case. This is the same search the search page runs —
 * prefix matching across names, descriptions and the invisible tags — so
 * "wood" finds the wooden chest here as well.
 *
 * The chosen item is written to a hidden input, so the surrounding form stays
 * an ordinary server-action form.
 */
export function ItemPicker({
  name = "itemId",
  label = "Item",
  /** Item ids already on the list, marked so they aren't added twice by mistake. */
  alreadyListed = [],
}: {
  name?: string;
  label?: string;
  alreadyListed?: string[];
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [chosen, setChosen] = useState<SearchResultItem | null>(null);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);

  // Each keystroke would otherwise be a round trip; a short pause after typing
  // stops is both faster and kinder to the database.
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    window.clearTimeout(timer.current);

    if (chosen || trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    timer.current = window.setTimeout(async () => {
      const token = ++latest.current;
      const outcome = await searchItemsLive(trimmed, []);
      // A slow earlier search must not overwrite a newer one's results.
      if (token !== latest.current) return;
      setResults(outcome.items.slice(0, 8));
      setSearching(false);
      setOpen(true);
    }, 200);

    return () => window.clearTimeout(timer.current);
  }, [query, chosen]);

  function choose(item: SearchResultItem) {
    setChosen(item);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  if (chosen) {
    return (
      <div>
        <span className="block font-body text-sm font-medium text-foreground">{label}</span>
        <input type="hidden" name={name} value={chosen.id} />
        <div className="mt-1 flex items-center gap-2 rounded-md border border-rule bg-surface px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-body text-sm text-foreground">
            {chosen.name}
            {chosen.locationName ? (
              <span className="text-muted"> · {chosen.locationName}</span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={() => setChosen(null)}
            aria-label="Choose a different item"
            className="shrink-0 rounded px-1 font-body text-sm text-muted hover:text-foreground"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <label className="block font-body text-sm font-medium text-foreground">
        {label}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          // A click on a result would otherwise be lost to the blur that
          // closes the list before it lands.
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && results.length > 0) {
              event.preventDefault();
              choose(results[0]);
            }
            if (event.key === "Escape") setOpen(false);
          }}
          placeholder="Search your inventory…"
          autoComplete="off"
          className="mt-1 w-full rounded-md border border-rule bg-background px-3 py-2 font-body text-sm text-foreground"
        />
      </label>

      {open && query.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-rule bg-surface shadow-lg">
          {searching ? (
            <p className="px-3 py-2 font-body text-sm text-muted">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 font-body text-sm text-muted">
              Nothing matched “{query.trim()}”.
            </p>
          ) : (
            <ul>
              {results.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => choose(item)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-background"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-body text-sm text-foreground">
                        {item.name}
                      </span>
                      <span className="block truncate font-body text-xs text-muted">
                        {item.locationName ?? "Unassigned"}
                        {alreadyListed.includes(item.id) ? " · already on this list" : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
