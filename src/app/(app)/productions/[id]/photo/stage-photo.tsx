"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { uploadImportedPhotos, type PhotoUpload } from "@/lib/photo-upload";
import { looksLikeSameThing } from "@/lib/name-match";
import {
  applyStagePhoto,
  readStagePhoto,
  type Detection,
} from "./actions";
import { DetectionRow, type Choice } from "./detection-row";

// A phone photo is 3-4MB and several thousand pixels wide. Claude works from
// about 1568px anyway, and a server action's body is not the place for the
// original, so it's shrunk here before it ever leaves the phone.
const SEND_DIMENSION = 1400;
const SEND_QUALITY = 0.78;

/** Crops shown beside each row, and kept as the photo for anything new. */
const CROP_DIMENSION = 320;
const CROP_QUALITY = 0.82;

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("couldn’t load that photo"));
    image.src = source;
  });
}

async function downscale(file: File): Promise<{ dataUrl: string; image: HTMLImageElement }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const scale = Math.min(1, SEND_DIMENSION / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", SEND_QUALITY);
    return { dataUrl, image: await loadImage(dataUrl) };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Cuts the model's rough box out of the photo, with a little margin. */
function cropTo(image: HTMLImageElement, box: Detection["box"]): string | null {
  if (!box) return null;

  const margin = 4;
  const left = Math.max(0, (box.x - margin) / 100) * image.width;
  const top = Math.max(0, (box.y - margin) / 100) * image.height;
  const width = Math.min(100, box.width + margin * 2) / 100 * image.width;
  const height = Math.min(100, box.height + margin * 2) / 100 * image.height;
  if (width < 8 || height < 8) return null;

  const scale = Math.min(1, CROP_DIMENSION / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas
    .getContext("2d")
    ?.drawImage(image, left, top, width, height, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/jpeg", CROP_QUALITY);
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function StagePhoto({ productionId }: { productionId: string }) {
  const router = useRouter();

  const [phase, setPhase] = useState<"idle" | "reading" | "reviewing" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [crops, setCrops] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"pulled" | "pending">("pulled");
  // Dismissed rows are kept aside rather than dropped, so a swipe made by
  // accident — easy, on a phone, in a dark wing — can be taken back.
  const [removed, setRemoved] = useState<Detection[]>([]);

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPhase("reading");
    setDetections([]);

    try {
      const { dataUrl, image } = await downscale(file);
      const outcome = await readStagePhoto(productionId, dataUrl);

      if (!outcome.ok) {
        setError(outcome.error);
        setPhase("idle");
        return;
      }

      const nextCrops: Record<string, string> = {};
      const nextChoices: Record<string, Choice> = {};
      const nextCounts: Record<string, number> = {};
      const nextNames: Record<string, string> = {};

      for (const detection of outcome.detections) {
        const crop = cropTo(image, detection.box);
        if (crop) nextCrops[detection.key] = crop;
        nextCounts[detection.key] = detection.quantity;
        nextNames[detection.key] = detection.name;
        // Pre-selecting a guess is worse than leaving it blank: a reviewer
        // scrolling twenty rows trusts what's already filled in. So only the
        // unambiguous cases start ticked — one possibility, or a name that
        // plainly says the same thing.
        // Being the only result isn't evidence of anything — a vague search
        // that returns one wrong thing would tick it. Only the name deciding
        // it's the same thing counts.
        const obvious = detection.candidates.find((candidate) =>
          looksLikeSameThing(detection.name, candidate.name)
        );

        nextChoices[detection.key] = obvious
          ? { kind: "item", itemId: obvious.id }
          : { kind: "skip" };
      }

      setDetections(outcome.detections);
      setRemoved([]);
      setCrops(nextCrops);
      setChoices(nextChoices);
      setCounts(nextCounts);
      setNames(nextNames);
      setPhase("reviewing");
    } catch {
      setError("Couldn’t read that photo on this device. Try a different one.");
      setPhase("idle");
    }
  }

  const chosen = detections.filter((detection) => choices[detection.key]?.kind !== "skip");

  async function save() {
    setError(null);
    setPhase("saving");

    const decisions = chosen.map((detection) => {
      const choice = choices[detection.key];
      return {
        key: detection.key,
        itemId: choice.kind === "item" ? choice.itemId : null,
        newItem:
          choice.kind === "new"
            ? { name: (names[detection.key] ?? detection.name).trim(), category: "prop" as const }
            : null,
        quantity: counts[detection.key] ?? detection.quantity,
      };
    });

    const outcome = await applyStagePhoto(productionId, JSON.stringify(decisions), status);

    if (!outcome.ok) {
      setError(outcome.error);
      setPhase("reviewing");
      return;
    }

    // Anything created from the photo gets that piece of the photo as its
    // picture — it's the only image of it we have, and it beats a blank.
    const uploads: PhotoUpload[] = [];
    for (const created of outcome.createdItems) {
      const crop = crops[created.key];
      if (crop) {
        uploads.push({
          itemId: created.itemId,
          bytes: dataUrlToBytes(crop),
          contentType: "image/jpeg",
        });
      }
    }
    if (uploads.length > 0) {
      await uploadImportedPhotos(outcome.orgId, uploads, () => {});
    }

    router.push(`/productions/${productionId}?marked=${outcome.marked}`);
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="font-body text-sm text-muted">
          Take a photo of the prop table or a corner of the set, or pick one
          you’ve already got. Everything it recognises is listed for you to
          confirm — nothing is marked until you say so.
        </p>

        {/*
          No `capture` attribute on purpose. With it, a phone goes straight to
          the camera and the photo library is unreachable — which rules out the
          picture someone took during the run, or on a colleague's phone, or
          before they thought to open the app. Without it, the phone offers the
          camera and the roll side by side.
        */}
        <input
          type="file"
          accept="image/*"
          onChange={(event) => onPhoto(event.target.files?.[0])}
          className="mt-3 block w-full font-body text-sm text-muted file:mr-3 file:rounded-md file:border file:border-rule file:bg-surface file:px-3 file:py-1.5 file:font-body file:text-sm file:text-foreground"
        />

        {phase === "reading" ? (
          <p className="mt-3 font-body text-sm text-muted">Looking at the photo…</p>
        ) : null}
        {error ? (
          <p className="mt-3 font-body text-sm text-danger-ink">{error}</p>
        ) : null}
      </section>

      {phase !== "idle" && phase !== "reading" && detections.length > 0 ? (
        <>
          <section>
            <h2 className="font-display text-lg">
              {detections.length} thing{detections.length === 1 ? "" : "s"} in that photo
            </h2>
            <p className="mt-1 font-body text-sm text-muted">
              Pick which of your items each one is. Anything left as “Skip” is
              ignored. Swipe a row away — or tap its × — to clear out what it
              got wrong.
            </p>

            {removed.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-rule bg-surface px-3 py-2">
                <span className="font-body text-sm text-muted">
                  Removed {removed[0].name}
                  {removed.length > 1 ? ` and ${removed.length - 1} more` : ""}.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const [last, ...rest] = removed;
                    setRemoved(rest);
                    // Back where it was, not at the end — the order is the
                    // order of the photo, and shuffling it loses the thread.
                    setDetections((current) =>
                      [...current, last].sort(
                        (a, b) => Number(a.key.split("-")[0]) - Number(b.key.split("-")[0])
                      )
                    );
                  }}
                  className="rounded-md px-2 py-1 font-body text-sm font-medium text-accent hover:underline"
                >
                  Undo
                </button>
              </div>
            ) : null}

            <ul className="mt-4 space-y-3">
              {detections.map((detection) => (
                <DetectionRow
                  key={detection.key}
                  onRemove={() => {
                    setRemoved((current) => [detection, ...current]);
                    setDetections((current) =>
                      current.filter((row) => row.key !== detection.key)
                    );
                  }}
                  detection={detection}
                  crop={crops[detection.key] ?? null}
                  choice={choices[detection.key] ?? { kind: "skip" }}
                  name={names[detection.key] ?? detection.name}
                  count={counts[detection.key] ?? detection.quantity}
                  onChoice={(choice) =>
                    setChoices((current) => ({ ...current, [detection.key]: choice }))
                  }
                  onName={(name) =>
                    setNames((current) => ({ ...current, [detection.key]: name }))
                  }
                  onCount={(count) =>
                    setCounts((current) => ({ ...current, [detection.key]: count }))
                  }
                />
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <fieldset>
              <legend className="font-body text-sm font-medium text-foreground">
                Mark the ticked ones as
              </legend>
              <div className="mt-2 space-y-1">
                <label className="flex items-center gap-2 font-body text-sm text-foreground">
                  <input
                    type="radio"
                    name="status"
                    checked={status === "pulled"}
                    onChange={() => setStatus("pulled")}
                  />
                  In use now — out of storage, on this production
                </label>
                <label className="flex items-center gap-2 font-body text-sm text-foreground">
                  <input
                    type="radio"
                    name="status"
                    checked={status === "pending"}
                    onChange={() => setStatus("pending")}
                  />
                  Still to pull — on the list, not fetched yet
                </label>
              </div>
            </fieldset>

            <button
              type="button"
              onClick={save}
              disabled={chosen.length === 0 || phase === "saving"}
              className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 font-body text-sm font-medium text-background transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {phase === "saving"
                ? "Saving…"
                : chosen.length === 0
                  ? "Nothing ticked yet"
                  : `Mark ${chosen.length} item${chosen.length === 1 ? "" : "s"}`}
            </button>

            <p className="font-body text-xs text-muted">
              Anything added from a photo comes in with that piece of the photo
              as its picture; you can fill in the rest later.
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}
