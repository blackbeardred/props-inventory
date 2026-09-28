"use client";

import type { Detection } from "./actions";

/**
 * What the reviewer decided about one thing in the photo. "skip" is the
 * default for anything without an obvious match, because the cost of marking
 * the wrong item is a prop nobody can find three weeks later.
 */
export type Choice =
  | { kind: "skip" }
  | { kind: "item"; itemId: string }
  | { kind: "new" };

export function DetectionRow({
  detection,
  crop,
  choice,
  name,
  count,
  onChoice,
  onName,
  onCount,
}: {
  detection: Detection;
  crop: string | null;
  choice: Choice;
  name: string;
  count: number;
  onChoice: (choice: Choice) => void;
  onName: (name: string) => void;
  onCount: (count: number) => void;
}) {
  return (
    <li className="flex gap-3 rounded-lg border border-rule bg-surface p-3">
      {crop ? (
        // The crop is the whole point of the row: it's how someone tells at a
        // glance whether the app is looking at the thing they think it is.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={crop} alt="" className="h-20 w-20 shrink-0 rounded-md object-cover" />
      ) : (
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border border-dashed border-rule font-body text-[10px] text-muted">
          no crop
        </div>
      )}

      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="font-body text-sm font-medium text-foreground">
            {detection.name}
            {detection.quantity > 1 ? ` ×${detection.quantity}` : ""}
          </p>
          {detection.note ? (
            <p className="font-body text-xs text-muted">{detection.note}</p>
          ) : null}
        </div>

        <select
          value={choice.kind === "item" ? choice.itemId : choice.kind === "new" ? "__new" : ""}
          onChange={(event) => {
            const value = event.target.value;
            onChoice(
              value === ""
                ? { kind: "skip" }
                : value === "__new"
                  ? { kind: "new" }
                  : { kind: "item", itemId: value }
            );
          }}
          aria-label={`Which item is “${detection.name}”`}
          className="w-full rounded-md border border-rule bg-background px-3 py-2 font-body text-sm text-foreground"
        >
          <option value="">Skip — don’t mark anything</option>
          {detection.candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
              {candidate.locationName ? ` · ${candidate.locationName}` : ""}
              {candidate.alreadyListed ? " · already on this list" : ""}
            </option>
          ))}
          <option value="__new">Not in the inventory — add it</option>
        </select>

        {choice.kind === "new" ? (
          <input
            value={name}
            onChange={(event) => onName(event.target.value)}
            aria-label="Name for the new item"
            className="w-full rounded-md border border-rule bg-background px-3 py-2 font-body text-sm text-foreground"
          />
        ) : null}

        {choice.kind !== "skip" ? (
          <label className="flex items-center gap-2 font-body text-xs text-muted">
            How many
            <input
              type="number"
              min={1}
              value={count}
              onChange={(event) => onCount(Math.max(1, Number(event.target.value) || 1))}
              className="w-20 rounded-md border border-rule bg-background px-2 py-1 font-body text-sm text-foreground"
            />
          </label>
        ) : null}

        {detection.candidates.length === 0 ? (
          <p className="font-body text-xs text-muted">
            Nothing in your inventory matched “{detection.search}”.
          </p>
        ) : null}
      </div>
    </li>
  );
}
