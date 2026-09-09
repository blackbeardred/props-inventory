"use client";

import { useFormStatus } from "react-dom";

const VARIANTS = {
  primary: "bg-accent text-background hover:opacity-90",
  ghost: "border border-rule text-foreground hover:bg-surface",
} as const;

/**
 * A submit button that disables itself while its form's action is pending.
 * Must be rendered inside a <form action={...}> (useFormStatus reads that
 * form's status via context). This exists specifically to prevent
 * double-submits — e.g. a photo upload taking a moment gives a second click
 * time to land before the page navigates away, which without this created
 * two items (or, on the auth forms, could create two organizations) from
 * one logical submit.
 */
export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
}: {
  children: string;
  pendingText?: string;
  variant?: keyof typeof VARIANTS;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 font-body text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]}`}
    >
      {pending ? (pendingText ?? "Working…") : children}
    </button>
  );
}
