"use client";

/**
 * "Add to room…" on an inventory item's right-click menu: file it in any
 * place (a room, or a shelf or box walked into), with an Undo.
 *
 * Like AddToProduction, rows don't talk to this directly: they put
 * moveToPlaceMenu() in their menu, which raises an event this component,
 * mounted once on the Inventory page, answers. The picker is the same one the
 * item form uses, so choosing a place works the same way everywhere.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LocationPicker } from "@/components/location-picker";
import { listPlaces, moveItemToPlace, type PlaceNode } from "@/app/(app)/inventory/actions";
import { locationPaths } from "@/lib/locations";
import type { MenuItem } from "@/components/context-menu";

type ItemRef = { id: string; name: string; locationId: string | null };

const EVENT = "move-to-place";
const BAR_MS = 6000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function requestMoveToPlace(item: ItemRef): void {
  window.dispatchEvent(new CustomEvent<ItemRef>(EVENT, { detail: item }));
}

/** The right-click menu's "Add to room…", with where it is now underneath. */
export function moveToPlaceMenu(item: ItemRef & { locationName?: string | null }): MenuItem[] {
  return [
    {
      label: "Add to room…",
      detail: item.locationId ? `Now in ${item.locationName ?? "a place"}` : "Not filed anywhere yet",
      onSelect: () => requestMoveToPlace({ id: item.id, name: item.name, locationId: item.locationId }),
    },
  ];
}

type Bar =
  | { kind: "moved"; item: ItemRef; fromId: string | null; to: string }
  | { kind: "undone"; item: ItemRef; to: string }
  | { kind: "error"; message: string };

export function MoveToPlace() {
  const router = useRouter();
  const [picking, setPicking] = useState<ItemRef | null>(null);
  const [places, setPlaces] = useState<PlaceNode[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [bar, setBar] = useState<Bar | null>(null);
  const barTimer = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const showBar = useCallback((next: Bar | null) => {
    setBar(next);
    if (barTimer.current !== null) window.clearTimeout(barTimer.current);
    barTimer.current = next ? window.setTimeout(() => setBar(null), BAR_MS) : null;
  }, []);

  const nameOf = useCallback(
    (id: string | null) => {
      if (!id) return "Unassigned";
      return locationPaths(places ?? []).get(id) ?? "that place";
    },
    [places]
  );

  useEffect(() => {
    async function onRequest(event: Event) {
      const item = (event as CustomEvent<ItemRef>).detail;
      if (!item || !ID.test(item.id)) return;
      setPicking(item);
      setChoice(item.locationId ?? "");
      setLoadError(null);
      try {
        const result = await listPlaces();
        if (result.ok) setPlaces(result.places);
        else setLoadError(result.message);
      } catch {
        setLoadError("Couldn’t load your places. Check the connection.");
      }
    }
    window.addEventListener(EVENT, onRequest);
    return () => window.removeEventListener(EVENT, onRequest);
  }, []);

  useEffect(() => () => {
    if (barTimer.current !== null) window.clearTimeout(barTimer.current);
  }, []);

  // Escape closes the sheet, unless the place picker inside it is open (it
  // takes Escape itself), and focus starts inside it.
  useEffect(() => {
    if (!picking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setPicking(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking]);

  async function move(item: ItemRef, to: string | null) {
    setBusy(true);
    try {
      const result = await moveItemToPlace(item.id, to);
      if (!result.ok) {
        showBar({ kind: "error", message: result.message });
        return;
      }
      showBar({ kind: "moved", item, fromId: result.fromId, to: nameOf(to) });
      router.refresh();
    } catch {
      showBar({ kind: "error", message: "Couldn’t reach the server. Try again." });
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    const item = picking;
    if (!item) return;
    setPicking(null);
    await move(item, choice || null);
  }

  async function undo() {
    if (bar?.kind !== "moved") return;
    const { item, fromId } = bar;
    showBar(null);
    const result = await moveItemToPlace(item.id, fromId);
    showBar(
      result.ok
        ? { kind: "undone", item, to: nameOf(fromId) }
        : { kind: "error", message: "Couldn’t undo that. Change its place on the item’s page." }
    );
    router.refresh();
  }

  const unchanged = picking ? (picking.locationId ?? "") === choice : true;

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
            aria-labelledby="move-to-place-title"
            data-move-to-place
            className="relative w-full rounded-t-2xl border border-rule bg-background px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 shadow-xl md:max-w-md md:rounded-2xl md:pb-4"
          >
            <p id="move-to-place-title" className="font-display text-lg leading-tight text-foreground">
              Add <span className="font-semibold">{picking.name}</span> to…
            </p>
            <p className="mt-1 font-body text-xs text-muted">
              A room, or walk in to a shelf or box inside one.
            </p>

            <div className="mt-3">
              {loadError ? (
                <p className="font-body text-sm text-danger-ink">{loadError}</p>
              ) : places === null ? (
                <p className="font-body text-sm text-muted">Loading places…</p>
              ) : places.length === 0 ? (
                <p className="font-body text-sm text-muted">
                  There aren’t any places yet. Add a room from the Inventory page first.
                </p>
              ) : (
                <LocationPicker
                  nodes={places}
                  value={choice}
                  onChange={setChoice}
                  label="Place"
                  selfLabel={(placeName) => (
                    <>
                      Put it in <span className="font-medium">{placeName}</span> itself
                    </>
                  )}
                />
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPicking(null)}
                className="min-h-11 rounded-md px-3 font-body text-sm text-muted hover:text-foreground md:min-h-9"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={unchanged || busy || !places?.length}
                onClick={() => void confirm()}
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 font-body text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-9"
              >
                {choice ? "Move it here" : "Take it out of its place"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        role="status"
        aria-live="polite"
        data-print-hide
        // Just above where the production bar sits, so the two never cover
        // each other.
        className="pointer-events-none fixed bottom-[calc(8.5rem+env(safe-area-inset-bottom))] left-24 right-4 z-40 flex justify-end md:bottom-24 md:left-auto md:right-6 md:w-96"
      >
        {bar || busy ? (
          <div
            data-move-bar
            className="pointer-events-auto flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-rule bg-foreground px-4 py-2.5 font-body text-sm text-background shadow-lg"
          >
            <span className="min-w-0 flex-1">
              {busy && !bar ? (
                "Moving…"
              ) : bar?.kind === "moved" ? (
                <>
                  Moved <strong className="font-medium">{bar.item.name}</strong> to {bar.to}
                </>
              ) : bar?.kind === "undone" ? (
                <>
                  Put <strong className="font-medium">{bar.item.name}</strong> back in {bar.to}
                </>
              ) : bar?.kind === "error" ? (
                bar.message
              ) : null}
            </span>
            {bar?.kind === "moved" ? (
              <button
                type="button"
                onClick={() => void undo()}
                className="-my-1 min-h-11 rounded-md px-2 font-body text-sm font-medium text-background underline underline-offset-2 md:min-h-8"
              >
                Undo
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
