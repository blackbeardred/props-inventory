"use client";

/**
 * The item page's Twins section: props the theatre owns more than one of,
 * that look exactly alike (migration 009, src/lib/twins.ts).
 *
 * Linking is always a person's call. Likely twins are suggested (the same
 * name, or a photo that's a near-certain match) and any other item can be
 * found with the search, but nothing is linked until someone presses the
 * button.
 */

import Link from "next/link";
import { useState } from "react";
import { SearchBar } from "@/app/(app)/search/search-bar";
import { SubmitButton } from "@/components/submit-button";
import { twinReason, type TwinSuggestion } from "@/lib/twins";
import type { TwinItem } from "@/lib/twins-data";

type Action = (formData: FormData) => void | Promise<void>;

export function TwinsPanel({
  itemId,
  itemName,
  twins,
  suggestions,
  locations,
  addAction,
  removeAction,
}: {
  itemId: string;
  itemName: string;
  twins: TwinItem[];
  suggestions: TwinSuggestion[];
  locations: { id: string; name: string }[];
  addAction: Action;
  removeAction: Action;
}) {
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<TwinItem | null>(null);
  const twinIds = new Set(twins.map((twin) => twin.id));

  return (
    <section id="twins" data-twins className="scroll-mt-24 rounded-lg border border-rule bg-background px-4 py-3">
      <h2 className="font-display text-lg text-foreground">Twins</h2>
      <p className="mt-1 font-body text-sm text-muted">
        Own more than one of this, all looking the same? Link them as twins: a photo of one
        finds them all, and a prop-table photo marks whichever isn’t in use.
      </p>

      {twins.length ? (
        <div className="mt-4">
          <ul className="space-y-2">
            {twins.map((twin) => (
              <li
                key={twin.id}
                data-twin
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-rule bg-surface px-3 py-2"
              >
                <span aria-hidden="true" className="hex w-3 bg-honey" />
                <Link
                  href={`/items/${twin.id}/edit`}
                  className="inline-flex min-h-11 items-center font-body text-sm font-medium text-accent-ink hover:underline md:min-h-0"
                >
                  {twin.name}
                </Link>
                <span className="font-mono text-[11px] text-muted">{twin.locationName ?? "No place"}</span>
              </li>
            ))}
          </ul>
          <form action={removeAction} className="mt-3">
            <input type="hidden" name="itemId" value={itemId} />
            <SubmitButton variant="ghost" pendingText="Unlinking…">
              {`${itemName} isn’t a twin after all`}
            </SubmitButton>
          </form>
        </div>
      ) : null}

      <div className="mt-5">
        <p className="font-body text-sm font-semibold text-foreground">
          {twins.length ? "Add another twin" : "Link a twin"}
        </p>

        {suggestions.length ? (
          <ul className="mt-2 space-y-2">
            {suggestions
              .filter((suggestion) => !twinIds.has(suggestion.id))
              .map((suggestion) => (
                <li
                  key={suggestion.id}
                  data-twin-suggestion
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rule bg-background px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block font-body text-sm text-foreground">{suggestion.name}</span>
                    <span className="block font-mono text-[11px] text-muted">
                      {suggestion.locationName ?? "No place"} · {twinReason(suggestion)}
                    </span>
                  </span>
                  <form action={addAction}>
                    <input type="hidden" name="itemId" value={itemId} />
                    <input type="hidden" name="twinId" value={suggestion.id} />
                    <SubmitButton variant="ghost" pendingText="Linking…">
                      Link as twin
                    </SubmitButton>
                  </form>
                </li>
              ))}
          </ul>
        ) : null}

        {picked ? (
          <form action={addAction} className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-rule bg-surface px-3 py-2">
            <input type="hidden" name="itemId" value={itemId} />
            <input type="hidden" name="twinId" value={picked.id} />
            <span className="min-w-0 flex-1 font-body text-sm text-foreground">
              {picked.name}
              {picked.locationName ? <span className="text-muted"> · {picked.locationName}</span> : null}
            </span>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="inline-flex min-h-11 items-center px-2 font-body text-sm text-muted hover:text-foreground md:min-h-0"
            >
              Choose another
            </button>
            <SubmitButton pendingText="Linking…">Link as twin</SubmitButton>
          </form>
        ) : searching ? (
          <div data-twin-search className="mt-2">
            <SearchBar
              locations={locations}
              onPick={(found) => {
                if (found.id === itemId) return;
                setPicked({ id: found.id, name: found.name, locationName: found.locationName });
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSearching(true)}
            className="mt-2 inline-flex min-h-11 items-center font-body text-sm text-accent-ink hover:underline md:min-h-0"
          >
            {suggestions.length ? "Find a different item…" : "Find the item it’s a twin of…"}
          </button>
        )}
      </div>
    </section>
  );
}
