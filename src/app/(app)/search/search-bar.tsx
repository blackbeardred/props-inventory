"use client";

import { useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import Link from "next/link";
import {
  Badge,
  EmptyState,
  Notice,
} from "@/components/ui";
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  CONDITION_TONE,
  pluralize,
} from "@/lib/inventory";
import { searchItemsLive, type SearchResultItem } from "./actions";

type LocationOption = {
  id: string;
  name: string;
};

/**
 * A search is built out of chips that stack, each narrowing the last: "wood"
 * then "table" finds the wooden table, not everything wooden and everything
 * table-ish. Word chips match against the item's name, description and its
 * generated tags — which is how "wood" finds a guitar. Location chips filter
 * to a shelf. Both kinds sit in one row and both can be x'd out.
 */
type Chip =
  | { kind: "term"; value: string }
  | { kind: "location"; id: string; name: string };

function chipKey(chip: Chip, index: number): string {
  return chip.kind === "location" ? `loc-${chip.id}` : `term-${index}-${chip.value}`;
}

function chipLabel(chip: Chip): string {
  return chip.kind === "location" ? chip.name : chip.value;
}

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

function syncUrl(terms: string[], locationIds: string[]) {
  const text = terms.join(" ");
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


/**
 * One result, compact enough to sit in a column beside a detail pane — or
 * inside somebody else's form when the bar is being used to pick.
 */
function ResultRow({
  item,
  selected,
  onSelect,
}: {
  item: SearchResultItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li className="border-b border-rule last:border-b-0">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
          selected ? "bg-accent-soft/15" : "bg-surface hover:bg-background"
        }`}
      >
        {item.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL, see items/page.tsx
          <img src={item.photoUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
        ) : (
          <div className="h-10 w-10 shrink-0 rounded border border-dashed border-rule" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-body text-sm text-foreground">
            {item.name}
            {item.quantity > 1 ? ` ×${item.quantity}` : ""}
          </span>
          <span className="block truncate font-body text-xs text-muted">
            {item.locationName ?? "Unassigned"}
          </span>
        </span>
        {item.pulledFor ? (
          <span
            title={`Out on ${item.pulledFor.productionName}`}
            aria-hidden="true"
            className="h-[7px] w-[7px] shrink-0 rounded-full bg-in-use"
          />
        ) : null}
        <Badge tone={item.category === "costume" ? "accent" : "neutral"}>
          {CATEGORY_LABELS[item.category] ?? item.category}
        </Badge>
      </button>
    </li>
  );
}

/**
 * The result you're looking at, given the room the old table wasted: the
 * photograph first, because that's what identifies a prop, then everything
 * written down about it.
 */
function ItemDetail({ item }: { item: SearchResultItem }) {
  return (
    <div className="overflow-hidden rounded-lg border border-rule bg-surface">
      {item.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL, see items/page.tsx
        <img src={item.photoUrl} alt="" className="aspect-square w-full object-cover" />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center border-b border-rule bg-background font-body text-sm text-muted">
          No photo
        </div>
      )}

      <div className="space-y-3 p-4">
        <div>
          <h3 className="font-display text-lg">{item.name}</h3>
          <p className="mt-0.5 font-body text-sm text-muted">
            {item.locationName ?? "Unassigned"}
          </p>
        </div>

        {item.pulledFor ? (
          <p className="font-body text-sm">
            <span
              aria-hidden="true"
              className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full bg-in-use align-[1px]"
            />
            <span className="text-foreground">
              {item.quantity > 1
                ? `${item.pulledFor.quantity}/${item.quantity} pulled for `
                : "Pulled for "}
            </span>
            <Link
              href={`/productions/${item.pulledFor.productionId}`}
              className="text-accent hover:underline"
            >
              {item.pulledFor.productionName}
            </Link>
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={item.category === "costume" ? "accent" : "neutral"}>
            {CATEGORY_LABELS[item.category] ?? item.category}
          </Badge>
          {item.condition ? (
            <Badge tone={CONDITION_TONE[item.condition] ?? "muted"}>
              {CONDITION_LABELS[item.condition] ?? item.condition}
            </Badge>
          ) : null}
          {item.quantity > 1 ? (
            <span className="font-body text-xs text-muted">{item.quantity} in stock</span>
          ) : null}
        </div>

        <p className="font-body text-sm text-foreground">
          {item.description?.trim() ? (
            item.description
          ) : (
            <span className="text-muted">No description yet.</span>
          )}
        </p>

        <Link
          href={`/items/${item.id}/edit`}
          className="inline-flex items-center justify-center rounded-md border border-rule px-3 py-1.5 font-body text-sm text-foreground transition-colors hover:bg-background"
        >
          Open this item
        </Link>
      </div>
    </div>
  );
}

export function SearchBar({
  locations,
  initialText = "",
  initialChips = [],
  initialItems = [],
  initialError = null,
  onPick,
}: {
  locations: LocationOption[];
  initialText?: string;
  initialChips?: LocationOption[];
  initialItems?: SearchResultItem[];
  initialError?: string | null;
  /**
   * Given, the results become things you choose rather than pages you visit,
   * and the search stops writing itself into the address bar — it's part of a
   * form on someone else's page, not the page itself.
   */
  onPick?: (item: SearchResultItem) => void;
}) {
  // Anything already in the URL arrives as chips, so a reloaded or shared
  // search looks exactly like one you built by typing.
  const [chips, setChips] = useState<Chip[]>(() => [
    ...initialChips.map<Chip>((location) => ({
      kind: "location",
      id: location.id,
      name: location.name,
    })),
    ...initialText
      .split(/\s+/)
      .filter(Boolean)
      .map<Chip>((value) => ({ kind: "term", value })),
  ]);
  const [text, setText] = useState("");
  const [items, setItems] = useState<SearchResultItem[]>(initialItems);
  const [searchError, setSearchError] = useState<string | null>(initialError);
  const [highlighted, setHighlighted] = useState(0);
  // Which result the detail pane is showing. Ids only, so a re-search that
  // still contains it keeps it open and one that doesn't falls back.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const requestIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const chipIds = useMemo(
    () =>
      new Set(
        chips
          .filter((chip): chip is Extract<Chip, { kind: "location" }> => chip.kind === "location")
          .map((chip) => chip.id)
      ),
    [chips]
  );

  const locationSuggestions = useMemo(() => {
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

  /**
   * The word you typed always comes first, so pressing enter searches for it
   * rather than jumping to a location that happens to look similar — typing
   * "wood" shouldn't silently filter you to the Woodshed. Locations are one
   * arrow key away.
   */
  const suggestions = useMemo(() => {
    const trimmed = text.trim();
    if (!trimmed) return [];
    return [
      { kind: "term" as const, value: trimmed },
      ...locationSuggestions.map((location) => ({
        kind: "location" as const,
        location,
      })),
    ];
  }, [text, locationSuggestions]);

  function queryFor(nextChips: Chip[], nextText: string) {
    const terms = nextChips
      .filter((chip): chip is Extract<Chip, { kind: "term" }> => chip.kind === "term")
      .map((chip) => chip.value);
    const ids = nextChips
      .filter((chip): chip is Extract<Chip, { kind: "location" }> => chip.kind === "location")
      .map((chip) => chip.id);
    // Whatever is still being typed counts too, so results narrow with each
    // keystroke rather than only once a chip is committed.
    const live = nextText.trim();
    return { terms, ids, query: [...terms, live].filter(Boolean).join(" ") };
  }

  function scheduleSearch(nextText: string, nextChips: Chip[]) {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const { terms, ids, query } = queryFor(nextChips, nextText);
    if (!onPick) {
      syncUrl(nextText.trim() ? [...terms, nextText.trim()] : terms, ids);
    }

    if (!query && ids.length === 0) {
      requestIdRef.current += 1;
      setItems([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setIsSearching(true);
    debounceTimerRef.current = setTimeout(() => {
      searchItemsLive(query, ids).then((result) => {
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

  function addChip(chip: Chip) {
    setText("");
    setHighlighted(0);
    if (
      chip.kind === "location" &&
      chips.some((existing) => existing.kind === "location" && existing.id === chip.id)
    ) {
      return;
    }
    if (
      chip.kind === "term" &&
      chips.some(
        (existing) =>
          existing.kind === "term" &&
          existing.value.toLowerCase() === chip.value.toLowerCase()
      )
    ) {
      return;
    }
    const nextChips = [...chips, chip];
    setChips(nextChips);
    scheduleSearch("", nextChips);
  }

  function removeChipAt(index: number) {
    const nextChips = chips.filter((_, i) => i !== index);
    setChips(nextChips);
    scheduleSearch(text, nextChips);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      if (suggestions.length > 0) {
        event.preventDefault();
        const picked = suggestions[highlighted] ?? suggestions[0];
        addChip(
          picked.kind === "term"
            ? { kind: "term", value: picked.value }
            : {
                kind: "location",
                id: picked.location.id,
                name: picked.location.name,
              }
        );
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
      removeChipAt(chips.length - 1);
    }
  }

  const hasQuery = Boolean(text.trim()) || chips.length > 0;
  const termLabels = chips
    .filter((chip): chip is Extract<Chip, { kind: "term" }> => chip.kind === "term")
    .map((chip) => chip.value);
  const locationLabels = chips
    .filter((chip): chip is Extract<Chip, { kind: "location" }> => chip.kind === "location")
    .map((chip) => chip.name);
  const searchWords = text.trim() ? [...termLabels, text.trim()] : termLabels;
  const selected =
    items.find((item) => item.id === selectedId) ?? items[0] ?? null;

  const resultsLabel = [
    searchWords.length > 0 ? `“${searchWords.join("” + “")}”` : null,
    locationLabels.length > 0 ? `in ${locationLabels.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="mb-8">
      {/* The box you type in reads best at a comfortable line length; the
          results underneath have no business being that narrow, which is what
          left two-thirds of a desktop screen empty. */}
      <div className={onPick ? "relative" : "relative max-w-2xl"}>
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-rule bg-surface px-3 py-2 transition-colors focus-within:border-accent">
          {chips.map((chip, index) => (
            <span
              key={chipKey(chip, index)}
              className={`inline-flex items-center gap-1 rounded-full py-1 pl-2.5 pr-1.5 font-body text-xs ${
                chip.kind === "location"
                  ? "bg-accent/15 text-accent"
                  : "bg-foreground/[0.07] text-foreground"
              }`}
            >
              {chip.kind === "location" ? (
                <span className="text-accent/70">in</span>
              ) : null}
              {chipLabel(chip)}
              <button
                type="button"
                onClick={() => removeChipAt(index)}
                aria-label={`Remove ${chipLabel(chip)} filter`}
                className={`rounded-full transition-colors ${
                  chip.kind === "location"
                    ? "text-accent/70 hover:text-accent"
                    : "text-muted hover:text-foreground"
                }`}
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
                ? "Search for anything — wood, shed, shakespeare…"
                : "Add another word to narrow it…"
            }
            autoFocus
            className="min-w-[10rem] flex-1 bg-transparent font-body text-sm text-foreground outline-none placeholder:text-muted"
          />
        </div>

        {suggestions.length > 0 ? (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-rule bg-surface shadow-lg">
            {suggestions.map((suggestion, index) => (
              <button
                key={
                  suggestion.kind === "term"
                    ? `term-${suggestion.value}`
                    : `loc-${suggestion.location.id}`
                }
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  addChip(
                    suggestion.kind === "term"
                      ? { kind: "term", value: suggestion.value }
                      : {
                          kind: "location",
                          id: suggestion.location.id,
                          name: suggestion.location.name,
                        }
                  )
                }
                className={`block w-full px-3 py-2 text-left font-body text-sm transition-colors ${
                  index === highlighted
                    ? "bg-accent/10 text-accent"
                    : "text-foreground hover:bg-rule/40"
                }`}
              >
                {suggestion.kind === "term" ? (
                  <>
                    {suggestion.value}{" "}
                    <span className="text-muted">— add as a search word</span>
                  </>
                ) : (
                  <>
                    {suggestion.location.name}{" "}
                    <span className="text-muted">— location</span>
                  </>
                )}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {isSearching ? (
        <p className="mt-2 font-body text-xs text-muted">Searching…</p>
      ) : null}

      <div className={onPick ? "mt-3" : "mt-6"}>
        {!hasQuery ? (
          onPick ? (
            <p className="font-body text-sm text-muted">
              Type a word and press enter to pin it, then add another to
              narrow — “wood” then “table”. A location works too: “shed” covers
              every box in it.
            </p>
          ) : (
          <EmptyState title="Search your inventory">
            Type a word and press enter to pin it as a filter, then add
            another to narrow further — “wood” then “table” finds the wooden
            table. Items match on what they are and what they’re made of, not
            just their name, so “wood” finds a guitar too. Where something is
            kept counts as well: “shed” finds everything in the shed and every
            box inside it, and “shed” plus “shakespeare” finds the Shakespeare
            box in the shed rather than the one in the garage. Your search
            stays in the address bar, so you
            can bookmark or share it.
          </EmptyState>
          )
        ) : searchError ? (
          <Notice title="Couldn’t search items">{searchError}</Notice>
        ) : items.length === 0 && !isSearching ? (
          <EmptyState title={`No matches for ${resultsLabel}`}>
            Try a different word, check the spelling, or remove a location
            filter.
          </EmptyState>
        ) : items.length > 0 ? (
          onPick ? (
            /* Choosing, not browsing: a compact list that fits inside someone
               else's form, and rows that select rather than navigate. */
            <ul className="overflow-hidden rounded-lg border border-rule">
              {items.slice(0, 10).map((item) => (
                <ResultRow
                  key={item.id}
                  item={item}
                  selected={false}
                  onSelect={() => onPick(item)}
                />
              ))}
            </ul>
          ) : (
            <>
              <p className="mb-4 font-body text-sm text-muted">
                {pluralize(items.length, "match", "matches")} for {resultsLabel}
              </p>

              {/* The list needs a column, not a page: everything worth knowing
                  about one prop goes in the pane beside it, which is also
                  where the picture can be big enough to recognise. Below lg
                  the pane follows the list rather than sitting beside it. */}
              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <ul className="overflow-hidden rounded-lg border border-rule">
                  {items.map((item) => (
                    <ResultRow
                      key={item.id}
                      item={item}
                      selected={item.id === selected?.id}
                      onSelect={() => setSelectedId(item.id)}
                    />
                  ))}
                </ul>

                {selected ? <ItemDetail item={selected} /> : null}
              </div>
            </>
          )
        ) : null}
      </div>
    </div>
  );
}
