"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  addToPullList,
  listPullTargets,
  undoAddToPullList,
  type PullTarget,
} from "@/app/(app)/inventory/actions";
import { lastProduction } from "@/lib/recent-places";

/**
 * Adding an inventory item to a production's pull list, from a swipe (or the
 * "Add to a production" button in an opened item).
 *
 * The user chose "ask once, then remember": the first swipe asks which
 * production, and after that swipes go straight there, with a bar saying
 * where each one went — Undo if it was a slip, Change to send it somewhere
 * else and swipe there from then on. The choice is kept on this device for
 * twelve hours, so tomorrow's first swipe asks again rather than quietly
 * feeding yesterday's show.
 *
 * Rows don't talk to this directly: they call requestAddToProduction, which
 * raises an event this component, mounted once per page, answers.
 */

type ItemRef = { id: string; name: string };

const EVENT = "add-to-production";
const CHANGED = "pull-target-changed";
const KEY = "pull-target";
const KEEP_MS = 12 * 60 * 60 * 1000;
const BAR_MS = 6000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function requestAddToProduction(item: ItemRef): void {
  window.dispatchEvent(new CustomEvent<ItemRef>(EVENT, { detail: item }));
}

function readTarget(): PullTarget | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    const t = stored?.target;
    if (
      typeof stored?.at === "number" &&
      Date.now() - stored.at < KEEP_MS &&
      t &&
      typeof t.productionId === "string" &&
      ID.test(t.productionId) &&
      (t.pullListId === null || (typeof t.pullListId === "string" && ID.test(t.pullListId))) &&
      typeof t.productionName === "string" &&
      typeof t.label === "string"
    ) {
      return {
        productionId: t.productionId,
        productionName: t.productionName.slice(0, 120),
        pullListId: t.pullListId,
        label: t.label.slice(0, 160),
      };
    }
  } catch {
    // Unreadable or blocked: the next swipe just asks.
  }
  return null;
}

