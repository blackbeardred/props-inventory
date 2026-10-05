"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { undoDelete } from "@/app/(app)/theatre/deleted/actions";

/**
 * The bar that shows right after something is deleted: "Deleted Basket ·
 * Undo · Recently deleted".
 *
 * A delete's server action redirects here with ?deleted=<record>&deletedName=
 * (src/lib/undo-href.ts). The bar takes them out of the address straight
 * away, so a reload or Back doesn't offer the same Undo twice, and keeps
 * them in its own state until it's dismissed or times out. Undo restores in
 * place and refreshes the page, so the thing reappears where it was.
 */
const SHOW_MS = 12_000;

type State =
  | { kind: "deleted"; id: string; name: string }
  | { kind: "busy"; name: string }
  | { kind: "restored"; name: string; notes: string[] }
  | { kind: "error"; message: string };

export function DeletedBar() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);

  const id = params.get("deleted");
  const name = params.get("deletedName");

  useEffect(() => {
    if (!id) return;
    // Taken from the address and into the bar: see the comment above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ kind: "deleted", id, name: name || "It" });
    const rest = new URLSearchParams(params.toString());
    rest.delete("deleted");
    rest.delete("deletedName");
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [id, name, params, pathname, router]);

  useEffect(() => {
    if (!state || state.kind === "busy") return;
    const timer = window.setTimeout(() => setState(null), state.kind === "deleted" ? SHOW_MS : 6000);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function undo() {
    if (state?.kind !== "deleted") return;
    const { id: recordId, name: label } = state;
    setState({ kind: "busy", name: label });
    try {
      const result = await undoDelete(recordId);
      if (!result.ok) {
        setState({ kind: "error", message: result.message });
        return;
      }
      setState({ kind: "restored", name: result.label, notes: result.notes });
      router.refresh();
    } catch {
      setState({ kind: "error", message: "Couldn’t reach the server. It’s still in Recently deleted." });
    }
  }

  if (!state) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-print-hide
      className="pointer-events-none fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-24 right-4 z-40 flex justify-end md:bottom-6 md:left-auto md:right-6 md:w-96"
    >
      <div
        data-deleted-bar
        className="pointer-events-auto flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-rule bg-foreground px-4 py-2.5 font-body text-sm text-background shadow-lg"
      >
        <span className="min-w-0 flex-1">
          {state.kind === "deleted" ? (
            <>
              Deleted <strong className="font-medium">{state.name}</strong>
            </>
          ) : state.kind === "busy" ? (
            <>Putting {state.name} back…</>
          ) : state.kind === "restored" ? (
            <>
              Restored <strong className="font-medium">{state.name}</strong>
              {state.notes.map((note) => (
                <span key={note} className="mt-0.5 block text-xs opacity-80">
                  {note}
                </span>
              ))}
            </>
          ) : (
            state.message
          )}
        </span>
        {state.kind === "deleted" ? (
          <button
            type="button"
            onClick={() => void undo()}
            className="-my-1 min-h-11 rounded-md px-2 font-medium text-background underline underline-offset-2 md:min-h-8"
          >
            Undo
          </button>
        ) : null}
        {state.kind === "deleted" || state.kind === "error" ? (
          <Link
            href="/theatre/deleted"
            className="-my-1 inline-flex min-h-11 items-center rounded-md px-2 font-medium text-background underline underline-offset-2 md:min-h-8"
          >
            Recently deleted
          </Link>
        ) : null}
      </div>
    </div>
  );
}
