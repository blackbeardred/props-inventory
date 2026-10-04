"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { handOffPhoto } from "@/lib/photo-handoff";
import {
  checklistHref,
  lastChecklist,
  lastProduction,
  type RecentProduction,
} from "@/lib/recent-places";

/**
 * The thumb hexagon: a floating shortcut menu on phones, bottom left, just
 * above the tab bar.
 *
 * Pressed, it does what every hexagon in the app does when it opens — turns
 * 90° and goes from honey to ink — and the shortcuts rise above it, closest to
 * the thumb first. Scrolling sends it off the left edge so it never sits on
 * top of what someone is reading, and it slides back once the page stops
 * moving. It also steps aside while a text field has the keyboard up.
 *
 * "Take picture" asks one question after the photo: is this one new prop, or
 * a whole prop table to mark off for a production? The photo is handed to the
 * page that answers it (see photo-handoff), so nobody takes it twice.
 */

type Step = "menu" | "photo" | "production";

type ProductionOption = { id: string; name: string };

/** Long enough that a flick's last scroll event has landed, short enough that
 *  it's back by the time a thumb comes looking for it. */
const SETTLE_MS = 300;

export function QuickActions() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("menu");
  const [scrolling, setScrolling] = useState(false);
  const [typing, setTyping] = useState(false);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [checklist, setChecklist] = useState<RecentProduction | null>(null);
  const [productions, setProductions] = useState<ProductionOption[] | null>(null);
  const [productionError, setProductionError] = useState<string | null>(null);

  const hexRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number | null>(null);
  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    setStep("menu");
    setPhoto((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    if (returnFocus) hexRef.current?.focus();
  }, []);

  // Off the left edge while the page moves, back once it settles. An open
  // menu closes instead: it was opened to be used, and a scroll means it
  // isn't being.
  useEffect(() => {
    function onScroll() {
      if (openRef.current) close(false);
      setScrolling(true);
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => setScrolling(false), SETTLE_MS);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    };
  }, [close]);

  // Out of the way while the keyboard is up for a text field — on a phone
  // it would otherwise float over whatever is being typed.
  useEffect(() => {
    const isTextField = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.matches("textarea, select, [contenteditable=''], [contenteditable='true']") ||
        (target instanceof HTMLInputElement &&
          !["checkbox", "radio", "file", "button", "submit", "range", "hidden"].includes(target.type)));
    const onIn = (event: FocusEvent) => setTyping(isTextField(event.target));
    const onOut = () => setTyping(false);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    // The first choice gets focus, so a keyboard or screen reader lands in the
    // menu it just opened rather than behind it.
    panelRef.current?.querySelector<HTMLElement>("a, button, label")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step, close]);

  function toggle() {
    if (open) {
      close();
      return;
    }
    setChecklist(lastChecklist());
    setStep("menu");
    setOpen(true);
  }

  function go(href: string) {
    close(false);
    router.push(href);
  }

  function onPicture(file: File | undefined) {
    if (!file) return;
    setPhoto((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return { file, url: URL.createObjectURL(file) };
    });
    setStep("photo");
  }

  async function chooseProduction() {
    setStep("production");
    setProductionError(null);
    if (productions) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("productions")
      .select("id, name")
      .order("start_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) {
      setProductionError("Couldn’t load your productions. Check the connection and try again.");
      return;
    }
    // The one this device had open last goes first: most of the time, it's
    // the show being worked on.
    const recent = lastProduction();
    const rows = ((data ?? []) as ProductionOption[]).sort(
      (a, b) => Number(b.id === recent?.id) - Number(a.id === recent?.id)
    );
    setProductions(rows);
  }

  function sendPhotoTo(href: string) {
    if (!photo) return;
    handOffPhoto(photo.file);
    go(href);
  }

  const away = scrolling || typing;

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close the shortcuts"
          tabIndex={-1}
          onClick={() => close()}
          className="fixed inset-0 z-30 bg-foreground/25 md:hidden"
        />
      ) : null}

      <div
        data-quick-actions
        data-print-hide
        // Flies out to the left while the page scrolls (or a field is being
        // typed in), and back in when it settles.
        style={{ transform: away && !open ? "translateX(calc(-100% - 2rem))" : "translateX(0)" }}
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-4 z-40 transition-transform duration-200 ease-out motion-reduce:transition-none md:hidden"
        aria-hidden={away && !open ? true : undefined}
      >
        {open ? (
          <div
            ref={panelRef}
            id="quick-actions-menu"
            role="menu"
            aria-label="Shortcuts"
            className="absolute bottom-full left-0 mb-3 flex w-[min(18rem,calc(100vw-2rem))] flex-col-reverse gap-2"
          >
            {step === "menu" ? (
              <>
                {/* flex-col-reverse: the first in the list sits nearest the
                    thumb. */}
                <Choice onClick={() => go("/items/new")}>Add item</Choice>
                <label
                  role="menuitem"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      (event.currentTarget.querySelector("input") as HTMLInputElement)?.click();
                    }
                  }}
                  className={CHOICE}
                >
                  <Bullet />
                  Take picture
                  {/* No `capture`: the phone offers camera and library both. */}
                  <input
                    type="file"
                    accept="image/*"
                    tabIndex={-1}
                    onChange={(event) => {
                      onPicture(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                    className="sr-only"
                  />
                </label>
                <Choice onClick={() => go("/items/lookalike")}>Image search</Choice>
                {checklist ? (
                  <Choice onClick={() => go(checklistHref(checklist))} detail={checklist.name}>
                    Back to my checklist
                  </Choice>
                ) : null}
              </>
            ) : step === "photo" && photo ? (
              <>
                <Choice onClick={() => sendPhotoTo("/items/new")} detail="A single item, with this as its picture">
                  Add as a new prop
                </Choice>
                <Choice onClick={() => void chooseProduction()} detail="Mark what’s on it for a production">
                  Add as a prop table
                </Choice>
                <PhotoPreview url={photo.url} caption="What is this?" onBack={() => setStep("menu")} />
              </>
            ) : step === "production" && photo ? (
              <>
                {productionError ? (
                  <p className={`${CHOICE} cursor-default text-danger-ink`}>{productionError}</p>
                ) : productions === null ? (
                  <p className={`${CHOICE} cursor-default text-muted`}>Loading productions…</p>
                ) : productions.length === 0 ? (
                  <Choice onClick={() => go("/productions/new")} detail="There aren’t any yet">
                    Add a production first
                  </Choice>
                ) : (
                  productions.slice(0, 6).map((production) => (
                    <Choice
                      key={production.id}
                      onClick={() => sendPhotoTo(`/productions/${production.id}/photo`)}
                    >
                      {production.name}
                    </Choice>
                  ))
                )}
                <PhotoPreview
                  url={photo.url}
                  caption="Which production?"
                  onBack={() => setStep("photo")}
                />
              </>
            ) : null}
          </div>
        ) : null}

        {/* The focus ring sits on this unclipped wrapper: a clip-path clips
            the element's own outline. The drop shadow is a filter for the
            same reason — box-shadow is clipped away with the corners. */}
        <span className="inline-flex rounded-[4px] [filter:drop-shadow(0_3px_6px_rgb(42_34_25/0.35))] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-accent">
          <button
            ref={hexRef}
            type="button"
            data-hex-toggle
            onClick={toggle}
            aria-expanded={open}
            aria-controls={open ? "quick-actions-menu" : undefined}
            aria-label={open ? "Close shortcuts" : "Shortcuts"}
            className={`hex flex w-16 items-center justify-center border-0 p-0 font-body text-2xl leading-none outline-none transition-[rotate,background-color,color] duration-200 ease-out ${
              open ? "rotate-90 bg-foreground text-background" : "bg-honey text-foreground"
            }`}
          >
            {/* Counter-rotated, so the mark reads upright once the hexagon
                has turned. */}
            <span
              aria-hidden="true"
              className={`transition-[rotate] duration-200 ease-out motion-reduce:transition-none ${open ? "-rotate-45" : ""}`}
            >
              +
            </span>
          </button>
        </span>
      </div>
    </>
  );
}