function writeTarget(target: PullTarget | null): void {
  try {
    if (target) window.localStorage.setItem(KEY, JSON.stringify({ target, at: Date.now() }));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Can't remember it; every swipe will ask.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** What a swipe will do, for the strip it uncovers: "Add to Noises Off!", or
 *  "Add to a production…" when it will ask. Null on the server. */
export function usePullTargetLabel(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => readTarget()?.label ?? "",
    () => null
  );
}

type Bar =
  | { kind: "added"; item: ItemRef; target: PullTarget; pullListItemId: string }
  | { kind: "already"; item: ItemRef; target: PullTarget }
  | { kind: "undone"; item: ItemRef; target: PullTarget }
  | { kind: "error"; item: ItemRef; message: string };

export function AddToProduction() {
  const [picking, setPicking] = useState<ItemRef | null>(null);
  const [targets, setTargets] = useState<PullTarget[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bar, setBar] = useState<Bar | null>(null);
  const [busy, setBusy] = useState(false);
  const barTimer = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const showBar = useCallback((next: Bar | null) => {
    setBar(next);
    if (barTimer.current !== null) window.clearTimeout(barTimer.current);
    barTimer.current = next ? window.setTimeout(() => setBar(null), BAR_MS) : null;
  }, []);

  const add = useCallback(
    async (item: ItemRef, target: PullTarget) => {
      setBusy(true);
      try {
        const result = await addToPullList(item.id, target);
        if (!result.ok) {
          // A target that no longer exists is forgotten, so the next swipe asks.
          writeTarget(null);
          showBar({ kind: "error", item, message: result.message });
          return;
        }
        writeTarget(result.target);
        showBar(
          result.added
            ? { kind: "added", item, target: result.target, pullListItemId: result.pullListItemId }
            : { kind: "already", item, target: result.target }
        );
        // A little buzz on phones that have one: the add happened off-screen
        // as far as the thumb is concerned.
        navigator.vibrate?.(12);
      } catch {
        showBar({ kind: "error", item, message: "Couldn’t reach the server. Try again." });
      } finally {
        setBusy(false);
      }
    },
    [showBar]
  );

  const openPicker = useCallback(async (item: ItemRef) => {
    setPicking(item);
    setLoadError(null);
    try {
      const result = await listPullTargets();
      if (!result.ok) {
        setLoadError(result.message);
        return;
      }
      // The production this phone had open last goes first: most of the
      // time it's the show being pulled for.
      const recent = lastProduction()?.id;
      setTargets(
        [...result.targets].sort(
          (a, b) => Number(b.productionId === recent) - Number(a.productionId === recent)
        )
      );
    } catch {
      setLoadError("Couldn’t load your productions. Check the connection.");
    }
  }, []);

  useEffect(() => {
    function onRequest(event: Event) {
      const item = (event as CustomEvent<ItemRef>).detail;
      if (!item || !ID.test(item.id)) return;
      const target = readTarget();
      if (target) void add(item, target);
      else void openPicker(item);
    }
    window.addEventListener(EVENT, onRequest);
    return () => window.removeEventListener(EVENT, onRequest);
  }, [add, openPicker]);

  useEffect(() => () => {
    if (barTimer.current !== null) window.clearTimeout(barTimer.current);
  }, []);

  // The sheet: Escape closes it, and focus starts inside it.
  useEffect(() => {
    if (!picking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPicking(null);
    };
    window.addEventListener("keydown", onKey);
    sheetRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [picking, targets]);

  async function choose(target: PullTarget) {
    const item = picking;
    setPicking(null);
    if (!item) return;
    writeTarget(target);
    await add(item, target);
  }

  async function undo() {
    if (bar?.kind !== "added") return;
    const { item, target, pullListItemId } = bar;
    showBar(null);
    const result = await undoAddToPullList(pullListItemId);
    showBar(
      result.ok
        ? { kind: "undone", item, target }
        : { kind: "error", item, message: "Couldn’t undo that. Remove it on the production page." }
    );
  }

  /** Send this one somewhere else instead, and swipe there from now on. */
  async function change() {
    if (!bar) return;
    const { item } = bar;
    if (bar.kind === "added") await undoAddToPullList(bar.pullListItemId);
    showBar(null);
    writeTarget(null);
    await openPicker(item);
  }

  return (
    <>
      {picking ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" data-print-hide>
          <button
            type="button"
            aria-label="Cancel"
            tabIndex={-1}
            onClick={() => setPicking(null)}
            className="absolute inset-0 bg-foreground/30"
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-to-production-title"
            className="relative max-h-[80vh] w-full overflow-y-auto rounded-t-2xl border border-rule bg-background px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 shadow-xl md:max-w-md md:rounded-2xl md:pb-4"
          >
            <p id="add-to-production-title" className="font-display text-lg leading-tight text-foreground">
              Add <span className="font-semibold">{picking.name}</span> to…
            </p>
            <p className="mt-1 font-body text-xs text-muted">
              Swipes go to the one you pick from now on. Change it from the bar
              that shows after each add.
            </p>

            <div className="mt-3 flex flex-col gap-2">
              {loadError ? (
                <p className="font-body text-sm text-danger-ink">{loadError}</p>
              ) : targets === null ? (
                <p className="font-body text-sm text-muted">Loading productions…</p>
              ) : targets.length === 0 ? (
                <p className="font-body text-sm text-muted">
                  There aren’t any productions yet. Add one from the Productions tab first.
                </p>
              ) : (
                targets.map((target) => (
                  <button
                    key={`${target.productionId}:${target.pullListId ?? ""}`}
                    type="button"
                    data-pull-target
                    onClick={() => void choose(target)}
                    className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-rule bg-surface px-4 py-2 text-left font-body text-[15px] font-medium text-foreground transition-colors hover:border-accent-soft focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <span aria-hidden="true" className="hex w-3 shrink-0 bg-honey" />
                    <span className="min-w-0 truncate">{target.label}</span>
                  </button>
                ))
              )}
            </div>

            <button
              type="button"
              onClick={() => setPicking(null)}
              className="mt-3 min-h-11 w-full rounded-md font-body text-sm text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div
        role="status"
        aria-live="polite"
        data-print-hide
        // Clear of the thumb hexagon on the left and above the tab bar on a
        // phone; bottom right from md up.
        className="pointer-events-none fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-24 right-4 z-40 flex justify-end md:bottom-6 md:left-auto md:right-6 md:w-96"
      >
        {bar || busy ? (
          <div
            data-pull-bar
            className="pointer-events-auto flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-rule bg-foreground px-4 py-2.5 font-body text-sm text-background shadow-lg"
          >
            <span className="min-w-0 flex-1">
              {busy && !bar ? (
                "Adding…"
              ) : bar?.kind === "added" ? (
                <>
                  Added <strong className="font-medium">{bar.item.name}</strong> to {bar.target.label}
                </>
              ) : bar?.kind === "already" ? (
                <>
                  <strong className="font-medium">{bar.item.name}</strong> is already on {bar.target.label}
                </>
              ) : bar?.kind === "undone" ? (
                <>
                  Took <strong className="font-medium">{bar.item.name}</strong> off {bar.target.label}
                </>
              ) : bar?.kind === "error" ? (
                bar.message
              ) : null}
            </span>
            {bar?.kind === "added" ? (
              <BarButton onClick={() => void undo()}>Undo</BarButton>
            ) : null}
            {bar && bar.kind !== "undone" ? (
              <BarButton onClick={() => void change()}>
                {bar.kind === "error" ? "Choose" : "Change"}
              </BarButton>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

function BarButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Cream and underlined: honey is never type, even on the ink bar.
      className="-my-1 min-h-11 rounded-md px-2 font-body text-sm font-medium text-background underline underline-offset-2 md:min-h-8"
    >
      {children}
    </button>
  );
}
