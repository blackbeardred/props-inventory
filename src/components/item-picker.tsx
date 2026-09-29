"use client";

import { useState } from "react";
import { SearchBar } from "@/app/(app)/search/search-bar";
import type { SearchResultItem } from "@/app/(app)/search/actions";

/**
 * Picking an item by searching for it, for forms that used to offer a
 * dropdown of the entire inventory.
 *
 * This is the search page's own search bar, not a lesser version of it:
 * stacking chips that narrow each other, location chips that cover every box
 * inside a room, and matching on what a thing is and what it's made of rather
 * than only its name. Anywhere you can search the inventory, you should be
 * able to search it the same way — and one implementation means the pull list
 * can't quietly fall behind the search page.
 *
 * The chosen item is written to a hidden input, so the surrounding form stays
 * an ordinary server-action form.
 */
export function ItemPicker({
  name = "itemId",
  label = "Item",
  locations,
  /** Item ids already on the list, so the same prop isn't added twice. */
  alreadyListed = [],
}: {
  name?: string;
  label?: string;
  locations: { id: string; name: string }[];
  alreadyListed?: string[];
}) {
  const [chosen, setChosen] = useState<SearchResultItem | null>(null);

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
            {alreadyListed.includes(chosen.id) ? (
              <span className="text-warning-ink"> · already on this list</span>
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
    <div>
      <span className="block font-body text-sm font-medium text-foreground">{label}</span>
      <div className="mt-1">
        <SearchBar locations={locations} onPick={setChosen} />
      </div>
    </div>
  );
}
