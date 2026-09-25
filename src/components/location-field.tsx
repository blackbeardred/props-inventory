"use client";

import { useState } from "react";
import type { LocationChoice } from "@/lib/locations";

/** The option value that reveals the "create one" fields. */
const NEW_LOCATION = "__new__";

/**
 * Picks where an item lives, or creates the place on the spot. Someone
 * standing over a newly-unpacked box shouldn't have to abandon the item
 * they're adding, go and make a location, and come back — so "Create a new
 * location…" is one of the options, and the shelf is created as part of
 * saving the item (see resolveLocationId in the item actions, which only
 * creates it once the rest of the form has passed validation).
 *
 * Choices are shown by full path — "Shed / Shakespeare box" — because two
 * boxes can legitimately share a name in different rooms.
 */
export function LocationField({
  choices,
  defaultValue,
  label = "Shelf / location",
}: {
  choices: LocationChoice[];
  defaultValue?: string;
  label?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const creating = value === NEW_LOCATION;

  return (
    <>
      <label className="block">
        <span className="mb-1.5 block font-body text-sm text-muted">{label}</span>
        <select
          name="locationId"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="w-full rounded-md border border-rule bg-surface px-3 py-2 font-body text-sm text-foreground outline-none transition-colors focus:border-accent"
        >
          <option value="">Unassigned</option>
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.path}
            </option>
          ))}
          <option value={NEW_LOCATION}>+ Create a new location…</option>
        </select>
      </label>

      {creating ? (
        // Spans the row rather than squeezing into the next grid cell.
        <div className="rounded-lg border border-rule bg-surface p-3 sm:col-span-2">
          <label className="block">
            <span className="mb-1.5 block font-body text-sm text-muted">
              New location name
            </span>
            <input
              name="newLocationName"
              type="text"
              required
              autoFocus
              placeholder="Shakespeare box"
              className="w-full rounded-md border border-rule bg-background px-3 py-2 font-body text-sm text-foreground outline-none transition-colors focus:border-accent"
            />
          </label>

          <label className="mt-3 block">
            <span className="mb-1.5 block font-body text-sm text-muted">
              Inside
            </span>
            <select
              name="newLocationParentId"
              className="w-full rounded-md border border-rule bg-background px-3 py-2 font-body text-sm text-foreground outline-none transition-colors focus:border-accent"
            >
              <option value="">Nothing — it&rsquo;s a room or top-level space</option>
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.path}
                </option>
              ))}
            </select>
          </label>

          <p className="mt-2 font-body text-xs text-muted">
            Created when you save this item. Searching for whatever it sits
            inside will find everything in it.
          </p>
        </div>
      ) : null}
    </>
  );
}
