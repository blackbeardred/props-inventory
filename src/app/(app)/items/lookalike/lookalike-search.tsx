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
import { loadEmbedder } from "@/lib/embedding";
import { describeSimilarity, findLookalikes, type Lookalike } from "@/lib/fingerprints";

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

  async function onPick(file: File | undefined) {
    if (!file) return;

    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setPreview(objectUrl.current);
    setMatches(null);
    setError(null);
    setBusy(true);

    try {
      // Loaded explicitly first so the 40MB download reports progress instead
      // of looking like a frozen page.
      await loadEmbedder(setLoad);
      setMatches(await findLookalikes(file, 5));
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Couldn’t read that photo. Try another."
      );
    } finally {
      setBusy(false);
      setLoad(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-foreground/15 px-4 py-3">
        <label className="font-body text-sm font-semibold text-foreground" htmlFor="lookalike-photo">
          Photograph of one thing
        </label>
        <p className="mt-1 font-body text-sm text-foreground/70">
          One object, filling most of the frame. A whole prop table is what the production photo
          screen is for.
        </p>
        <input
          id="lookalike-photo"
          type="file"
          accept="image/*"
          capture="environment"
          disabled={busy}
          onChange={(event) => void onPick(event.target.files?.[0])}
          className="mt-3 block w-full font-body text-sm"
        />
      </div>

      {busy ? (
        <div className="rounded-lg border border-foreground/15 px-4 py-3">
          <p className="font-body text-sm text-foreground">
            {load?.message ?? "Looking through your inventory…"}
          </p>
          {load?.percent !== null && load?.percent !== undefined ? (
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-foreground/10">
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
            <p className="font-body text-xs uppercase tracking-wide text-foreground/60">Your photo</p>
            {/* A blob: URL from this browser, so next/image has nothing to optimise. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="" className="mt-2 w-full rounded-lg object-cover" />
          </div>

          <ul className="space-y-3">
            {matches.map((match) => {
              const verdict = describeSimilarity(match.similarity);
              return (
                <li
                  key={match.id}
                  className="flex items-center gap-4 rounded-lg border border-foreground/15 px-4 py-3"
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
                    <div className="h-16 w-16 rounded bg-foreground/10" />
                  )}

                  <div className="min-w-0 flex-1">
                    <Link href={`/items/${match.id}/edit`} className="font-body font-semibold text-accent hover:underline">
                      {match.name}
                    </Link>
                    <p className="font-body text-sm text-foreground/70">
                      {match.locationName ?? "No shelf assigned"}
                      {match.quantity > 1 ? ` · ${match.quantity} owned` : ""}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="font-body text-sm font-semibold text-foreground">
                      {WORDS[verdict]}
                    </p>
                    <p className="font-body text-xs text-foreground/60">
                      {Math.round(match.similarity * 100)}% alike
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
