"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ChecklistRoom, ChecklistRow, CheckState } from "@/lib/checklist";
import {
  dequeue,
  enqueue,
  loadQueue,
  pendingStates,
  saveQueue,
  type QueuedTick,
} from "@/lib/offline-queue";
import { setCheckState } from "./actions";
import { useContextMenu } from "@/components/context-menu";
import { SwipeStrip } from "@/components/swipe-strip";
import { useSwipeLeft } from "@/lib/use-swipe";

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
  const checked = row.checkState === "checked";
  // Left, like every swipe in the app, and to do the row's "yes": checked.
  // "Not needed" stays on its button and the right-click menu, where a slip
  // of the thumb can't take a line off the list.
  const swipe = useSwipeLeft(() => {
    if (!checked && !pending) onSet("checked");
  });

  const open = row.checkState === "open";
  const cleared = row.checkState === "cleared";

  // A right-click on a computer offers what the swipe does, and the rest.
  const context = useContextMenu(row.name, () =>
    pending
      ? []
      : [
          checked
            ? { label: "Already checked", disabled: true, onSelect: () => {} }
            : { label: "Mark checked", onSelect: () => onSet("checked") },
          cleared
            ? { label: "Put back on the list", onSelect: () => onSet("open") }
            : { label: "Not needed", onSelect: () => onSet("cleared") },
        ]
  );

  return (
    <li className="relative overflow-hidden border-b border-rule last:border-b-0">
      <SwipeStrip
        armed={swipe.armed}
        label="Mark checked"
        armedLabel="Let go to mark checked"
        done={checked ? "Already checked" : null}
      />

      {context.menu}
      <div
        {...swipe.handlers}
        onContextMenu={context.onContextMenu}
        style={swipe.style}
        className="relative flex items-center gap-3 bg-surface px-3 py-2.5"
      >
        {/* The box itself is 24px; the label around it is the 44px a
            finger actually hits, in a dim store, holding a prop. */}
        <label className="-m-2.5 flex shrink-0 cursor-pointer items-center justify-center p-2.5">
          <input
            type="checkbox"
            checked={row.checkState === "checked"}
            disabled={pending}
            onChange={(event) => onSet(event.target.checked ? "checked" : "open")}
            aria-label={`Checked ${row.name}`}
            className="h-6 w-6 accent-accent"
          />
        </label>

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
            <p className="font-body text-xs font-medium text-danger-ink">
              NOT CHECKED
              {/* Pulled and checked are two different facts on purpose — a
                  whole list can be marked pulled from a desk in seconds.
                  Saying which one is missing stops the production page
                  ("Pulled") and this one looking like they disagree. */}
              {row.pullStatus === "pulled" ? (
                <span className="font-normal"> · marked pulled, nobody has ticked it here</span>
              ) : null}
            </p>
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
            className="min-h-11 shrink-0 rounded-md px-2 font-body text-xs text-muted hover:text-foreground"
          >
            Put back
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => onSet("cleared")}
            data-print-hide
            className="min-h-11 shrink-0 rounded-md px-2 font-body text-xs text-muted hover:text-warning-ink"
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
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // The server is the truth, but waiting a round trip before the tick moves
  // makes a walk round a store feel broken. Overlay first, reconcile after.
  const [local, setLocal] = useState<Record<string, CheckState>>({});

  // Ticks made with no signal, kept on this device until they're sent.
  const [queue, setQueue] = useState<QueuedTick[]>([]);
  const flushing = useRef(false);

  // Storage is the source of truth for the queue, read and written in one
  // step, so a flush that starts straight after sees this tick.
  const keep = useCallback(
    (tick: QueuedTick) => {
      const next = enqueue(loadQueue(productionId), tick);
      saveQueue(productionId, next);
      setQueue(next);
    },
    [productionId]
  );

  /**
   * Sends what's waiting, oldest first, and stops at the first one the
   * network refuses — the rest wait for the next try. A tick the server
   * itself rejects (a row since deleted, say) is dropped with a message
   * rather than retried forever.
   */
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    let sent = 0;
    try {
      let waiting = loadQueue(productionId);
      for (const tick of [...waiting]) {
        let outcome;
        try {
          outcome = await setCheckState(productionId, tick.rowId, tick.state, tick.at);
        } catch {
          break; // Still no connection.
        }
        waiting = dequeue(waiting, tick.rowId);
        saveQueue(productionId, waiting);
        setQueue(waiting);
        sent += 1;
        if (!outcome.ok) setError(outcome.error);
      }
    } finally {
      flushing.current = false;
    }
    if (sent > 0) {
      router.refresh();
      // Ticks made while this round was sending went to the back of the
      // line; send them too rather than waiting for the next reconnect.
      if (loadQueue(productionId).length > 0) void flushRef.current();
    }
  }, [productionId, router]);
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // On opening: anything left from an earlier visit shows as ticked, and is
  // sent straight away if there's a connection. Then again whenever the
  // connection comes back.
  useEffect(() => {
    const waiting = loadQueue(productionId);
    if (waiting.length > 0) {
      // Restoring from storage on mount is the one place state has to be set
      // from an effect: it doesn't exist during the server render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQueue(waiting);
      setLocal((current) => ({ ...pendingStates(waiting), ...current }));
      if (navigator.onLine) void flush();
    }
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [productionId, flush]);

  function set(rowId: string, state: CheckState) {
    setLocal((current) => ({ ...current, [rowId]: state }));
    setError(null);
    const tick: QueuedTick = { rowId, state, at: new Date().toISOString() };

    // Known to be offline: don't even try. Keep it for later. And while
    // anything is still waiting, new ticks join the back of that line rather
    // than overtaking it — otherwise an older queued tick for this same row
    // could land after this one and undo it.
    if (!navigator.onLine || loadQueue(productionId).length > 0) {
      keep(tick);
      if (navigator.onLine) void flush();
      return;
    }

    startTransition(async () => {
      let outcome;
      try {
        outcome = await setCheckState(productionId, rowId, state, tick.at);
      } catch {
        // The connection dropped mid-walk. Same as offline: keep it.
        keep(tick);
        return;
      }
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

      {queue.length > 0 ? (
        <p
          role="status"
          className="rounded-md border border-rule bg-warning/20 px-3 py-2 font-body text-sm text-warning-ink"
        >
          {queue.length === 1 ? "1 tick is" : `${queue.length} ticks are`} saved on this device
          and will be sent when there’s a connection. Keep this page or the app open, or come back
          to it later — they won’t be lost.
        </p>
      ) : null}

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
