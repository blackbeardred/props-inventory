"use client";

import { useEffect, useRef } from "react";

/**
 * Presses "Open my test copy" for the person, once, when the page was opened
 * from the home-screen app (?open=1). Only there: a link pasted into a chat
 * gets fetched by previewers that run no script, and nothing should sign
 * them in.
 */
export function AutoOpen({ formId }: { formId: string }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit();
  }, [formId]);
  return null;
}
