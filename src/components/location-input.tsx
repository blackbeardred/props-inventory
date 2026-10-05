"use client";

import { useState } from "react";
import { LocationPicker } from "@/components/location-picker";
import type { LocationNode } from "@/lib/locations";

/**
 * The walk-in picker as a plain form field: a hidden input carries the chosen
 * id, so the page stays an ordinary <form action={…}> and the server action
 * is untouched. For choosing where a new location goes — the item form has
 * its own LocationField, which can also create one on the spot.
 */
export function LocationInput({
  name,
  nodes,
  defaultValue = "",
  label,
  noneLabel,
}: {
  name: string;
  nodes: LocationNode[];
  defaultValue?: string;
  label: string;
  noneLabel: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div>
      <input type="hidden" name={name} value={value} />
      <LocationPicker
        nodes={nodes}
        value={value}
        onChange={setValue}
        label={label}
        noneLabel={noneLabel}
        selfLabel={(placeName) => (
          <>
            Inside <span className="font-medium">{placeName}</span> itself
          </>
        )}
      />
    </div>
  );
}
