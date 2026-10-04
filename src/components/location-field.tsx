"use client";

import { useState } from "react";
import { LocationPicker } from "@/components/location-picker";
import type { LocationNode } from "@/lib/locations";

/** The value that reveals the "create one" fields. */
const NEW_LOCATION = "__new__";

/**
 * Picks where an item lives, or creates the place on the spot. Someone
 * standing over a newly-unpacked box shouldn't have to abandon the item
 * they're adding, go and make a location, and come back — so "Create a new
 * location…" is one of the choices, and the shelf is created as part of
 * saving the item (see resolveLocationId in the item actions, which only
 * creates it once the rest of the form has passed validation).
 *
 * Both the place this item goes and the place a new location goes use the
 * same walk-in picker. They are the same question, and answering one of them
 * in a tree and the other in a flat list of pasted-together paths is how a
 * form starts to feel like two forms.
 */
export function LocationField({
  nodes,
  defaultValue,
  label = "Shelf / location",
}: {
  nodes: LocationNode[];
  defaultValue?: string;
  label?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [newParentId, setNewParentId] = useState("");
  const creating = value === NEW_LOCATION;

  return (
    <>
      {/* The form still posts a plain string, so the server action is
          unchanged and this stays an ordinary <form action={…}>. */}
      <input type="hidden" name="locationId" value={value} />

      <div>
        <LocationPicker
          nodes={nodes}
          value={creating ? "" : value}
          onChange={setValue}
          label={label}
          noneLabel="Unassigned"
        />
        <button
          type="button"
          onClick={() => setValue(creating ? "" : NEW_LOCATION)}
          className="mt-0.5 inline-flex min-h-11 items-center font-body text-xs text-accent underline-offset-2 hover:underline"
        >
          {creating ? "Pick an existing location instead" : "+ Create a new location…"}
        </button>
      </div>

      {creating ? (
        // Spans the row rather than squeezing into the next grid cell.
        <div className="rounded-lg border border-rule bg-surface p-3 sm:col-span-2">
          <input type="hidden" name="newLocationParentId" value={newParentId} />

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

          <div className="mt-3">
            <LocationPicker
              nodes={nodes}
              value={newParentId}
              onChange={setNewParentId}
              label="Inside"
              noneLabel="Nothing — it’s a room or top-level space"
              placeholder="Type to find what it goes inside"
            />
          </div>

          <p className="mt-2 font-body text-xs text-muted">
            Created when you save this item. Searching for whatever it sits
            inside will find everything in it.
          </p>
        </div>
      ) : null}
    </>
  );
}
