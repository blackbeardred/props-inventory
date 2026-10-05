"use client";

/**
 * "Which of our things is this?" — one photo in, the closest items out.
 *
 * This page exists to answer a question before the prop-table scan is wired to
 * use any of it: does matching by sight actually work on this theatre's own
 * photographs? Point it at a prop you know is in the inventory. If it comes
 * back first, matching works. If it doesn't, no amount of interface around it
 * would have helped, and better to find that out on one photo than after
 * rebuilding the review screen.
 *
 * It's worth keeping afterwards regardless: someone holding an unlabelled prop
 * in a storage room wants exactly this.
 */

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { Notice } from "@/components/ui";
import type { LoadProgress } from "@/lib/embedding";
import { embedImage, loadEmbedder } from "@/lib/embedding";
import { optIn } from "@/lib/fingerprint-device";
import { describeSimilarity, matchEmbedding, type Lookalike } from "@/lib/fingerprints";
import { keepReferencePhoto, whoAmI } from "@/lib/reference-photos";

const WORDS: Record<ReturnType<typeof describeSimilarity>, string> = {
  strong: "Almost certainly this",
  likely: "Probably this",
  weak: "Distant — look closely",
};

export function LookalikeSearch() {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [load, setLoad] = useState<LoadProgress | null>(null);
  const [matches, setMatches] = useState<Lookalike[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const objectUrl = useRef<string | null>(null);
  // The photo being searched with and its fingerprint, kept so that "That's
  // it" can keep the photo as another picture of the item it turned out to be.
  const searched = useRef<{ file: File; embedding: number[] } | null>(null);
  // Which result the person said it was, and how keeping it went.
  const [confirmed, setConfirmed] = useState<{
    itemId: string;
    state: "saving" | "saved" | "failed";
  } | null>(null);

  async function onPick(file: File | undefined) {
    if (!file) return;

    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setPreview(objectUrl.current);
    setMatches(null);
    setError(null);
    setConfirmed(null);
    searched.current = null;
    setBusy(true);

    try {
      // Loaded explicitly first so the download reports progress instead of
      // looking like a frozen page. Choosing to search by photo is choosing to
      // hold the model, so this device fingerprints its own new photos from
      // now on as well.
      optIn();
      await loadEmbedder(setLoad);
      const embedding = await embedImage(file);
      searched.current = { file, embedding };
      setMatches(await matchEmbedding(embedding, 5));
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Couldn’t read that photo. Try another."
      );
    } finally {
      setBusy(false);
      setLoad(null);
    }
  }

  /**
   * The person says this is the one. The photo they searched with becomes
   * another picture of that item, so the next photo of it, from whatever
   * angle, has more to match against. Nothing is shown of that beyond the
   * answer being noted: the pictures are the app's, not another thing to
   * manage.
   */
  async function confirm(match: Lookalike) {
    const search = searched.current;
    if (!search || confirmed) return;
    setConfirmed({ itemId: match.id, state: "saving" });
    const who = await whoAmI();
    const outcome = who
      ? await keepReferencePhoto(who, {
          itemId: match.id,
          photo: search.file,
          source: "find_by_photo",
          similarity: match.similarity,
          embedding: search.embedding,
        })
      : ({ kept: false, reason: "failed" } as const);
    // A copy of the item's own photo isn't kept, and doesn't need to be:
    // the answer was still right.
    const ok = outcome.kept || outcome.reason === "same-picture";
    setConfirmed({ itemId: match.id, state: ok ? "saved" : "failed" });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-rule bg-surface px-4 py-3">
        <p className="font-body text-sm font-semibold text-foreground">Photograph of one thing</p>
        <p className="mt-1 font-body text-sm text-muted">
          One object, filling most of the frame — a new photo or one you already have. A whole
          prop table is what the production photo screen is for.
        </p>
        {/* No `capture` attribute. With capture="environment" a phone went
            straight to the camera and the photo library was unreachable —
            so a picture taken earlier, or sent by a colleague, couldn't be
            searched with. Without it the phone offers camera and library
            side by side. The real input sits in the label, as on the
            prop-table screen. */}
        <label
          className={`mt-3 flex min-h-14 w-full cursor-pointer items-center justify-center gap-3 rounded-lg px-5 py-3 font-body text-base font-medium transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
            busy
              ? "cursor-wait bg-accent/70 text-background"
              : preview
                ? "border border-rule bg-background text-foreground hover:bg-surface"
                : "bg-accent text-background hover:opacity-90"
          }`}
        >
          <span aria-hidden="true" className="hex w-4 bg-honey" />
          {busy ? "Looking…" : preview ? "Try a different photo" : "Take or choose a photo"}
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(event) => {
              void onPick(event.target.files?.[0]);
              event.target.value = "";
            }}
            className="sr-only"
          />
        </label>
      </div>

      {busy ? (
        <div className="rounded-lg border border-rule bg-surface px-4 py-3">
          <p className="font-body text-sm text-foreground">
            {load?.message ?? "Looking through your inventory…"}
          </p>
          {load?.percent !== null && load?.percent !== undefined ? (
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-rule">
              <div className="h-full bg-accent" style={{ width: `${load.percent}%` }} />
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <Notice title="That didn’t work">
          <p className="font-body text-sm">{error}</p>
        </Notice>
      ) : null}

      {matches !== null && matches.length === 0 && !busy ? (
        <Notice title="Nothing to compare against">
          <p className="font-body text-sm">
            No item photo has been fingerprinted yet, so there is nothing to match. Run the{" "}
            <Link href="/items/fingerprints" className="text-accent hover:underline">
              photo fingerprints
            </Link>{" "}
            backfill first.
          </p>
        </Notice>
      ) : null}

      {preview && matches && matches.length > 0 ? (
        <div className="grid gap-6 sm:grid-cols-[12rem_1fr]">
          <div>
            <p className="font-body text-xs uppercase tracking-wide text-muted">Your photo</p>
            {/* A blob: URL from this browser, so next/image has nothing to optimise. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="" className="mt-2 w-full rounded-lg object-cover" />
          </div>

          <div>
            <p className="mb-3 font-body text-sm text-muted">
              Found it? Tap <span className="font-medium text-foreground">That’s it</span> on the
              right one, and it’ll be quicker to find from a photo next time.
            </p>
            <ul className="space-y-3">
              {matches.map((match) => {
                const verdict = describeSimilarity(match.similarity);
                return (
                  <li
                    key={match.id}
                    className="flex flex-wrap items-center gap-4 rounded-lg border border-rule bg-surface px-4 py-3"
                  >
                    {match.photoUrl ? (
                      <Image
                        src={match.photoUrl}
                        alt=""
                        width={64}
                        height={64}
                        unoptimized
                        className="h-16 w-16 rounded object-cover"
                      />
                    ) : (
                      <div className="h-16 w-16 rounded bg-rule" />
                    )}

                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/items/${match.id}/edit`}
                        className="inline-flex min-h-11 items-center font-body font-semibold text-accent-ink hover:underline md:min-h-0"
                      >
                        {match.name}
                      </Link>
                      <p className="font-body text-sm text-muted">
                        {match.locationName ?? "No shelf assigned"}
                        {match.quantity > 1 ? ` · ${match.quantity} owned` : ""}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="font-body text-sm font-semibold text-foreground">
                        {WORDS[verdict]}
                      </p>
                      <p className="font-body text-xs text-muted">
                        {Math.round(match.similarity * 100)}% alike
                      </p>
                    </div>

                    <div className="basis-full sm:basis-auto">
                      {confirmed?.itemId === match.id ? (
                        <p
                          role="status"
                          data-confirmed-match
                          className="inline-flex min-h-11 items-center font-body text-sm font-medium text-accent-ink md:min-h-0"
                        >
                          {confirmed.state === "saving"
                            ? "Noting it…"
                            : confirmed.state === "saved"
                              ? "✓ That’s it — thanks"
                              : "✓ That’s it"}
                        </p>
                      ) : (
                        <button
                          type="button"
                          disabled={confirmed !== null}
                          onClick={() => void confirm(match)}
                          className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-rule bg-background px-3 font-body text-sm font-medium text-foreground hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto md:min-h-9"
                        >
                          That’s it
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
