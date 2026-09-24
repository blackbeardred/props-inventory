"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The crop window is square because every place a photo is shown — the items
// list thumbnail, the edit page, the member avatars — is square. Cropping to
// the shape it will actually be displayed in is the whole point.
const VIEWPORT = 288;
const OUTPUT = 1200;
const MAX_ZOOM = 4;

type Natural = { w: number; h: number };

/**
 * A photo input that shows the picture the moment it's chosen, and can crop
 * it before upload. The cropped result is written back into the same file
 * input via DataTransfer, so the server action still just reads a File and
 * needs no knowledge that any of this happened.
 */
export function PhotoField({
  label,
  name,
  accept,
  helpText,
  existingUrl,
}: {
  label: string;
  name: string;
  accept?: string;
  helpText?: string;
  /** Signed URL of the photo already saved on this item, if any. */
  existingUrl?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<Natural | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [cropping, setCropping] = useState(false);
  const [cropped, setCropped] = useState(false);
  const [canCrop, setCanCrop] = useState(true);

  // Object URLs are a resource, not a string: let go of each one before
  // replacing it, and on unmount.
  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      if (sourceUrl?.startsWith("blob:")) URL.revokeObjectURL(sourceUrl);
    };
  }, [previewUrl, sourceUrl]);

  useEffect(() => {
    // Cropping rewrites the input's FileList, which needs DataTransfer. If a
    // browser won't allow that, the field still works — it just uploads the
    // photo as taken, rather than pretending to crop and silently not.
    try {
      setCanCrop(typeof DataTransfer !== "undefined" && !!new DataTransfer());
    } catch {
      setCanCrop(false);
    }
  }, []);

  const baseScale = natural ? VIEWPORT / Math.min(natural.w, natural.h) : 1;
  const scale = baseScale * zoom;
  const displayW = natural ? natural.w * scale : 0;
  const displayH = natural ? natural.h * scale : 0;

  const clamp = useCallback(
    (x: number, y: number) => ({
      x: Math.min(0, Math.max(VIEWPORT - displayW, x)),
      y: Math.min(0, Math.max(VIEWPORT - displayH, y)),
    }),
    [displayW, displayH]
  );

  useEffect(() => {
    // Keep the image covering the window whenever the zoom changes.
    setOffset((current) => clamp(current.x, current.y));
  }, [clamp]);

  function onFile(file: File | undefined) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setSourceUrl(url);
    setPreviewUrl(url);
    setCropped(false);
    setZoom(1);
    setNatural(null);
    setCropping(false);
  }

  function onImageLoad() {
    const img = imageRef.current;
    if (!img) return;
    const size = { w: img.naturalWidth, h: img.naturalHeight };
    setNatural(size);
    const base = VIEWPORT / Math.min(size.w, size.h);
    // Start centred, which for most photos is the framing someone intended.
    setOffset({
      x: (VIEWPORT - size.w * base) / 2,
      y: (VIEWPORT - size.h * base) / 2,
    });
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const start = dragRef.current;
    if (!start) return;
    setOffset(
      clamp(start.ox + (event.clientX - start.x), start.oy + (event.clientY - start.y))
    );
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }

  function applyCrop() {
    const img = imageRef.current;
    const input = inputRef.current;
    if (!img || !input || !natural) return;

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const context = canvas.getContext("2d");
    if (!context) return;

    // Map the crop window back onto the source image's own pixels.
    const sourceSize = VIEWPORT / scale;
    context.drawImage(
      img,
      -offset.x / scale,
      -offset.y / scale,
      sourceSize,
      sourceSize,
      0,
      0,
      OUTPUT,
      OUTPUT
    );

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const original = input.files?.[0];
        const baseName = (original?.name ?? "photo").replace(/\.[^.]+$/, "");
        const file = new File([blob], `${baseName}-cropped.jpg`, {
          type: "image/jpeg",
        });
        try {
          const transfer = new DataTransfer();
          transfer.items.add(file);
          input.files = transfer.files;
        } catch {
          setCanCrop(false);
          return;
        }
        if (previewUrl?.startsWith("blob:") && previewUrl !== sourceUrl) {
          URL.revokeObjectURL(previewUrl);
        }
        setPreviewUrl(URL.createObjectURL(blob));
        setCropped(true);
        setCropping(false);
      },
      "image/jpeg",
      0.9
    );
  }

  const shown = previewUrl ?? existingUrl ?? null;

  return (
    <div>
      <span className="mb-1.5 block font-body text-sm text-muted">{label}</span>

      {cropping && sourceUrl ? (
        <div className="rounded-lg border border-rule bg-surface p-4">
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{ width: VIEWPORT, height: VIEWPORT }}
            className="relative max-w-full cursor-grab touch-none overflow-hidden rounded-md bg-background active:cursor-grabbing"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL, never optimised */}
            <img
              ref={imageRef}
              src={sourceUrl}
              alt=""
              onLoad={onImageLoad}
              draggable={false}
              style={{
                position: "absolute",
                left: offset.x,
                top: offset.y,
                width: displayW || undefined,
                height: displayH || undefined,
                maxWidth: "none",
              }}
            />
          </div>

          <label className="mt-3 block">
            <span className="block font-body text-xs text-muted">Zoom</span>
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="mt-1 w-full max-w-[288px] accent-accent"
            />
          </label>

          <p className="mt-1 font-body text-xs text-muted">
            Drag the photo to choose what’s in frame.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={applyCrop}
              className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 font-body text-sm font-medium text-background transition-colors hover:opacity-90"
            >
              Use this crop
            </button>
            <button
              type="button"
              onClick={() => setCropping(false)}
              className="inline-flex items-center justify-center rounded-md border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* Always mounted, only hidden: applyCrop writes the cropped file back
          into this input, which means it has to still exist while the cropper
          is open. Unmounting it here left the crop button doing nothing. */}
      <div className={cropping ? "hidden" : "flex flex-wrap items-start gap-4"}>
          {/* The picture itself opens the file picker — the placeholder is the
              biggest, most obvious target on the field, and it would be odd
              for the one thing that looks like a photo slot to do nothing. */}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            aria-label={shown ? "Choose a different photo" : "Choose a photo"}
            className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {shown ? (
              // eslint-disable-next-line @next/next/no-img-element -- blob or signed URL
              <img
                src={shown}
                alt=""
                className="h-36 w-36 rounded-lg border border-rule object-cover transition-opacity hover:opacity-90"
              />
            ) : (
              <span className="flex h-36 w-36 items-center justify-center rounded-lg border border-dashed border-rule transition-colors hover:border-accent/50 hover:bg-accent-soft/10">
                <span className="px-3 text-center font-body text-xs text-muted">
                  No photo yet
                  <span className="mt-1 block text-accent">Choose a file</span>
                </span>
              </span>
            )}
          </button>

          <div className="min-w-[12rem] flex-1">
            <input
              ref={inputRef}
              type="file"
              name={name}
              accept={accept}
              onChange={(event) => onFile(event.target.files?.[0])}
              className="block w-full font-body text-sm text-muted file:mr-3 file:rounded-md file:border file:border-rule file:bg-surface file:px-3 file:py-1.5 file:font-body file:text-sm file:text-foreground hover:file:bg-rule/40"
            />

            {sourceUrl && canCrop ? (
              <button
                type="button"
                onClick={() => setCropping(true)}
                className="mt-3 inline-flex items-center justify-center rounded-md border border-rule px-3 py-1.5 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface"
              >
                {cropped ? "Crop again" : "Crop photo"}
              </button>
            ) : null}

            {cropped ? (
              <p className="mt-2 font-body text-xs text-success-ink">
                Cropped — this is what will be saved.
              </p>
            ) : null}

            {helpText ? (
              <p className="mt-2 font-body text-xs text-muted">{helpText}</p>
            ) : null}
          </div>
      </div>
    </div>
  );
}
