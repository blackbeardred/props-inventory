"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { PullIssue } from "@/lib/checklist";
import { setCheckState } from "../checklist/actions";

/**
 * The left-behind list. Each line says what it is, that it isn't pulled, and
 * where to find it — which is the whole job: someone has to walk back.
 *
 * Clearing is here as well as on the checklist, because this is where you
 * realise a prop isn't wanted after all.
 */
export function IssueList({
  productionId,
  issues,
}: {
  productionId: string;
  issues: PullIssue[];
}) {
  const [pending, startTransition] = useTransition();
  const [cleared, setCleared] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function clear(rowId: string) {
    setCleared((current) => [...current, rowId]);
    setError(null);
    startTransition(async () => {
      const outcome = await setCheckState(productionId, rowId, "cleared");
      if (!outcome.ok) {
        setError(outcome.error);
        setCleared((current) => current.filter((id) => id !== rowId));
      }
    });
  }

  const visible = issues.filter((issue) => !cleared.includes(issue.row.id));

  return (
    <>
      {error ? <p className="mb-3 font-body text-sm text-danger-ink">{error}</p> : null}

      <ul className="overflow-hidden rounded-lg border border-rule">
        {visible.map((issue) => (
          <li
            key={issue.row.id}
            className="flex items-center gap-3 border-b border-rule bg-surface px-3 py-3 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <Link
                href={`/items/${issue.row.itemId}/edit`}
                className="font-body text-sm font-medium text-foreground underline-offset-2 hover:underline"
              >
                {issue.row.name}
                {issue.row.quantityNeeded > 1 ? ` ×${issue.row.quantityNeeded}` : ""}
              </Link>
              <p className="font-body text-xs font-medium text-danger-ink">NOT PULLED</p>
              <p className="font-body text-xs text-muted">{issue.where}</p>
            </div>

            <button
              type="button"
              disabled={pending}
              onClick={() => clear(issue.row.id)}
              className="shrink-0 rounded-md border border-rule px-3 py-1.5 font-body text-xs text-muted transition-colors hover:text-foreground disabled:opacity-60"
            >
              Not needed
            </button>
          </li>
        ))}
      </ul>

      {visible.length === 0 ? (
        <p className="mt-4 font-body text-sm text-muted">
          All cleared. Anything you clear here stops warning without pretending
          it was pulled.
        </p>
      ) : null}
    </>
  );
}
