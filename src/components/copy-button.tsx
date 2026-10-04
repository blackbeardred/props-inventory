"use client";

import { useState } from "react";

/**
 * Copies a short piece of text, such as an invite code, and says so.
 *
 * Falls back to selecting nothing and saying it couldn't: the clipboard API
 * needs a secure context and a user gesture, and some in-app browsers refuse
 * it anyway. Being told to copy by hand is better than a button that silently
 * does nothing.
 */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-live="polite"
      className="inline-flex min-h-11 items-center justify-center rounded-md border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-background md:min-h-0"
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy it by hand" : label}
    </button>
  );
}
