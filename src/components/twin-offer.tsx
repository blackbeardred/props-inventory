"use client";

/**
 * Add item's "Is this another one of those?" (twins, migration 009).
 *
 * When the prop being added looks like one the theatre already has (its
 * photo is a near-certain match, on a device that holds the recognition
 * model, or its name says the same thing), the form asks whether it's
 * another one of those. Only a yes links them, so a lookalike that's really
 * a different prop is never treated as a twin.
 *
 * It sits inside the add-item form and listens there: to a photo being
 * chosen (PhotoField), to the name being filled in from it (PhotoAutofill)
 * and to the name being typed.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { PHOTO_PICKED } from "@/components/photo-field";
import { PHOTO_AUTOFILLED } from "@/components/photo-autofill";
import { sameNamedItems } from "@/app/(app)/items/new/actions";
import { embedImage } from "@/lib/embedding";
import { deviceMayFingerprint } from "@/lib/fingerprint-device";
import { matchEmbedding } from "@/lib/fingerprints";
import { STRONG_SIMILARITY } from "@/lib/visual-match";

type Offer = { id: string; name: string; locationName: string | null; why: "photo" | "name" };

/** More than this and it stops being a question and becomes a list. */
const MAX_OFFERS = 3;
/** Typing pauses this long before the name is looked up. */
const NAME_PAUSE_MS = 450;

export function TwinOffer() {
  const anchor = useRef<HTMLDivElement>(null);
  const [byPhoto, setByPhoto] = useState<Offer[]>([]);
  const [byName, setByName] = useState<Offer[]>([]);
  const [twin, setTwin] = useState<Offer | null>(null);
  const [declined, setDeclined] = useState<string>("");
  const photoRequest = useRef(0);
  const nameRequest = useRef(0);

  // Photo first, then name; one entry per item.
  const offers: Offer[] = [];
  for (const offer of [...byPhoto, ...byName]) {
    if (!offers.some((known) => known.id === offer.id)) offers.push(offer);
  }
  const shown = offers.slice(0, MAX_OFFERS);
  // "No" holds until what's on offer changes.
  const signature = shown.map((offer) => offer.id).join(",");

  useLayoutEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    let pause: ReturnType<typeof setTimeout> | undefined;

    async function lookUpName() {
      const field = form?.elements.namedItem("name") as HTMLInputElement | null;
      const name = field?.value.trim() ?? "";
      const request = ++nameRequest.current;
      if (name.length < 2) {
        setByName([]);
        return;
      }
      let found: Awaited<ReturnType<typeof sameNamedItems>> = [];
      try {
        found = await sameNamedItems(name);
      } catch {
        found = [];
      }
      if (request !== nameRequest.current) return;
      setByName(found.map((item) => ({ ...item, why: "name" as const })));
    }

    async function lookUpPhoto(file: File) {
      const request = ++photoRequest.current;
      setByPhoto([]);
      // Only where the model is already here: a question about twins is no
      // reason to start a 40MB download.
      if (!(await deviceMayFingerprint())) return;
      try {
        const matches = await matchEmbedding(await embedImage(file), MAX_OFFERS + 2);
        if (request !== photoRequest.current) return;
        setByPhoto(
          matches
            .filter((match) => match.similarity >= STRONG_SIMILARITY)
            .map((match) => ({
              id: match.id,
              name: match.name,
              locationName: match.locationName,
              why: "photo" as const,
            }))
        );
      } catch {
        // Not being able to compare costs nothing the person asked for.
      }
    }

    const onPicked = (event: Event) => void lookUpPhoto((event as CustomEvent<File>).detail);
    const onFilled = () => void lookUpName();
    const onInput = (event: Event) => {
      if ((event.target as HTMLInputElement).name !== "name") return;
      clearTimeout(pause);
      pause = setTimeout(() => void lookUpName(), NAME_PAUSE_MS);
    };
    form.addEventListener(PHOTO_PICKED, onPicked);
    form.addEventListener(PHOTO_AUTOFILLED, onFilled);
    form.addEventListener("input", onInput);
    return () => {
      clearTimeout(pause);
      form.removeEventListener(PHOTO_PICKED, onPicked);
      form.removeEventListener(PHOTO_AUTOFILLED, onFilled);
      form.removeEventListener("input", onInput);
    };
  }, []);

  // A chosen twin that's no longer on offer (the name was changed to
  // something else) isn't silently kept.
  const chosen = twin && offers.some((offer) => offer.id === twin.id) ? twin : null;

  return (
    <div ref={anchor} data-twin-offer>
      {chosen ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-accent-soft bg-surface px-4 py-3"
        >
          <input type="hidden" name="twinOf" value={chosen.id} />
          <span aria-hidden="true" className="hex w-3 bg-honey" />
          <span className="min-w-0 flex-1 font-body text-sm text-foreground">
            Will be linked as a twin of <span className="font-medium">{chosen.name}</span>
          </span>
          <button
            type="button"
            onClick={() => setTwin(null)}
            className="inline-flex min-h-11 items-center font-body text-sm text-accent-ink hover:underline md:min-h-0"
          >
            Undo
          </button>
        </div>
      ) : shown.length && declined !== signature ? (
        <div className="rounded-lg border border-rule bg-surface px-4 py-3">
          <p className="font-body text-sm font-semibold text-foreground">
            You already have {shown.length === 1 ? "one of these" : "something like this"}. Is this
            another one?
          </p>
          <p className="mt-1 font-body text-xs text-muted">
            Twins are props you own more than one of, all looking the same. A photo of one finds
            them all.
          </p>
          <ul className="mt-3 space-y-2">
            {shown.map((offer) => (
              <li
                key={offer.id}
                data-twin-offer-item
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rule bg-background px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block font-body text-sm text-foreground">{offer.name}</span>
                  <span className="block font-mono text-[11px] text-muted">
                    {offer.locationName ?? "No place"} ·{" "}
                    {offer.why === "photo" ? "its photo looks just like this one" : "same name"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setTwin(offer)}
                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-3 font-body text-sm font-medium text-background hover:opacity-90 md:min-h-9"
                >
                  Yes, another one
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setDeclined(signature)}
            className="mt-2 inline-flex min-h-11 items-center font-body text-sm text-muted hover:text-foreground md:min-h-0"
          >
            No, it’s a different prop
          </button>
        </div>
      ) : null}
    </div>
  );
}
