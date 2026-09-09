"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit button for a destructive action, gated behind a native confirm()
 * dialog and disabled while its form's action is pending. Must be rendered
 * inside a <form action={...}>.
 */
export function DeleteButton({
  children,
  confirmMessage,
}: {
  children: string;
  confirmMessage: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      onClick={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
      className="inline-flex items-center justify-center rounded-md border border-rule px-4 py-2 font-body text-sm font-medium text-muted transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Deleting…" : children}
    </button>
  );
}
