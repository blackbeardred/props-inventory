"use client";

/**
 * Delete item, with "Is this a duplicate?" in front of it.
 *
 * A duplicate's photos are worth keeping: they're more pictures of the same
 * thing, and give the item it duplicates a better chance of being found from
 * a photo. So when there are photos to hand over, the form asks which item
 * this one duplicates, already set to the likeliest twin (same name, or a
 * near-certain photo match; src/lib/twins.ts), and the person confirms,
 * changes or clears it. Nothing moves unless a twin is chosen.
 */

import { useState, type KeyboardEvent } from "react";
import { DeleteButton } from "@/components/delete-button";
import { SearchBar } from "@/app/(app)/search/search-bar";
import { twinReason } from "@/lib/twins";
import type { TwinChoice } from "@/lib/twin-suggestions";

type Twin = { id: string; name: string; locationName: string | null };

const OTHER = "__other";

const RADIO_ROW =
  "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-rule bg-background px-3 py-2.5 has-[:checked]:border-accent-soft has-[:checked]:bg-surface md:min-h-0";

export function DeleteItemForm({
  action,
  itemId,
  itemName,
  choice,
  locations,
}: {
  action: (formData: FormData) => void | Promise<void>;
  itemId: string;
  itemName: string;
  choice: TwinChoice;
  locations: { id: string; name: string }[];
}) {
  const [pick, setPick] = useState<string>(choice.offer ? (choice.suggestions[0]?.id ?? "") : "");
  const [other, setOther] = useState<Twin | null>(null);

  const twin: Twin | null =
    pick === OTHER ? other : (choice.suggestions.find((suggestion) => suggestion.id === pick) ?? null);
  const photos = choice.photoCount === 1 ? "its photo" : `its ${choice.photoCount} photos`;

  const confirmMessage = twin
    ? `Delete "${itemName}" as a duplicate of "${twin.name}"? ${capitalise(photos)} will go to "${twin.name}". You can restore "${itemName}" from Theatre → Recently deleted for 30 days.`
    : `Delete "${itemName}"? You can restore it from Theatre → Recently deleted for 30 days.`;

  // Enter in the search box must never submit the delete: implicit
  // submission presses the form's first button, which here is Delete, and
  // skips its confirm.
  function noImplicitSubmit(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
  }

  return (
    <form action={action} className="mt-10 border-t border-rule pt-6">
      <input type="hidden" name="itemId" value={itemId} />
      {twin ? <input type="hidden" name="twinId" value={twin.id} /> : null}

      {choice.offer ? (
        <fieldset data-twin-choice className="mb-4 max-w-xl" onKeyDown={noImplicitSubmit}>
          <legend className="font-body text-sm font-semibold text-foreground">Is this a duplicate?</legend>
          <p className="mt-1 font-body text-sm text-muted">
            If it’s a second entry for something already in the inventory, choose that item:{" "}
            {photos} will go to it, so it’s still easy to find from a photo.
          </p>

          <div className="mt-3 space-y-2">
            <label className={RADIO_ROW}>
              <input
                type="radio"
                name="twinChoice"
                value=""
                checked={pick === ""}
                onChange={() => setPick("")}
                className="mt-1 accent-[var(--accent)]"
              />
              <span className="font-body text-sm text-foreground">No, just delete it</span>
            </label>

            {choice.suggestions.map((suggestion) => (
              <label key={suggestion.id} className={RADIO_ROW}>
                <input
                  type="radio"
                  name="twinChoice"
                  value={suggestion.id}
                  checked={pick === suggestion.id}
                  onChange={() => setPick(suggestion.id)}
                  className="mt-1 accent-[var(--accent)]"
                />
                <span className="min-w-0">
                  <span className="block font-body text-sm text-foreground">
                    A duplicate of <span className="font-medium">{suggestion.name}</span>
                  </span>
                  <span className="block font-mono text-[11px] text-muted">
                    {suggestion.locationName ?? "No place"} · {twinReason(suggestion)}
                  </span>
                </span>
              </label>
            ))}

            <label className={RADIO_ROW}>
              <input
                type="radio"
                name="twinChoice"
                value={OTHER}
                checked={pick === OTHER}
                onChange={() => setPick(OTHER)}
                className="mt-1 accent-[var(--accent)]"
              />
              <span className="font-body text-sm text-foreground">
                {choice.suggestions.length ? "A duplicate of another item…" : "A duplicate of…"}
              </span>
            </label>

            {pick === OTHER ? (
              other ? (
                <div className="flex items-center gap-2 rounded-md border border-rule bg-surface px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-body text-sm text-foreground">
                    {other.name}
                    {other.locationName ? <span className="text-muted"> · {other.locationName}</span> : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOther(null)}
                    aria-label="Choose a different item"
                    className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded font-body text-sm text-muted hover:text-foreground md:min-h-0 md:min-w-0 md:px-1"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div data-twin-search>
                  <SearchBar
                    locations={locations}
                    onPick={(found) => {
                      if (found.id === itemId) return;
                      setOther({ id: found.id, name: found.name, locationName: found.locationName });
                    }}
                  />
                </div>
              )
            ) : null}
          </div>
        </fieldset>
      ) : null}

      <DeleteButton confirmMessage={confirmMessage} disabled={pick === OTHER && !other}>
        {twin ? "Delete as a duplicate" : "Delete item"}
      </DeleteButton>
      {pick === OTHER && !other ? (
        <p className="mt-2 font-body text-xs text-muted">Search for the item it duplicates first.</p>
      ) : null}
    </form>
  );
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
