"use client";

import { useState } from "react";
import { listItemsToRetag, retagItems } from "@/lib/tag-catch-up-actions";

/**
 * "Refresh all search tags": re-tags every item in the theatre, a few at a
 * time, with progress. For after the tagging itself improves, when items
 * tagged the old way should catch up. Untagged items don't need it; they're
 * filled in on their own (TagCatchUp).
 */
const BATCH = 4;

type State =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number }
  | { kind: "done"; total: number }
  | { kind: "stopped"; done: number; total: number; why: string };

export function RetagAll() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function run() {
    const listed = await listItemsToRetag();
    if ("error" in listed) {
      setState({ kind: "stopped", done: 0, total: 0, why: listed.error });
      return;
    }
    const { ids } = listed;
    let done = 0;
    setState({ kind: "running", done, total: ids.length });
    for (let i = 0; i < ids.length; i += BATCH) {
      const result = await retagItems(ids.slice(i, i + BATCH)).catch(() => ({ tagged: 0, stalled: true, error: "The connection dropped." }));
      done += result.tagged;
      if (result.stalled) {
        setState({
          kind: "stopped",
          done,
          total: ids.length,
          why: result.error ?? "The tagger didn’t answer. Check the Anthropic API key and the monthly spend limit, then try again.",
        });
        return;
      }
      setState({ kind: "running", done, total: ids.length });
    }
    setState({ kind: "done", total: ids.length });
  }

  return (
    <div data-retag-all className="space-y-3">
      <button
        type="button"
        onClick={() => void run()}
        disabled={state.kind === "running"}
        className="inline-flex min-h-11 items-center justify-center rounded-md border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface disabled:cursor-default disabled:opacity-60 md:min-h-0"
      >
        {state.kind === "running" ? "Refreshing…" : "Refresh all search tags"}
      </button>
      <p role="status" className="font-body text-sm text-muted">
        {state.kind === "running"
          ? `Tagged ${state.done} of ${state.total}. Keep this page open.`
          : state.kind === "done"
            ? `Done: all ${state.total} items have fresh tags.`
            : state.kind === "stopped"
              ? `Stopped after ${state.done} of ${state.total}. ${state.why}`
              : null}
      </p>
    </div>
  );
}
