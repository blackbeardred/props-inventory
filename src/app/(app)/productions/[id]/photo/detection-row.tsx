"use client";

import { useRef, useState } from "react";
import { describeSimilarity, picturesDisagree, type Ranked } from "@/lib/visual-match";
import type { Candidate, Detection } from "./actions";

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

/** How far a row has to travel before letting go acts on it. */
const SWIPE_THRESHOLD = 110;

/** Movement below this is a tap or the start of a scroll, not a swipe. */
const SWIPE_SLOP = 12;

/** Dragging a row that starts on a control would fight the control. */
function startedOnAControl(target: EventTarget | null): boolean {
  return Boolean(
    target instanceof Element && target.closest("select, input, button, textarea, a")
  );
}

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
  const [offset, setOffset] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const gesture = useRef<{ x: number; y: number; swiping: boolean } | null>(null);
  // How far the row has travelled, kept outside React as well as in state.
  // A flick can deliver its last move and its release in the same tick, and
  // the released handler would then still be reading an offset of zero.
  const travelled = useRef(0);

  function onTouchStart(event: React.TouchEvent) {
    if (startedOnAControl(event.target)) return;
    const touch = event.touches[0];
    gesture.current = { x: touch.clientX, y: touch.clientY, swiping: false };
  }

  function onTouchMove(event: React.TouchEvent) {
    const start = gesture.current;
    if (!start) return;

    const touch = event.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    // Until it's clear which way this is going, do nothing — deciding early
    // would either swallow scrolls or make the list feel sticky.
    if (!start.swiping) {
      if (Math.abs(dy) > SWIPE_SLOP && Math.abs(dy) > Math.abs(dx)) {
        gesture.current = null;
        return;
      }
      if (Math.abs(dx) < SWIPE_SLOP || Math.abs(dx) <= Math.abs(dy)) return;
      start.swiping = true;
    }

    // Both ways, with the last stretch resisting, so it's clear you've gone
    // far enough rather than the row sliding off unannounced.
    const past = Math.abs(dx) - SWIPE_THRESHOLD;
    const distance =
      past > 0 ? SWIPE_THRESHOLD + past * 0.35 : Math.abs(dx);
    travelled.current = Math.sign(dx) * distance;
    setOffset(travelled.current);
  }

  function onTouchEnd() {
    const start = gesture.current;
    gesture.current = null;
    if (!start?.swiping) return;

    // Away to the left and it's gone; to the right it springs back with the
    // row now set to be added, so the name field is there to correct.
    if (travelled.current <= -SWIPE_THRESHOLD) {
      setLeaving(true);
      setOffset(-400);
      window.setTimeout(onRemove, 160);
      return;
    }

    if (travelled.current >= SWIPE_THRESHOLD) {
      onAddToInventory();
    }

    travelled.current = 0;
    setOffset(0);
  }

  const dragging = gesture.current?.swiping === true;

  const chosen =
    choice.kind === "item" ? candidates.find((candidate) => candidate.id === choice.itemId) : null;

  return (
    <li className="relative overflow-hidden rounded-lg">
      {/* Revealed as the row slides. Both sit underneath rather than in the
          flow, so nothing reflows while a finger is down, and only the one
          being uncovered is legible. */}
      <div
        aria-hidden="true"
        className={`absolute inset-0 flex items-center justify-between rounded-lg px-4 ${
          offset < 0 ? "bg-danger/15" : offset > 0 ? "bg-success/20" : ""
        }`}
      >
        <span
          className={`font-body text-sm font-medium text-success-ink transition-opacity ${
            offset > 0 ? "opacity-100" : "opacity-0"
          }`}
        >
          Add to inventory
        </span>
        <span
          className={`font-body text-sm font-medium text-danger-ink transition-opacity ${
            offset < 0 ? "opacity-100" : "opacity-0"
          }`}
        >
          Remove
        </span>
      </div>

      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? "none" : "transform 160ms ease-out",
          opacity: leaving ? 0 : 1,
        }}
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
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
              {candidate.locationName ? ` · ${candidate.locationName}` : ""}
              {pictureWords(candidate)}
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

        {/* The swipe is a shortcut, not the only way out: a mouse has no
            swipe, and neither does a screen reader. */}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove “${detection.name}” from this list`}
          className="absolute right-1 top-1 rounded-md px-2 py-1 font-body text-sm leading-none text-muted transition-colors hover:bg-background hover:text-danger-ink"
        >
          ×
        </button>
      </div>
    </li>
  );
}
