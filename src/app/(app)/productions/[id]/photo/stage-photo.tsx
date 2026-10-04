"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadImportedPhotos, type PhotoUpload } from "@/lib/photo-upload";
import { embedImage, loadEmbedder, type LoadProgress } from "@/lib/embedding";
import { deviceMayFingerprint, markFingerprintsDue, optIn } from "@/lib/fingerprint-device";
import { isMissingFingerprintSchema, matchEmbedding } from "@/lib/fingerprints";
import { mergeCandidates, pickObvious } from "@/lib/visual-match";
import { takeHandedOffPhoto } from "@/lib/photo-handoff";
import type { Category } from "@/lib/inventory";
import {
  applyStagePhoto,
  readStagePhoto,
  type Candidate,
  type Detection,
} from "./actions";
import { DetectionRow, type Choice, type RankedCandidate } from "./detection-row";

/** How many of the closest photos to ask for, per thing in the picture. */
const PICTURE_MATCHES = 5;

type PictureHit = Candidate & { similarity: number };

/**
 * Where comparing by picture has got to. It runs after the review screen is
 * already up, because the name matches are useful on their own and nobody
 * should wait on a model to see them.
 */
type PicturePass =
  | { kind: "idle" }
  | { kind: "offer" }
  | { kind: "loading"; progress: LoadProgress | null }
  | { kind: "matching"; done: number; total: number }
  | { kind: "done" }
  | { kind: "nothing-to-compare" }
  | { kind: "not-set-up" }
  | { kind: "failed" };

function choiceFor(name: string, candidates: RankedCandidate[]): Choice {
  const obvious = pickObvious(name, candidates);
  return obvious ? { kind: "item", itemId: obvious.id } : { kind: "skip" };
}

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

