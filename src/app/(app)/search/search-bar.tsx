"use client";

import { useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import Link from "next/link";
import {
  Badge,
  DataTable,
  EmptyState,
  Notice,
} from "@/components/ui";
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  pluralize,
} from "@/lib/inventory";
import { searchItemsLive, type SearchResultItem } from "./actions";

type LocationOption = {
  id: string;
  name: string;
};

const DEBOUNCE_MS = 200;

/**
 * Case-insensitive fuzzy subsequence match: every character of `needle`
 * must appear in `target`, in order, but not necessarily contiguously —
 * e.g. "tsbn" matches "Test Bin". Used so a typo or a couple of skipped
 * letters while typing a location name still surfaces it as a suggestion.
 */
function fuzzyMatches(target: string, needle: string): boolean {
  let cursor = 0;
  for (const char of needle) {
    const found = target.indexOf(char, cursor);
    if (found === -1) return false;
    cursor = found + 1;
  }
  return true;
}

/** Lower is better: exact prefix, then substring, then loose fuzzy match. */
function matchScore(name: string, needle: string): number | null {
  if (name.startsWith(needle)) return 0;
  if (name.includes(needle)) return 1;
  if (fuzzyMatches(name, needle)) return 2;
  return null;
}

function syncUrl(text: string, locationIds: string[]) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  if (text) params.set("q", text);
  if (locationIds.length > 0) params.set("locations", locationIds.join(","));
  const query = params.toString();
  // Plain history API, not next/navigation's router — this only reflects
  // the current search in the address bar (so it can be copied, bookmarked,
  // or reloaded) without asking Next.js to re-render the page from the
  // server on every keystroke.
  const url = query
    ? `${window.location.pathname}?${query}`
    : window.location.pathname;
  window.history.replaceState(null, "", url);
}

