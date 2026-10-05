"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit button for a destructive action, gated behind a native confirm()
 * dialog and disabled while its form's action is pending. Must be rendered
 * inside a <form action={...}>. Without a confirmMessage it doesn't ask —
 * for small things the Undo bar can bring straight back.
 */
export function DeleteButton({
  children,
  confirmMessage,
  disabled = false,
}: {
  children: string;
  confirmMessage?: string;
  /** Not ready to delete yet (a choice in the form still needs making). */
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      onClick={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
      className="inline-flex min-h-11 items-center justify-center rounded-md md:min-h-0 border border-rule px-4 py-2 font-body text-sm font-medium text-muted transition-colors hover:border-danger/50 hover:text-danger-ink disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Deleting…" : children}
    </button>
  );
}
