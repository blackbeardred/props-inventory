"use client";

import { useRef } from "react";

/**
 * A quantity that saves itself when you leave the box or press Enter, inside
 * a server-action form.
 *
 * It replaces a number box with its own Save button on every pull-list row.
 * That was one more control per row — six on one line on a phone — and a
 * changed number that nobody pressed Save on was quietly thrown away.
 */
export function QuantityField({
  name,
  defaultValue,
  label,
}: {
  name: string;
  defaultValue: number;
  /** Read out by a screen reader; the row's own text says what it's of. */
  label: string;
}) {
  const saved = useRef(String(defaultValue));

  function submitIfChanged(input: HTMLInputElement) {
    const value = input.value.trim();
    if (!value || value === saved.current || Number(value) < 1) {
      input.value = saved.current;
      return;
    }
    saved.current = value;
    input.form?.requestSubmit();
  }

  return (
    <label className="inline-flex items-center gap-1 font-body text-xs text-muted">
      <span aria-hidden="true">×</span>
      <input
        type="number"
        inputMode="numeric"
        name={name}
        min={1}
        defaultValue={defaultValue}
        aria-label={label}
        onBlur={(event) => submitIfChanged(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submitIfChanged(event.currentTarget);
          }
        }}
        className="min-h-11 w-16 rounded-md border border-rule bg-background px-2 font-body text-sm text-foreground outline-none transition-colors focus:border-accent md:min-h-0 md:py-1"
      />
    </label>
  );
}
