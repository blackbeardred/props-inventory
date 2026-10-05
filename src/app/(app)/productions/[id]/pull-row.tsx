"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { PULL_LIST_ITEM_STATUS_LABELS, type PullListItemStatus } from "@/lib/inventory";
import { useSwipeRight } from "@/lib/use-swipe";
import { updatePullListItemStatus } from "./actions";

/** In the order things happen to a prop, which is also the order on screen. */
const STATUSES: PullListItemStatus[] = ["pending", "pulled", "returned"];

function statusForm(productionId: string, pullListItemId: string, status: PullListItemStatus) {
  const data = new FormData();
  data.set("productionId", productionId);
  data.set("pullListItemId", pullListItemId);
  data.set("newStatus", status);
  return data;
}

/**
 * One line of a pull list, which a phone can swipe right to mark pulled.
 *
 * The line slides over a green strip that says what letting go will do, and
 * says "Already pulled" instead when it is — a swipe then does nothing, rather
 * than quietly un-returning something. The status buttons in the line do the
 * same job for a mouse, a keyboard or a screen reader.
 */
export function PullRow({
  productionId,
  pullListItemId,
  status,
  children,
}: {
  productionId: string;
  pullListItemId: string;
  status: PullListItemStatus;
  children: ReactNode;
}) {
  const [saving, startSaving] = useTransition();
  const [sent, setSent] = useState(false);
  const already = status === "pulled";

  const swipe = useSwipeRight(() => {
    if (already) return;
    setSent(true);
    startSaving(async () => {
      await updatePullListItemStatus(statusForm(productionId, pullListItemId, "pulled"));
    });
  });

  // Shown as pulled from the moment the finger lifts, until the page comes
  // back with the saved state.
  const showPulled = sent && saving;

  return (
    <li
      data-pull-row
      data-status={showPulled ? "pulled" : status}
      className="relative overflow-hidden"
    >
      <div
        aria-hidden="true"
        className={`absolute inset-0 flex items-center pl-4 transition-colors ${
          already ? "bg-rule/40" : swipe.armed ? "bg-accent/30" : "bg-accent/15"
        }`}
      >
        <span
          className={`font-body text-sm font-medium ${already ? "text-muted" : "text-accent-ink"}`}
        >
          {already ? "Already pulled" : swipe.armed ? "Let go to mark pulled" : "Mark pulled"}
        </span>
      </div>

      <div
        {...swipe.handlers}
        style={swipe.style}
        className={`relative flex flex-wrap items-center gap-x-4 gap-y-2 bg-background py-3 transition-opacity ${
          showPulled ? "opacity-60" : ""
        }`}
      >
        {children}
      </div>
    </li>
  );
}

/**
 * Pending · Pulled · Returned, always in that order and always in the same
 * place, with the current one filled in.
 *
 * It replaces a badge plus one button labelled with the *next* step ("Mark
 * pulled", "Mark returned", "Mark pending"). The three labels were different
 * widths and the badge beside them was too, so on a phone the button moved
 * every time it was pressed — usually out from under the thumb that had just
 * pressed it. Three fixed segments also let you go straight from pending to
 * returned, or correct a slip, without going round the cycle.
 *
 * One form, three submit buttons; the pressed one carries its value. While it
 * saves, the chosen segment is the one shown filled.
 */
export function StatusSwitch({ status }: { status: PullListItemStatus }) {
  return (
    <div
      role="group"
      aria-label="Status"
      className="grid w-full grid-cols-3 overflow-hidden rounded-md border border-rule md:w-72"
    >
      <Segments status={status} />
    </div>
  );
}

/** Waiting is honey (ink on it, never honey type), out is the accent green,
 *  back is the quiet brown. */
const ACTIVE: Record<PullListItemStatus, string> = {
  pending: "bg-honey/60 text-foreground",
  pulled: "bg-accent text-background",
  returned: "bg-muted text-background",
};

function Segments({ status }: { status: PullListItemStatus }) {
  const { pending, data } = useFormStatus();
  const target = pending ? (data?.get("newStatus") as PullListItemStatus | null) : null;
  const shown = target ?? status;

  return STATUSES.map((value) => {
    const active = shown === value;
    return (
      <button
        key={value}
        type="submit"
        name="newStatus"
        value={value}
        aria-pressed={active}
        disabled={pending || value === status}
        className={`min-h-11 border-l border-rule px-2 font-body text-sm transition-colors first:border-l-0 disabled:cursor-default md:min-h-9 ${
          active ? `font-medium ${ACTIVE[value]}` : "text-muted hover:bg-surface hover:text-foreground"
        }`}
      >
        {PULL_LIST_ITEM_STATUS_LABELS[value]}
      </button>
    );
  });
}
