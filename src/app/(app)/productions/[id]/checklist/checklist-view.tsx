"use client";

import { useRef, useState, useTransition } from "react";
import type { ChecklistRoom, ChecklistRow, CheckState } from "@/lib/checklist";
import { setCheckState } from "./actions";

/** How far a row travels before letting go clears it. */
const SWIPE_THRESHOLD = 110;
const SWIPE_SLOP = 12;

function startedOnAControl(target: EventTarget | null): boolean {
  return Boolean(target instanceof Element && target.closest("button, input, a, select"));
}

/**
 * One line of the walk.
 *
 * Unchecked lines are loud on purpose: the list is a to-do, and a wall of red
 * that empties as you go is easier to read at arm's length than a page of grey
 * with ticks hidden in it.
 */
function Row({
  row,
  photoUrl,
  onSet,
  pending,
}: {
  row: ChecklistRow;
  photoUrl?: string;
  onSet: (state: CheckState) => void;
  pending: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const gesture = useRef<{ x: number; y: number; swiping: boolean } | null>(null);
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

    if (!start.swiping) {
      if (Math.abs(dy) > SWIPE_SLOP && Math.abs(dy) > Math.abs(dx)) {
        gesture.current = null;
        return;
      }
      if (Math.abs(dx) < SWIPE_SLOP || Math.abs(dx) <= Math.abs(dy)) return;
      start.swiping = true;
    }

    // Leftwards only: clearing is the one thing a swipe does here.
    const distance = Math.max(0, -dx);
    const eased =
      distance > SWIPE_THRESHOLD
        ? SWIPE_THRESHOLD + (distance - SWIPE_THRESHOLD) * 0.35
        : distance;
    travelled.current = eased;
    setOffset(-eased);
  }

  function onTouchEnd() {
    const start = gesture.current;
    gesture.current = null;
    if (!start?.swiping) return;

    if (travelled.current >= SWIPE_THRESHOLD) {
      onSet("cleared");
    }
    travelled.current = 0;
    setOffset(0);
  }

  const open = row.checkState === "open";
  const cleared = row.checkState === "cleared";

  return (
    <li className="relative overflow-hidden border-b border-rule last:border-b-0">
      <div
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-end bg-warning/20 pr-4"
      >
        <span className="font-body text-sm font-medium text-warning-ink">
          Not needed
        </span>
      </div>

      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          transform: `translateX(${offset}px)`,
          transition: gesture.current?.swiping ? "none" : "transform 160ms ease-out",
        }}
        className="relative flex items-center gap-3 bg-surface px-3 py-2.5"
      >
        <input
          type="checkbox"
          checked={row.checkState === "checked"}
          disabled={pending}
          onChange={(event) => onSet(event.target.checked ? "checked" : "open")}
          aria-label={`Checked ${row.name}`}
          className="h-5 w-5 shrink-0 accent-accent"
        />

        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL from a private bucket
          <img src={photoUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
        ) : null}

        <div className="min-w-0 flex-1">
          <p
            className={`font-body text-sm ${
              open
                ? "font-medium text-danger-ink"
                : cleared
                  ? "text-muted line-through"
                  : "text-foreground"
            }`}
          >
            {row.name}
            {row.quantityNeeded > 1 ? ` ×${row.quantityNeeded}` : ""}
          </p>

          {open ? (
            <p className="font-body text-xs font-medium text-danger-ink">NOT CHECKED</p>
          ) : cleared ? (
            <p className="font-body text-xs text-muted">Not needed after all</p>
          ) : row.checkedByName ? (
            <p className="font-body text-xs text-muted">Checked by {row.checkedByName}</p>
          ) : (
            <p className="font-body text-xs text-muted">Checked</p>
          )}
        </div>

        {/* A swipe is a shortcut, not the only way: this works with a mouse. */}
        {cleared ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onSet("open")}
            data-print-hide
            className="shrink-0 rounded-md px-2 py-1 font-body text-xs text-muted hover:text-foreground"
          >
            Put back
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => onSet("cleared")}
            data-print-hide
            className="shrink-0 rounded-md px-2 py-1 font-body text-xs text-muted hover:text-warning-ink"
          >
            Not needed
          </button>
        )}
      </div>
    </li>
  );
}

export function ChecklistView({
  productionId,
  rooms,
  photoUrlByRowId,
}: {
  productionId: string;
  rooms: ChecklistRoom[];
  photoUrlByRowId: Record<string, string>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // The server is the truth, but waiting a round trip before the tick moves
  // makes a walk round a store feel broken. Overlay first, reconcile after.
  const [local, setLocal] = useState<Record<string, CheckState>>({});

  function set(rowId: string, state: CheckState) {
    setLocal((current) => ({ ...current, [rowId]: state }));
    setError(null);
    startTransition(async () => {
      const outcome = await setCheckState(productionId, rowId, state);
      if (!outcome.ok) {
        setError(outcome.error);
        setLocal((current) => {
          const next = { ...current };
          delete next[rowId];
          return next;
        });
      }
    });
  }

  const allRows = rooms.flatMap((room) => room.containers.flatMap((c) => c.rows));
  const stateOf = (row: ChecklistRow) => local[row.id] ?? row.checkState;
  const remaining = allRows.filter((row) => stateOf(row) === "open").length;

  return (
    <div className="space-y-6">
      <p className="font-body text-sm text-muted">
        {remaining === 0
          ? "Everything on this list has been checked off."
          : `${remaining} still to check, in the order you'd walk them.`}
      </p>

      {error ? <p className="font-body text-sm text-danger-ink">{error}</p> : null}

      {rooms.map((room) => (
        <section key={room.id ?? "unfiled"}>
          <h2 className="font-display text-lg">{room.name}</h2>

          <div className="mt-3 space-y-4">
            {room.containers.map((container) => (
              <div
                key={container.id ?? "unfiled"}
                className="overflow-hidden rounded-lg border border-rule"
              >
                <p className="border-b border-rule bg-background px-3 py-1.5 font-body text-xs font-medium uppercase tracking-wide text-muted">
                  {container.name}
                </p>
                <ul>
                  {container.rows.map((row) => (
                    <Row
                      key={row.id}
                      row={{ ...row, checkState: stateOf(row) }}
                      photoUrl={photoUrlByRowId[row.id]}
                      pending={pending}
                      onSet={(state) => set(row.id, state)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
