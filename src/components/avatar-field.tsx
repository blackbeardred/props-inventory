"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * The profile picture field on Your account: choose a picture, frame it in a
 * circle (drag to move, slider or +/− to zoom, arrow keys too), and see it
 * at the sizes the app shows it before saving.
 *
 * The crop is written into the form's real file input as a 512 px square
 * JPEG on every change, through DataTransfer. Pressing Save mid-crop saves
 * what's in the circle, never the uncropped photo, and the server action
 * (updateProfile) still just reads a File. A browser that won't let a script
 * fill a file input uploads the picture as chosen, and says so.
 */

const STAGE = 256; // the crop window, in CSS pixels
const OUTPUT = 512; // the saved square
const MAX_ZOOM = 4;
const PREVIEWS = [
  { size: 96, label: "Your account" },
  { size: 28, label: "Top bar" },
];

type Natural = { w: number; h: number };

export function AvatarField({
  existingUrl,
  name = "avatar",
  removeName = "removeAvatar",
}: {
  /** Signed URL of the picture already saved, if any. */
  existingUrl: string | null;
  name?: string;
  removeName?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const previewRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const fileNameRef = useRef("picture");

  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [croppedUrl, setCroppedUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<Natural | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rawOffset, setOffset] = useState({ x: 0, y: 0 });
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const canFill = useSyncExternalStore(subscribeNever, browserCanFill, () => true);

  useEffect(() => () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);
  useEffect(() => () => {
    if (croppedUrl) URL.revokeObjectURL(croppedUrl);
  }, [croppedUrl]);

  const baseScale = natural ? STAGE / Math.min(natural.w, natural.h) : 1;
  const scale = baseScale * zoom;
  const displayW = natural ? natural.w * scale : 0;
  const displayH = natural ? natural.h * scale : 0;
  const clamp = useCallback(
    (x: number, y: number) => ({
      x: Math.min(0, Math.max(STAGE - displayW, x)),
      y: Math.min(0, Math.max(STAGE - displayH, y)),
    }),
    [displayW, displayH]
  );
  const offset = clamp(rawOffset.x, rawOffset.y);

  /** Draws the circle's contents onto a square canvas of `size` pixels. */
  const draw = useCallback(
    (canvas: HTMLCanvasElement, size: number) => {
      const img = imageRef.current;
      const context = canvas.getContext("2d");
      if (!img || !context || !natural) return false;
      canvas.width = size;
      canvas.height = size;
      context.imageSmoothingQuality = "high";
      const side = STAGE / scale;
      context.drawImage(img, -offset.x / scale, -offset.y / scale, side, side, 0, 0, size, size);
      return true;
    },
    [natural, offset.x, offset.y, scale]
  );

  // Live previews, at device resolution so they're sharp.
  useEffect(() => {
    if (!editing || !natural) return;
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    previewRefs.current.forEach((canvas, i) => {
      if (canvas) draw(canvas, Math.round(PREVIEWS[i].size * ratio));
    });
  }, [editing, natural, draw]);

  // The crop goes into the form's file input shortly after each change.
  useEffect(() => {
    if (!natural || !canFill) return;
    const timer = window.setTimeout(() => {
      const canvas = document.createElement("canvas");
      if (!draw(canvas, OUTPUT)) return;
      canvas.toBlob(
        (blob) => {
          const input = inputRef.current;
          if (!blob || !input) return;
          const file = new File([blob], `${fileNameRef.current}-avatar.jpg`, { type: "image/jpeg" });
          try {
            const transfer = new DataTransfer();
            transfer.items.add(file);
            input.files = transfer.files;
          } catch {
            return;
          }
          setCroppedUrl(URL.createObjectURL(blob));
        },
        "image/jpeg",
        0.9
      );
    }, 120);
    return () => window.clearTimeout(timer);
  }, [natural, canFill, draw]);

  function choose(file: File | undefined) {
    setProblem(null);
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      setProblem("That isn’t a picture. Choose a JPG, PNG or WEBP.");
      return;
    }
    if (!canFill && file.size > 4 * 1024 * 1024) {
      setProblem("That picture is over 4MB. Choose a smaller one.");
      return;
    }
    fileNameRef.current = file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "picture";
    if (!canFill && inputRef.current) {
      // No cropping in this browser: the chosen file itself is uploaded.
      try {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        inputRef.current.files = transfer.files;
      } catch {
        /* the picker below is the form's input in that case */
      }
    }
    setSourceUrl(URL.createObjectURL(file));
    setCroppedUrl(null);
    setNatural(null);
    setZoom(1);
    setRemoving(false);
    setEditing(true);
  }

  function onImageLoad() {
    const img = imageRef.current;
    if (!img) return;
    const size = { w: img.naturalWidth, h: img.naturalHeight };
    if (!size.w || !size.h) {
      setProblem("That picture couldn’t be opened. Try a JPG or PNG.");
      cancel();
      return;
    }
    const base = STAGE / Math.min(size.w, size.h);
    setNatural(size);
    // Centered to start; faces are usually in the middle.
    setOffset({ x: (STAGE - size.w * base) / 2, y: (STAGE - size.h * base) / 2 });
  }

  function cancel() {
    setEditing(false);
    setSourceUrl(null);
    setCroppedUrl(null);
    setNatural(null);
    if (inputRef.current) inputRef.current.value = "";
    if (pickerRef.current) pickerRef.current.value = "";
  }

  /** Zoom about the circle's center, so the face stays put. */
  function zoomTo(next: number) {
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    const centerX = (STAGE / 2 - offset.x) / scale;
    const centerY = (STAGE / 2 - offset.y) / scale;
    const s = baseScale * z;
    setZoom(z);
    setOffset({ x: STAGE / 2 - centerX * s, y: STAGE / 2 - centerY * s });
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const step = event.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[event.key]) {
      event.preventDefault();
      setOffset(clamp(offset.x + moves[event.key][0], offset.y + moves[event.key][1]));
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomTo(zoom + 0.2);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomTo(zoom - 0.2);
    }
  }

  const shown = croppedUrl ?? (removing ? null : existingUrl);
  const smallButton =
    "inline-flex min-h-11 items-center justify-center rounded-md border border-rule bg-background px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface md:min-h-0";

  return (
    <div data-avatar-field>
      <span className="mb-1.5 block font-body text-sm text-muted">Profile picture</span>

      {/* The form's own input: the server reads the cropped square from here.
          It's never shown; choosing goes through the picker below. */}
      <input ref={inputRef} type="file" name={canFill ? name : undefined} accept="image/jpeg" className="sr-only" tabIndex={-1} aria-hidden="true" data-avatar-upload />
      <input
        ref={pickerRef}
        id="avatar-picker"
        type="file"
        name={canFill ? undefined : name}
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => choose(event.target.files?.[0])}
        className="sr-only"
        tabIndex={-1}
      />

      {editing && sourceUrl ? (
        <div className="rounded-lg border border-rule bg-surface p-4" data-avatar-cropper>
          <div className="flex flex-wrap items-start gap-6">
            <div className="space-y-3">
              <div
                role="application"
                aria-label="Crop your picture. Drag or use the arrow keys to move it, and + or − to zoom."
                tabIndex={0}
                onKeyDown={onKeyDown}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
                }}
                onPointerMove={(event) => {
                  const start = dragRef.current;
                  if (start) setOffset(clamp(start.ox + event.clientX - start.x, start.oy + event.clientY - start.y));
                }}
                onPointerUp={(event) => {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                  dragRef.current = null;
                }}
                onPointerCancel={() => (dragRef.current = null)}
                style={{ width: STAGE, height: STAGE }}
                className="relative cursor-grab touch-none overflow-hidden rounded-md bg-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 active:cursor-grabbing"
                data-avatar-stage
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL */}
                <img
                  ref={imageRef}
                  src={sourceUrl}
                  alt=""
                  onLoad={onImageLoad}
                  onError={() => {
                    setProblem("That picture couldn’t be opened. Try a JPG or PNG.");
                    cancel();
                  }}
                  draggable={false}
                  style={{ position: "absolute", left: offset.x, top: offset.y, width: displayW || undefined, height: displayH || undefined, maxWidth: "none" }}
                />
                {/* Darken everything outside the circle. */}
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full border-2 border-background/90 shadow-[0_0_0_9999px_rgba(42,34,25,0.55)]" />
              </div>
              <label className="block w-[256px]">
                <span className="flex items-center justify-between font-body text-xs text-muted">
                  Zoom <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
                </span>
                <input
                  id="avatar-zoom"
                  type="range"
                  min={1}
                  max={MAX_ZOOM}
                  step={0.01}
                  value={zoom}
                  onChange={(event) => zoomTo(Number(event.target.value))}
                  className="mt-1 h-11 w-full accent-accent md:h-auto"
                />
              </label>
              <p className="w-[256px] font-body text-xs text-muted">Drag the picture to frame it in the circle.</p>
            </div>

            <div className="space-y-3" data-avatar-previews>
              <p className="font-body text-sm font-medium text-foreground">Preview</p>
              <div className="flex items-end gap-5">
                {PREVIEWS.map((p, i) => (
                  <figure key={p.label} className="flex flex-col items-center gap-2">
                    <canvas
                      ref={(el) => {
                        previewRefs.current[i] = el;
                      }}
                      style={{ width: p.size, height: p.size }}
                      className="rounded-full bg-background ring-1 ring-rule"
                      aria-label={`Your picture as it appears: ${p.label.toLowerCase()}`}
                      role="img"
                    />
                    <figcaption className="font-body text-xs text-muted">{p.label}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </div>

          {!canFill ? (
            <p className="mt-3 font-body text-xs text-muted">
              This browser can’t crop before uploading, so the picture is saved as chosen and shown in a circle.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => setEditing(false)} className={`${smallButton} border-accent bg-accent text-background hover:bg-accent hover:opacity-90`}>
              Done
            </button>
            <button type="button" onClick={() => pickerRef.current?.click()} className={smallButton}>
              Choose another
            </button>
            <button type="button" onClick={cancel} className={smallButton}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => pickerRef.current?.click()}
            aria-label={shown ? "Choose a different picture" : "Choose a picture"}
            className="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {shown ? (
              // eslint-disable-next-line @next/next/no-img-element -- a blob or signed URL
              <img src={shown} alt="" className="h-20 w-20 rounded-full object-cover ring-1 ring-rule" data-avatar-current />
            ) : (
              <span className="flex h-20 w-20 items-center justify-center rounded-full border border-dashed border-rule font-body text-xs text-muted">Add</span>
            )}
          </button>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => pickerRef.current?.click()} className={smallButton}>
              {shown ? "Replace picture" : "Choose a picture"}
            </button>
            {sourceUrl ? (
              <button type="button" onClick={() => setEditing(true)} className={smallButton}>
                Adjust crop
              </button>
            ) : null}
            {existingUrl && !sourceUrl ? (
              <label
                className={`${smallButton} cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${removing ? "border-danger/50 bg-danger/10 text-danger-ink" : ""}`}
              >
                <input type="checkbox" name={removeName} checked={removing} onChange={(e) => setRemoving(e.target.checked)} className="sr-only" />
                {removing ? "Removed when you save · keep it" : "Remove"}
              </label>
            ) : null}
          </div>
          {croppedUrl ? (
            <p className="w-full font-body text-xs text-success-ink" data-avatar-ready>
              Cropped. Press Save to use it.
            </p>
          ) : null}
        </div>
      )}

      {problem ? (
        <p className="mt-2 font-body text-sm text-danger-ink" role="alert">
          {problem}
        </p>
      ) : (
        <p className="mt-2 font-body text-xs text-muted">JPG, PNG or WEBP. You’ll frame it in a circle before saving.</p>
      )}
    </div>
  );
}

function subscribeNever() {
  return () => {};
}

function browserCanFill(): boolean {
  try {
    return typeof DataTransfer !== "undefined" && !!new DataTransfer();
  } catch {
    return false;
  }
}