export function SearchBar({
  locations,
  initialText,
  initialChips,
  initialItems,
  initialError,
}: {
  locations: LocationOption[];
  initialText: string;
  initialChips: LocationOption[];
  initialItems: SearchResultItem[];
  initialError: string | null;
}) {
  const [chips, setChips] = useState<LocationOption[]>(initialChips);
  const [text, setText] = useState(initialText);
  const [items, setItems] = useState<SearchResultItem[]>(initialItems);
  const [searchError, setSearchError] = useState<string | null>(initialError);
  const [highlighted, setHighlighted] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const requestIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const chipIds = useMemo(() => new Set(chips.map((chip) => chip.id)), [chips]);

  const suggestions = useMemo(() => {
    const needle = text.trim().toLowerCase();
    if (!needle) return [];
    return locations
      .filter((location) => !chipIds.has(location.id))
      .map((location) => ({
        location,
        score: matchScore(location.name.toLowerCase(), needle),
      }))
      .filter(
        (entry): entry is { location: LocationOption; score: number } =>
          entry.score !== null
      )
      .sort(
        (a, b) => a.score - b.score || a.location.name.localeCompare(b.location.name)
      )
      .slice(0, 5)
      .map((entry) => entry.location);
  }, [text, chipIds, locations]);

  function scheduleSearch(nextText: string, nextChips: LocationOption[]) {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const trimmed = nextText.trim();
    const ids = nextChips.map((chip) => chip.id);
    syncUrl(trimmed, ids);

    if (!trimmed && ids.length === 0) {
      requestIdRef.current += 1;
      setItems([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setIsSearching(true);
    debounceTimerRef.current = setTimeout(() => {
      searchItemsLive(trimmed, ids).then((result) => {
        if (requestIdRef.current !== requestId) return;
        setItems(result.items);
        setSearchError(result.error);
        setIsSearching(false);
      });
    }, DEBOUNCE_MS);
  }

  function handleTextChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setText(value);
    setHighlighted(0);
    scheduleSearch(value, chips);
  }

  function addChip(location: LocationOption) {
    setText("");
    setHighlighted(0);
    if (chips.some((chip) => chip.id === location.id)) {
      return;
    }
    const nextChips = [...chips, location];
    setChips(nextChips);
    scheduleSearch("", nextChips);
  }

  function removeChip(id: string) {
    const nextChips = chips.filter((chip) => chip.id !== id);
    setChips(nextChips);
    scheduleSearch(text, nextChips);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      if (suggestions.length > 0) {
        event.preventDefault();
        addChip(suggestions[highlighted] ?? suggestions[0]);
      }
      return;
    }
    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      setHighlighted((current) => (current + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      setHighlighted(
        (current) => (current - 1 + suggestions.length) % suggestions.length
      );
      return;
    }
    if (event.key === "Backspace" && text === "" && chips.length > 0) {
      const nextChips = chips.slice(0, -1);
      setChips(nextChips);
      scheduleSearch(text, nextChips);
    }
  }

  const hasQuery = Boolean(text.trim()) || chips.length > 0;
  const resultsLabel = [
    text.trim() ? `“${text.trim()}”` : null,
    chips.length > 0 ? `in ${chips.map((chip) => chip.name).join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="mb-8 max-w-2xl">
      <div className="relative">
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-rule bg-surface px-3 py-2 transition-colors focus-within:border-accent">
          {chips.map((chip) => (
            <span
              key={chip.id}
              className="inline-flex items-center gap-1 rounded-full bg-accent/15 py-1 pl-2.5 pr-1.5 font-body text-xs text-accent"
            >
              {chip.name}
              <button
                type="button"
                onClick={() => removeChip(chip.id)}
                aria-label={`Remove ${chip.name} filter`}
                className="rounded-full text-accent/70 transition-colors hover:text-accent"
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder={
              chips.length === 0
                ? "Search by name, description, or a location…"
                : "Add more…"
            }
            autoFocus
            className="min-w-[10rem] flex-1 bg-transparent font-body text-sm text-foreground outline-none placeholder:text-muted"
          />
        </div>

        {suggestions.length > 0 ? (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-rule bg-surface shadow-lg">
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addChip(suggestion)}
                className={`block w-full px-3 py-2 text-left font-body text-sm transition-colors ${
                  index === highlighted
                    ? "bg-accent/10 text-accent"
                    : "text-foreground hover:bg-rule/40"
                }`}
              >
                {suggestion.name}{" "}
                <span className="text-muted">— location</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {isSearching ? (
        <p className="mt-2 font-body text-xs text-muted">Searching…</p>
      ) : null}

      <div className="mt-6">
        {!hasQuery ? (
          <EmptyState title="Search your inventory">
            Start typing a name or description — matches narrow as you keep
            typing. Type a location name and pick it from the list to filter
            to that location. Your search stays in the address bar, so you
            can bookmark or share it.
          </EmptyState>
        ) : searchError ? (
          <Notice title="Couldn’t search items">{searchError}</Notice>
        ) : items.length === 0 && !isSearching ? (
          <EmptyState title={`No matches for ${resultsLabel}`}>
            Try a different word, check the spelling, or remove a location
            filter.
          </EmptyState>
        ) : items.length > 0 ? (
          <>
            <p className="mb-4 font-body text-sm text-muted">
              {pluralize(items.length, "match", "matches")} for {resultsLabel}
            </p>
            <DataTable
              columns={[
                "Photo",
                "Item",
                "Category",
                "Qty",
                "Condition",
                "Location",
                "",
              ]}
            >
              {items.map((item) => (
                <tr key={item.id} className="border-b border-rule align-top">
                  <td className="px-3 py-3">
                    {item.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived and per-request; see items/page.tsx.
                      <img
                        src={item.photoUrl}
                        alt=""
                        className="h-10 w-10 rounded object-cover"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded border border-dashed border-rule" />
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-body text-sm text-foreground">
                      {item.name}
                    </span>
                    {item.description ? (
                      <p className="mt-0.5 line-clamp-1 font-body text-xs text-muted">
                        {item.description}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={item.category === "costume" ? "accent" : "neutral"}>
                      {CATEGORY_LABELS[item.category] ?? item.category}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 font-body text-sm text-muted">
                    {item.quantity}
                  </td>
                  <td className="px-3 py-3">
                    {item.condition ? (
                      <Badge
                        tone={item.condition === "needs_repair" ? "accent" : "muted"}
                      >
                        {CONDITION_LABELS[item.condition] ?? item.condition}
                      </Badge>
                    ) : (
                      <span className="font-body text-sm text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 font-body text-sm">
                    {item.location_id ? (
                      <Link
                        href={`/items?location=${item.location_id}`}
                        className="text-muted underline-offset-2 hover:text-foreground hover:underline"
                      >
                        {item.locationName ?? "Unknown location"}
                      </Link>
                    ) : (
                      <span className="text-muted">Unassigned</span>
                    )}
                  </td>
                  <td className="px-3 py-3 font-body text-sm text-right">
                    <Link
                      href={`/items/${item.id}/edit`}
                      className="text-muted underline-offset-2 hover:text-foreground hover:underline"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </DataTable>
          </>
        ) : null}
      </div>
    </div>
  );
}