const CHOICE =
  "flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-full border border-rule bg-surface px-4 py-2 text-left font-body text-[15px] font-medium text-foreground shadow-md outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 active:bg-background";

function Bullet() {
  return <span aria-hidden="true" className="hex w-3 shrink-0 bg-honey" />;
}

function Choice({
  children,
  detail,
  onClick,
}: {
  children: React.ReactNode;
  detail?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={CHOICE}>
      <Bullet />
      <span className="min-w-0">
        <span className="block truncate">{children}</span>
        {detail ? (
          <span className="block truncate font-mono text-[11px] font-normal text-muted">{detail}</span>
        ) : null}
      </span>
    </button>
  );
}

function PhotoPreview({
  url,
  caption,
  onBack,
}: {
  url: string;
  caption: string;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-rule bg-surface p-2 shadow-md">
      {/* eslint-disable-next-line @next/next/no-img-element -- a blob URL from this phone */}
      <img src={url} alt="The photo you just took" className="h-14 w-14 rounded-xl object-cover" />
      <span className="min-w-0 flex-1 font-body text-sm font-medium text-foreground">{caption}</span>
      <button
        type="button"
        onClick={onBack}
        className="min-h-11 rounded-full px-3 font-body text-sm text-muted hover:text-foreground"
      >
        Back
      </button>
    </div>
  );
}
