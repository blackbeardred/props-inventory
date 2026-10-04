// Checklist ticks made with no signal, waiting to be sent.
//
// A storage basement is exactly where the checklist gets used and exactly
// where there's no connection. So a tick made offline is kept on the device
// and sent when the connection comes back, rather than failing.
//
// One entry per row: ticking, unticking and ticking again while offline is
// one change to send — the last — not three. Each entry keeps the moment it
// was made, so the server can record when the prop was actually checked
// rather than when the phone found wifi; the "abandoned box" rule reads that
// order.
//
// Pure, apart from the two storage helpers at the bottom, so the rules can be
// tested without a browser.

import type { CheckState } from "@/lib/checklist";

export type QueuedTick = {
  rowId: string;
  state: CheckState;
  /** When the tick was made, ISO 8601. */
  at: string;
};

const STATES: CheckState[] = ["open", "checked", "cleared"];

/** Adds a tick, replacing any earlier one for the same row. Order is kept by
 *  when each row was last touched, so replay follows the walk. */
export function enqueue(queue: QueuedTick[], tick: QueuedTick): QueuedTick[] {
  return [...queue.filter((entry) => entry.rowId !== tick.rowId), tick];
}

/** Takes one row out, once the server has it. */
export function dequeue(queue: QueuedTick[], rowId: string): QueuedTick[] {
  return queue.filter((entry) => entry.rowId !== rowId);
}

/**
 * Reads a stored queue, dropping anything malformed rather than trusting it:
 * this is text from local storage, and one bad entry mustn't stop the rest
 * being sent.
 */
export function parseQueue(raw: string | null): QueuedTick[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  let queue: QueuedTick[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const { rowId, state, at } = entry as Record<string, unknown>;
    if (typeof rowId !== "string" || !rowId) continue;
    if (!STATES.includes(state as CheckState)) continue;
    if (typeof at !== "string" || Number.isNaN(Date.parse(at))) continue;
    queue = enqueue(queue, { rowId, state: state as CheckState, at });
  }
  return queue;
}

/** The overlay the checklist draws from: row → state it will have once sent. */
export function pendingStates(queue: QueuedTick[]): Record<string, CheckState> {
  return Object.fromEntries(queue.map((entry) => [entry.rowId, entry.state]));
}

/**
 * Whether a time sent with a delayed tick can be believed. Not in the future
 * (beyond a little clock drift), and not older than a week — a tick that sat
 * on a phone for longer than that is recorded as made now.
 */
export function plausibleTickTime(at: string | undefined, now: Date): Date | null {
  if (!at) return null;
  const when = new Date(at);
  const t = when.getTime();
  if (Number.isNaN(t)) return null;
  const drift = 5 * 60 * 1000;
  const week = 7 * 24 * 60 * 60 * 1000;
  if (t > now.getTime() + drift) return null;
  if (t < now.getTime() - week) return null;
  return when;
}

export function queueKey(productionId: string): string {
  return `checklist-queue:${productionId}`;
}

/** Storage can be blocked or full. Losing the queue is bad; crashing the
 *  checklist over it is worse. */
export function loadQueue(productionId: string): QueuedTick[] {
  try {
    return parseQueue(window.localStorage.getItem(queueKey(productionId)));
  } catch {
    return [];
  }
}

export function saveQueue(productionId: string, queue: QueuedTick[]): void {
  try {
    if (queue.length === 0) window.localStorage.removeItem(queueKey(productionId));
    else window.localStorage.setItem(queueKey(productionId), JSON.stringify(queue));
  } catch {
    // Nothing more can be done; the ticks still show on this page.
  }
}
