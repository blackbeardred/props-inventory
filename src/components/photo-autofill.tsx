"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { suggestFromPhoto } from "@/app/(app)/items/new/actions";
import { PHOTO_PICKED } from "@/components/photo-field";

/** Raised (bubbling) on the form whenever this changes the fields, so other
 *  parts of the form can react to the new name as they would to typing. */
export const PHOTO_AUTOFILLED = "photo-autofilled";

function announce(form: HTMLFormElement) {
  form.dispatchEvent(new CustomEvent(PHOTO_AUTOFILLED, { bubbles: true }));
}

/**
 * Fills in a new item from its photo: drop this inside the add-item form,
 * after its PhotoField. The moment a photo is chosen (or handed over by the
 * thumb hexagon), it's read (src/lib/ai/describe-item.ts) and the answers go
 * into the form — a picture of a white cup gives "White cup", Prop, a line
 * of description, and hidden search tags saved with the item.
 *
 * Only empty fields are filled, so nothing anyone has typed is overwritten;
 * a field it filled itself can be refilled by a second photo, until it's
 * edited. Every filled field is marked until it's touched, and Undo puts
 * them all back. If the photo can't be read (or reading isn't set up), the
 * form just stays as it was.
 */

type Field = "name" | "category" | "description" | "condition";
const LABELS: Record<Field, string> = {
  name: "name",
  category: "category",
  description: "description",
  condition: "condition",
};

type Status =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "filled"; fields: Field[] }
  | { kind: "tagsOnly" }
  | { kind: "undone" }
  | { kind: "failed" };

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** The longest side the reader needs: it can't see more than about this. */
const READ_SIZE = 1024;

/**
 * A smaller copy of the photo for reading, so a phone on mobile data isn't
 * uploading a 5MB picture twice (once to read, once to save). Only shrinks;
 * anything already small, or that the browser can't decode, goes as it is.
 * The full photo is still the one saved with the item.
 */