function dataUrlToBlob(dataUrl: string): Blob {
  return new Blob([dataUrlToBytes(dataUrl) as BlobPart], { type: "image/jpeg" });
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
  const [pictureHits, setPictureHits] = useState<Record<string, PictureHit[]>>({});
  const [picturePass, setPicturePass] = useState<PicturePass>({ kind: "idle" });
  // Rows the reviewer has decided about. Picture matches arriving afterwards
  // may re-rank the dropdown but must never change a choice someone made.
  const touched = useRef(new Set<string>());
  const listedRef = useRef<string[]>([]);
  // Bumped per photo, so a slow picture pass for the last photo can't write
  // its results into the review of this one.
  const passId = useRef(0);

  function candidatesFor(detection: Detection): RankedCandidate[] {
    return mergeCandidates(detection.candidates, pictureHits[detection.key] ?? []);
  }

  /**
   * Compares each crop against the photos of everything the theatre owns.
   * One at a time: this is the CPU doing arithmetic, and two at once on a
   * phone makes each slower and the screen sticky.
   */
  async function comparePictures(
    rows: Detection[],
    cropsByKey: Record<string, string>,
    listedItemIds: string[]
  ) {
    const id = ++passId.current;
    const stale = () => passId.current !== id;
    const listed = new Set(listedItemIds);
    const withCrops = rows.filter((row) => cropsByKey[row.key]);
    if (withCrops.length === 0) {
      setPicturePass({ kind: "idle" });
      return;
    }

    try {
      setPicturePass({ kind: "loading", progress: null });
      await loadEmbedder((progress) => {
        if (!stale()) setPicturePass({ kind: "loading", progress });
      });

      let anyFingerprints = false;
      for (const [index, row] of withCrops.entries()) {
        if (stale()) return;
        setPicturePass({ kind: "matching", done: index, total: withCrops.length });

        const embedding = await embedImage(dataUrlToBlob(cropsByKey[row.key]));
        const lookalikes = await matchEmbedding(embedding, PICTURE_MATCHES);
        if (stale()) return;
        if (lookalikes.length > 0) anyFingerprints = true;

        const hits: PictureHit[] = lookalikes.map((match) => ({
          id: match.id,
          name: match.name,
          category: match.category as Category,
          locationName: match.locationName,
          quantity: match.quantity,
          alreadyListed: listed.has(match.id),
          photoUrl: match.photoUrl,
          similarity: match.similarity,
        }));

        setPictureHits((current) => ({ ...current, [row.key]: hits }));
        if (!touched.current.has(row.key)) {
          setChoices((current) => ({
            ...current,
            [row.key]: choiceFor(row.name, mergeCandidates(row.candidates, hits)),
          }));
        }
      }

      setPicturePass(anyFingerprints ? { kind: "done" } : { kind: "nothing-to-compare" });
    } catch (problem) {
      if (stale()) return;
      setPicturePass(
        isMissingFingerprintSchema(problem) ? { kind: "not-set-up" } : { kind: "failed" }
      );
    }
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPhase("reading");
    setDetections([]);
    passId.current += 1;
    setPicturePass({ kind: "idle" });

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
        // scrolling twenty rows trusts what's already filled in. So only a
        // name that plainly says the same thing starts ticked — being the
        // only search result isn't evidence of anything. Once the pictures
        // have been compared they can choose between several such names, or
        // veto one, but never tick something on their own (visual-match.ts).
        nextChoices[detection.key] = choiceFor(
          detection.name,
          mergeCandidates(detection.candidates, [])
        );
      }

      setDetections(outcome.detections);
      setRemoved([]);
      setCrops(nextCrops);
      setChoices(nextChoices);
      setCounts(nextCounts);
      setNames(nextNames);
      setPictureHits({});
      touched.current = new Set();
      listedRef.current = outcome.listedItemIds;
      setPhase("reviewing");

      // On a device that already recognises photos, compare straight away.
      // Anywhere else, offer — it means a download, and that's theirs to
      // agree to.
      if (await deviceMayFingerprint()) {
        void comparePictures(outcome.detections, nextCrops, outcome.listedItemIds);
      } else {
        passId.current += 1;
        setPicturePass(
          Object.keys(nextCrops).length > 0 ? { kind: "offer" } : { kind: "idle" }
        );
      }
    } catch {
      setError("Couldn’t read that photo on this device. Try a different one.");
      setPhase("idle");
    }
  }

  // A photo taken from the hexagon menu ("Take picture → Add as a prop
  // table") is read as soon as the page opens, as if it had been chosen here.
  useEffect(() => {
    const file = takeHandedOffPhoto();
    // Starting the read from an effect is the point: the photo exists only in
    // this browser, after the server render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (file) void onPhoto(file);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // The production page this goes to fingerprints them, or asks to.
      markFingerprintsDue();
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
        {/* The whole point of the page, so it looks like it: one big
            button rather than a browser's "Choose File / No file chosen",
            which on a phone was a 34px strip of grey. The real input sits
            inside the label, so a tap anywhere on it opens the camera or the
            library, and keyboards still reach it. */}
        <label
          className={`mt-4 flex min-h-14 w-full cursor-pointer items-center justify-center gap-3 rounded-lg px-5 py-3 font-body text-base font-medium transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
            phase === "reading"
              ? "cursor-wait bg-accent/70 text-background"
              : detections.length > 0
                ? "border border-rule bg-surface text-foreground hover:bg-background"
                : "bg-accent text-background hover:opacity-90"
          }`}
        >
          <span aria-hidden="true" className="hex w-4 bg-honey" />
          {phase === "reading"
            ? "Reading the photo…"
            : detections.length > 0
              ? "Use a different photo"
              : "Take or choose a photo"}
          <input
            type="file"
            accept="image/*"
            disabled={phase === "reading" || phase === "saving"}
            onChange={(event) => {
              void onPhoto(event.target.files?.[0]);
              // So choosing the same file again still counts as a change.
              event.target.value = "";
            }}
            className="sr-only"
          />
        </label>

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
              Pick which of your items each one is; anything left as “Skip” is
              ignored. On a phone, swipe a row left to clear out what it got
              wrong, or right to add it to your inventory as something new.
            </p>

            <PicturePassNotice
              pass={picturePass}
              onCompare={() => {
                optIn();
                void comparePictures(detections, crops, listedRef.current);
              }}
            />

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
                  candidates={candidatesFor(detection)}
                  onAddToInventory={() => {
                    touched.current.add(detection.key);
                    setChoices((current) => ({
                      ...current,
                      [detection.key]: { kind: "new" },
                    }));
                  }}
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
                  onChoice={(choice) => {
                    touched.current.add(detection.key);
                    setChoices((current) => ({ ...current, [detection.key]: choice }));
                  }}
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
              className="inline-flex min-h-11 items-center justify-center rounded-md md:min-h-0 bg-accent px-4 py-2 font-body text-sm font-medium text-background transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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

/** One line under the heading saying what comparing by picture is doing. */
function PicturePassNotice({
  pass,
  onCompare,
}: {
  pass: PicturePass;
  onCompare: () => void;
}) {
  if (pass.kind === "idle") return null;

  if (pass.kind === "offer") {
    return (
      <div className="mt-3 rounded-lg border border-rule bg-surface px-3 py-3">
        <p className="font-body text-sm text-foreground">
          These were matched by name. Comparing each one with the photos of your items finds the
          ones the name missed, and tells look-alikes apart.
        </p>
        <p className="mt-1 font-body text-xs text-muted">
          Needs the recognition model on this device: a one-time download, best done on Wi-Fi.
        </p>
        <button
          type="button"
          onClick={onCompare}
          className="mt-2 inline-flex min-h-11 items-center justify-center rounded-md border border-accent px-4 py-2 font-body text-sm font-medium text-accent transition-colors hover:bg-accent/10"
        >
          Compare by picture
        </button>
      </div>
    );
  }

  if (pass.kind === "loading") {
    const percent = pass.progress?.percent;
    return (
      <div className="mt-3" aria-live="polite">
        <p className="font-body text-sm text-muted">
          {percent !== null && percent !== undefined
            ? `Downloading the recognition model… ${percent}%`
            : "Getting the recognition model ready…"}
        </p>
        {percent !== null && percent !== undefined ? (
          <div className="mt-1 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-rule">
            <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
        ) : null}
      </div>
    );
  }

  const text =
    pass.kind === "matching"
      ? `Comparing pictures… ${pass.done + 1} of ${pass.total}`
      : pass.kind === "done"
        ? "Matched by picture as well as by name."
        : pass.kind === "nothing-to-compare"
          ? "None of your items has a fingerprinted photo yet, so these are matched by name only."
          : pass.kind === "not-set-up"
            ? "Matching by picture isn’t set up on this inventory yet, so these are matched by name only."
            : "Couldn’t compare pictures this time, so these are matched by name only.";

  return (
    <p aria-live="polite" className="mt-3 font-mono text-xs text-muted">
      {text}
    </p>
  );
}
