"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Ctrl+Enter (⌘+Enter on a Mac) saves the form this sits in, from any field
 * in it — including the description box, where a plain Enter is a new line.
 *
 * It submits through the form's own submit button, so the server action, the
 * browser's required-field checks and the button's "Saving…" state all behave
 * exactly as a click would. While that button is disabled — a save already
 * on its way — the shortcut does nothing, rather than sending it twice.
 *
 * Renders the hint itself, beside the button, from tablet width up: a phone
 * has no Ctrl key to tell anyone about.
 */
export function SubmitShortcut() {
  const marker = useRef<HTMLSpanElement>(null);
  const [mac, setMac] = useState(false);

  useEffect(() => {
    const form = marker.current?.closest("form");
    if (!form) return;

    // Read once on the client; the server can't know, and guessing would
    // flash the wrong key on half the machines that load the page.
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
      if (event.isComposing) return;
      const submitter = form!.querySelector<HTMLButtonElement>(
        'button[type="submit"]:not([formaction])'
      );
      if (!submitter || submitter.disabled) return;
      event.preventDefault();
      form!.requestSubmit(submitter);
    }

    form.addEventListener("keydown", onKeyDown);
    return () => form.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <span
      ref={marker}
      className="hidden font-mono text-[11px] text-muted md:inline"
    >
      or {mac ? "⌘" : "Ctrl"} + Enter
    </span>
  );
}