async function forReading(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = READ_SIZE / Math.max(bitmap.width, bitmap.height);
    if (scale >= 1) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.85));
    return blob ? new File([blob], "photo.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

type Suggestion = Extract<Awaited<ReturnType<typeof suggestFromPhoto>>, { ok: true }>["suggestion"];

/**
 * Puts a reading into the form's empty fields (and any it filled itself
 * earlier, which a newer photo may replace). Returns the ones it changed.
 */
function fill(
  form: HTMLFormElement,
  suggestion: Suggestion,
  ours: Map<Field, string>,
  before: Map<Field, string>
): Field[] {
  const control = (field: Field) => form.elements.namedItem(field) as Control | null;
  const name = control("name");
  // The category select always has a value, so "empty" means it's still
  // on the default and the name is being filled in too.
  const fillingName = !!name && (name.value.trim() === "" || ours.get("name") === name.value);
  const values: Record<Field, string> = {
    name: suggestion.name,
    category: suggestion.category,
    description: suggestion.description,
    condition: suggestion.condition ?? "",
  };

  const filled: Field[] = [];
  for (const field of ["name", "category", "description", "condition"] as Field[]) {
    const element = control(field);
    const value = values[field];
    if (!element || !value) continue;
    const current = element.value;
    const mine = ours.get(field) === current;
    const empty = field === "category" ? fillingName && (current === "prop" || mine) : current.trim() === "" || mine;
    if (!empty) continue;
    if (!before.has(field)) before.set(field, current);
    element.value = value;
    element.dataset.autofilled = "";
    ours.set(field, value);
    // Mentioned only when it changed: the category usually already says Prop.
    if (value !== current) filled.push(field);
  }
  return filled;
}

function listOf(fields: Field[]): string {
  const words = fields.map((field) => LABELS[field]);
  return words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export function PhotoAutofill() {
  const anchor = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [tags, setTags] = useState<string[]>([]);
  // What this filled each field with, and what was there before (for Undo).
  const ours = useRef(new Map<Field, string>());
  const before = useRef(new Map<Field, string>());
  const latest = useRef(0);
  // The last reading, so Undo can be undone without choosing the photo again
  // (a browser doesn't report the same file being picked twice).
  const last = useRef<Suggestion | null>(null);

  // A layout effect, so the listener is in place before PhotoField's own
  // effect hands over a photo from the hexagon menu.
  useLayoutEffect(() => {
    const found = anchor.current?.closest("form");
    if (!found) return;
    const form: HTMLFormElement = found;

    // Editing a filled field makes it the person's own: no more marking,
    // and a later photo leaves it alone.
    const onInput = (event: Event) => {
      const target = event.target as Control;
      const field = target.name as Field;
      if (target.dataset.autofilled !== undefined && event.isTrusted) {
        delete target.dataset.autofilled;
        ours.current.delete(field);
      }
    };

    async function read(file: File) {
      const request = ++latest.current;
      setStatus({ kind: "reading" });
      let result: Awaited<ReturnType<typeof suggestFromPhoto>>;
      try {
        const data = new FormData();
        data.set("photo", await forReading(file));
        result = await suggestFromPhoto(data);
      } catch {
        result = { ok: false, reason: "failed" };
      }
      // A newer photo has been chosen since: its answer is the one that counts.
      if (request !== latest.current) return;

      if (!result.ok) {
        setTags([]);
        setStatus(result.reason === "failed" ? { kind: "failed" } : { kind: "idle" });
        return;
      }

      const { suggestion } = result;
      last.current = suggestion;
      const filled = fill(form, suggestion, ours.current, before.current);
      announce(form);
      setTags(suggestion.tags);
      setStatus(filled.length ? { kind: "filled", fields: filled } : { kind: "tagsOnly" });
    }

    const onPicked = (event: Event) => void read((event as CustomEvent<File>).detail);
    form.addEventListener(PHOTO_PICKED, onPicked);
    form.addEventListener("input", onInput);
    form.addEventListener("change", onInput);
    return () => {
      form.removeEventListener(PHOTO_PICKED, onPicked);
      form.removeEventListener("input", onInput);
      form.removeEventListener("change", onInput);
    };
  }, []);

  function undo() {
    const form = anchor.current?.closest("form");
    if (!form) return;
    for (const [field, value] of before.current) {
      const element = form.elements.namedItem(field) as Control | null;
      if (!element || element.dataset.autofilled === undefined) continue;
      element.value = value;
      delete element.dataset.autofilled;
    }
    ours.current.clear();
    before.current.clear();
    announce(form);
    setTags([]);
    setStatus(last.current ? { kind: "undone" } : { kind: "idle" });
  }

  function refill() {
    const form = anchor.current?.closest("form");
    if (!form || !last.current) return;
    const filled = fill(form, last.current, ours.current, before.current);
    announce(form);
    setTags(last.current.tags);
    setStatus(filled.length ? { kind: "filled", fields: filled } : { kind: "tagsOnly" });
  }

  return (
    <div ref={anchor} data-photo-autofill>
      <input type="hidden" name="photoTags" value={JSON.stringify(tags)} />
      <p role="status" aria-live="polite" className="font-body text-sm text-muted empty:hidden">
        {status.kind === "reading" ? (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="hex w-3 animate-pulse bg-honey" />
            Reading the photo…
          </span>
        ) : status.kind === "filled" ? (
          <span className="inline-flex flex-wrap items-center gap-x-2">
            <span>
              Filled in the {listOf(status.fields)} from the photo. Check {status.fields.length === 1 ? "it" : "them"}{" "}
              before you save.
            </span>
            <button
              type="button"
              onClick={undo}
              className="inline-flex min-h-11 items-center font-medium text-accent-ink underline-offset-2 hover:underline md:min-h-0"
            >
              Undo
            </button>
          </span>
        ) : status.kind === "tagsOnly" ? (
          "Read the photo. Its search tags will be saved with the item."
        ) : status.kind === "undone" ? (
          <button
            type="button"
            onClick={refill}
            className="inline-flex min-h-11 items-center font-medium text-accent-ink underline-offset-2 hover:underline md:min-h-0"
          >
            Fill in from the photo again
          </button>
        ) : status.kind === "failed" ? (
          "Couldn’t read the photo, so fill in the details yourself."
        ) : null}
      </p>
    </div>
  );
}
