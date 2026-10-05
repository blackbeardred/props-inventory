"use client";

import { describeSimilarity, picturesDisagree, type Ranked } from "@/lib/visual-match";
import type { Candidate, Detection } from "./actions";
import { useContextMenu } from "@/components/context-menu";
import { SwipeStrip } from "@/components/swipe-strip";
import { useSwipeLeft } from "@/lib/use-swipe";

/** A candidate with what the picture thought of it, if it was asked. */
export type RankedCandidate = Ranked<Candidate>;

/** Said after a candidate's name in the dropdown. Words rather than a
 *  percentage: a cosine similarity isn't a probability, and "87%" reads as
 *  one. Nothing for a weak score — it isn't evidence either way. */
function pictureWords(candidate: RankedCandidate): string {
  if (candidate.similarity === null) return "";
  const verdict = describeSimilarity(candidate.similarity);
  if (verdict === "strong") return " · looks just like it";
  if (verdict === "likely") return " · looks like it";
  return "";
}

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
  candidates,
  crop,
  choice,
  name,
  count,
  onChoice,
  onName,
  onCount,
  onRemove,
  onAddToInventory,
}: {
  detection: Detection;
  /** The name search's candidates merged with the picture's, best first. */
  candidates: RankedCandidate[];
  crop: string | null;
  choice: Choice;
  name: string;
  count: number;
  onChoice: (choice: Choice) => void;
  onName: (name: string) => void;
  onCount: (count: number) => void;
  onRemove: () => void;
  onAddToInventory: () => void;
}) {
  // Left, like every swipe in the app, and to do the row's "yes": add it to
  // the inventory, springing back with the name field there to correct.
  // Removing a row stays on its × and the right-click menu, where a slip of
  // the thumb can't do it (and it can be undone anyway).
  const adding = choice.kind === "new";
  const swipe = useSwipeLeft(() => {
    if (!adding) onAddToInventory();
  });

  // A right-click on a computer offers what the swipe does, and removing.
  const context = useContextMenu(name || detection.name, () => [
    adding
      ? { label: "Being added to inventory", disabled: true, onSelect: () => {} }
      : { label: "Add to inventory", detail: "As a new item, named as below", onSelect: onAddToInventory },
    { label: "Remove from this list", onSelect: onRemove },
  ]);

  const chosen =
    choice.kind === "item" ? candidates.find((candidate) => candidate.id === choice.itemId) : null;

  return (
    <li className="relative overflow-hidden rounded-lg">
      <SwipeStrip
        rounded
        armed={swipe.armed}
        label="Add to inventory"
        armedLabel="Let go to add to inventory"
        done={adding ? "Being added to inventory" : null}
      />

      {context.menu}
      <div
        {...swipe.handlers}
        onContextMenu={context.onContextMenu}
        style={swipe.style}
        className="relative flex gap-3 rounded-lg border border-rule bg-surface p-3"
      >
      {/* The crop is the whole point of the row: it's how someone tells at a
          glance whether the app is looking at the thing they think it is. With
          an item chosen, that item's own photo sits under it, so "is this
          ours?" is answered by looking, not by trusting a name. */}
      <div className="flex w-20 shrink-0 flex-col gap-2">
        <figure>
          {crop ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data: URL cut in this browser
            <img src={crop} alt="" className="h-20 w-20 rounded-md object-cover" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-rule font-body text-[10px] text-muted">
              no crop
            </div>
          )}
          {chosen ? (
            <figcaption className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-muted">
              In the photo
            </figcaption>
          ) : null}
        </figure>

        {chosen ? (
          <figure>
            {chosen.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed URL, same as every item photo
              <img
                src={chosen.photoUrl}
                alt={`Your ${chosen.name}`}
                className="h-20 w-20 rounded-md border border-rule object-cover"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-rule px-1 text-center font-body text-[10px] text-muted">
                no photo of yours
              </div>
            )}
            <figcaption className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-muted">
              Yours
            </figcaption>
          </figure>
        ) : null}
      </div>

      {/* Right padding keeps the name clear of the 44px × in the corner. */}
      <div className="min-w-0 flex-1 space-y-2 pr-8">
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
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
              {candidate.locationName ? ` · ${candidate.locationName}` : ""}
              {pictureWords(candidate)}
              {candidate.twinSet ? " · twin" : ""}
              {candidate.alreadyListed ? " · already on this list" : candidate.inUse ? " · in use" : ""}
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

        {choice.kind === "skip" && picturesDisagree(detection.name, candidates) ? (
          <p className="font-body text-xs text-warning-ink">
            The name and the picture disagree about this one, so nothing is picked. Choose it
            yourself.
          </p>
        ) : null}

        {chosen?.foundBy === "picture" ? (
          <p className="font-body text-xs text-muted">
            Found by its picture — the name didn’t match. Check it’s yours.
          </p>
        ) : null}

        {candidates.length === 0 ? (
          <p className="font-body text-xs text-muted">
            Nothing in your inventory matched “{detection.search}”.
          </p>
        ) : null}
        </div>

        {/* Removing is a button, never a swipe: the photo review's only
            swipe adds to the inventory. */}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove “${detection.name}” from this list`}
          className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-md font-body text-base leading-none text-muted transition-colors hover:bg-background hover:text-danger-ink"
        >
          ×
        </button>
      </div>
    </li>
  );
}
