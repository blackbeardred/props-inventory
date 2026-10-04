"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Situation =
  | "unknown"
  | "installed"
  | "ready"
  | "ios"
  | "other";

/**
 * Putting the app on a home screen, explained for whatever device is reading.
 *
 * Android and desktop Chrome/Edge hand the page an install prompt it can
 * offer from a button. iPhones never do: Safari only installs from its Share
 * menu, so there the honest thing is to say where that is. Anywhere else,
 * the browser's own menu.
 */
export function InstallApp() {
  const [situation, setSituation] = useState<Situation>("unknown");
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    // Worked out on the client because the server can't know any of it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSituation(standalone ? "installed" : ios ? "ios" : "other");

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
      setSituation("ready");
    };
    const onInstalled = () => {
      setPrompt(null);
      setSituation("installed");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setPrompt(null);
    if (outcome === "accepted") setSituation("installed");
  }

  if (situation === "unknown") return null;

  return (
    <div className="rounded-lg border border-rule bg-surface px-5 py-4">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="hex w-5 bg-honey" />
        <p className="font-body text-sm font-medium text-foreground">
          {situation === "installed" ? "Installed on this device" : "Install the app"}
        </p>
      </div>

      {situation === "installed" ? (
        <p className="mt-2 font-body text-sm text-muted">
          You’re using the app. Pages you’ve opened here keep working with no signal, and checklist
          ticks made offline are sent when you’re back.
        </p>
      ) : (
        <p className="mt-2 font-body text-sm text-muted">
          An icon on your home screen that opens full screen, without the browser around it. Pages
          you’ve opened keep working with no signal — a checklist in a basement included.
        </p>
      )}

      {situation === "ready" ? (
        <button
          type="button"
          onClick={() => void install()}
          className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 py-2 font-body text-sm font-medium text-background transition-colors hover:opacity-90 md:min-h-0"
        >
          Install
        </button>
      ) : situation === "ios" ? (
        <ol className="mt-3 list-decimal space-y-1 pl-5 font-body text-sm text-foreground">
          <li>
            Open this page in <strong className="font-medium">Safari</strong>.
          </li>
          <li>
            Tap <strong className="font-medium">Share</strong> (the square with an arrow).
          </li>
          <li>
            Choose <strong className="font-medium">Add to Home Screen</strong>, then{" "}
            <strong className="font-medium">Add</strong>.
          </li>
        </ol>
      ) : situation === "other" ? (
        <p className="mt-3 font-body text-sm text-foreground">
          Use your browser’s menu: <strong className="font-medium">Install app</strong> or{" "}
          <strong className="font-medium">Add to Home screen</strong>. If neither is there, open
          this page in Chrome, Edge or Safari.
        </p>
      ) : null}
    </div>
  );
}
