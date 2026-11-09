"use client";

import { useActionState } from "react";
import { CopyButton } from "@/components/copy-button";
import { DismissableDetails } from "@/components/dismissable-details";
import { SubmitButton } from "@/components/submit-button";
import { cancelHandover, createHandover, type HandoverState } from "../organization/actions";
import { handoverExpires, handoverPath } from "@/lib/school";

const START: HandoverState = { token: null, madeAt: null, error: null };

const SUMMARY =
  "inline-flex min-h-11 cursor-pointer list-none items-center justify-center rounded-md border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface md:min-h-0 [&::-webkit-details-marker]:hidden";

function day(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/**
 * Handing a school theater to the next teacher (migration 018). The link is
 * made on request and shown here once: the stored links can't be read back,
 * so a lost one is replaced by making another (which also switches the old
 * one off).
 */
export function HandoverPanel() {
  const [state, make, pending] = useActionState(createHandover, START);

  // Only ever set after the button is pressed, so window is there.
  const link = state.token ? `${window.location.origin}${handoverPath(state.token)}` : null;

  return (
    <div className="space-y-4" data-handover>
      {link && state.madeAt ? (
        <div className="rounded-lg border border-rule bg-surface px-4 py-3" data-handover-link>
          <p className="font-body text-sm font-medium text-foreground">Send this link to the new teacher</p>
          <p className="mt-1 break-all rounded-md border border-rule bg-background px-3 py-2 font-mono text-xs text-foreground">
            {link}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <CopyButton text={link} label="Copy link" />
            <span className="font-body text-sm text-muted">
              Works once, until {day(handoverExpires(new Date(state.madeAt)).toISOString())}.
            </span>
          </div>
          <p className="mt-3 font-body text-sm text-muted">
            When they accept it, they become the teacher and you lose access straight away.
          </p>
        </div>
      ) : null}

      {state.error ? (
        <p role="alert" className="font-body text-sm text-danger-ink">
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <DismissableDetails className="relative" data-handover-confirm>
          <summary className={SUMMARY}>{link ? "Make a new link" : "Make a handover link"}</summary>
          <div className="absolute left-0 z-20 mt-2 w-72 max-w-[calc(100vw-3rem)] rounded-md border border-rule bg-surface p-4 shadow-lg">
            <p className="font-body text-sm text-foreground">
              Whoever accepts the link becomes the teacher, and you lose access straight away.
              Send it only to the new teacher.
            </p>
            {link ? (
              <p className="mt-2 font-body text-sm text-muted">The link above stops working.</p>
            ) : null}
            <form action={make} className="mt-3">
              <SubmitButton pendingText="Making…">{pending ? "Making…" : "Make the link"}</SubmitButton>
            </form>
          </div>
        </DismissableDetails>

        <form action={cancelHandover}>
          <SubmitButton variant="ghost" pendingText="Cancelling…">
            Cancel any link
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
