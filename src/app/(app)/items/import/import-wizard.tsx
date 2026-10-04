"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import {
  CSV_TEMPLATE,
  IMPORT_FIELDS,
  IMPORT_FIELD_LABELS,
  extraColumns,
  MAX_IMPORT_ROWS,
  parseItemsTable,
  type ImportField,
  type ParsedFile,
} from "@/lib/csv";
import {
  readSpreadsheetFile,
  SpreadsheetError,
  unreadableSpreadsheetReason,
  type SheetImage,
} from "@/lib/xlsx";
import { uploadImportedPhotos, type PhotoUpload } from "@/lib/photo-upload";
import { markFingerprintsDue } from "@/lib/fingerprint-device";
import { CATEGORY_LABELS, CONDITION_LABELS } from "@/lib/inventory";
import { attachPhotos, importItems } from "./actions";

const PREVIEW_LIMIT = 15;

/** "Item #, Donor and Acquired" — an English list, not a comma soup. */
function listColumns(names: string[]): string {
  const shown = names.slice(0, 6).map((name) => `“${name}”`);
  const rest = names.length - shown.length;
  if (rest > 0) shown.push(`${rest} more`);
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

export function ImportWizard({
  locationNames,
}: {
  locationNames: string[];
}) {
  const router = useRouter();
  const [fileName, setFileName] = useState<string | null>(null);
  const [createLocations, setCreateLocations] = useState(true);
  const [phase, setPhase] = useState<"idle" | "importing" | "photos">("idle");
  const [photoProgress, setPhotoProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [importError, setImportError] = useState<string | null>(null);
  const [table, setTable] = useState<string[][] | null>(null);
  const [images, setImages] = useState<SheetImage[]>([]);
  const [reading, setReading] = useState(false);
  const [mapping, setMapping] = useState<(ImportField | null)[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  // Re-parsing on every mapping change keeps one source of truth: the rows read
  // out of the file. A CSV and a workbook both land here as the same table, so
  // everything past this point is format-blind.
  const parsed: ParsedFile | null = useMemo(() => {
    if (table === null) return null;
    return parseItemsTable(table, mapping ?? undefined);
  }, [table, mapping]);

  const knownLocations = useMemo(
    () => new Set(locationNames.map((name) => name.trim().toLowerCase())),
    [locationNames]
  );

  const valid = parsed?.rows.filter((row) => row.errors.length === 0) ?? [];
  const broken = parsed?.rows.filter((row) => row.errors.length > 0) ?? [];

  const missingLocations = useMemo(() => {
    const missing = new Set<string>();
    for (const row of valid) {
      if (row.locationName && !knownLocations.has(row.locationName.toLowerCase())) {
        missing.add(row.locationName);
      }
    }
    return [...missing];
  }, [valid, knownLocations]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setReadError(null);
    setMapping(null);
    setFileName(file.name);

    // Spreadsheet formats this can't read are worth naming, since the fix is
    // one Save As away and the alternative is a puzzling parse failure.
    const refusal = unreadableSpreadsheetReason(file.name);
    if (refusal) {
      setReadError(refusal);
      setTable(null);
      setImages([]);
      return;
    }

    setReading(true);
    try {
      const workbook = await readSpreadsheetFile(file);
      setTable(workbook.table);
      setImages(workbook.images);
    } catch (error) {
      setReadError(
        error instanceof SpreadsheetError
          ? error.message
          : "Couldn’t read that file. Excel workbooks (.xlsx) and .csv both work."
      );
      setTable(null);
      setImages([]);
    } finally {
      setReading(false);
    }
  }

  const photoCount = valid.filter((row) => row.photoUrl).length;

  // A picture belongs to the row it sits in. Where a row has more than one —
  // a thumbnail and a logo, say — the leftmost wins, which in practice is the
  // photo column rather than something decorative off to the side.
  const imageByLine = useMemo(() => {
    const byLine = new Map<number, SheetImage>();
    for (const image of images) {
      const existing = byLine.get(image.line);
      if (!existing || image.column < existing.column) byLine.set(image.line, image);
    }
    return byLine;
  }, [images]);

  const embeddedCount = valid.filter((row) => imageByLine.has(row.line)).length;

  const kept = parsed ? extraColumns(parsed.headers, parsed.mapping) : [];

  /**
   * Creates the items, then fetches any linked photos in small batches. The
   * photos can't go in the same request — a hundred downloads would exceed
   * any serverless time limit — so the browser drives them, which also gives
   * an honest progress count instead of a page that looks hung.
   */
  async function runImport() {
    setImportError(null);
    setPhase("importing");

    const payload = JSON.stringify(
      valid.map(({ errors: _errors, warnings: _warnings, ...row }) => row)
    );

    const outcome = await importItems(payload, createLocations);

    if (!outcome.ok) {
      setImportError(outcome.error);
      setPhase("idle");
      return;
    }

    let failed = 0;
    let attached = 0;

    // Pictures the workbook carried inside it. The browser already has the
    // bytes, so these go straight to storage rather than back through the
    // server — which is also why a hundred of them is no slower than ten.
    const uploads: PhotoUpload[] = [];
    for (const { line, itemId } of outcome.created) {
      const image = imageByLine.get(line);
      if (image) {
        uploads.push({ itemId, bytes: image.bytes, contentType: image.contentType });
      }
    }

    const totalPhotos = outcome.photoJobs.length + uploads.length;

    if (uploads.length > 0) {
      setPhase("photos");
      setPhotoProgress({ done: 0, total: totalPhotos, failed: 0 });

      const results = await uploadImportedPhotos(
        outcome.orgId,
        uploads,
        (done, failedSoFar) =>
          setPhotoProgress({ done, total: totalPhotos, failed: failedSoFar })
      );
      failed += results.filter((result) => !result.ok).length;
      attached += results.filter((result) => result.ok).length;
    }

    if (outcome.photoJobs.length > 0) {
      setPhase("photos");
      setPhotoProgress({ done: uploads.length, total: totalPhotos, failed });

      const BATCH = 5;
      for (let index = 0; index < outcome.photoJobs.length; index += BATCH) {
        const results = await attachPhotos(
          outcome.photoJobs.slice(index, index + BATCH)
        );
        failed += results.filter((result) => !result.ok).length;
        attached += results.filter((result) => result.ok).length;
        setPhotoProgress({
          done: uploads.length + Math.min(index + BATCH, outcome.photoJobs.length),
          total: totalPhotos,
          failed,
        });
      }
    }

    const params = new URLSearchParams({ imported: String(outcome.imported) });
    if (outcome.skipped > 0) params.set("skipped", String(outcome.skipped));
    if (outcome.locationsCreated > 0) {
      params.set("locations", String(outcome.locationsCreated));
    }
    if (outcome.unmatchedLocations > 0) {
      params.set("unmatched", String(outcome.unmatchedLocations));
    }
    if (attached > 0) {
      params.set("photos", String(attached));
      // Picked up by the items page this goes to: on a device that recognises
      // photos the new ones start straight away, and on one that doesn't
      // it's the moment to ask.
      markFingerprintsDue();
    }
    if (failed > 0) params.set("photosFailed", String(failed));

    router.push(`/items?${params.toString()}`);
  }

  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`;

  return (
    <div className="space-y-8">
      <section>
        <label className="block font-body text-sm font-medium text-foreground">
          Your spreadsheet
        </label>
        <p className="mt-1 font-body text-sm text-muted">
          An Excel workbook (.xlsx) or a .csv — either way, the first sheet’s top
          row should be your column headings. Up to{" "}
          {MAX_IMPORT_ROWS.toLocaleString()} rows at a time.{" "}
          <a href={templateHref} download="items-template.csv" className="text-accent hover:underline">
            Download a template
          </a>{" "}
          if you’d rather start from the right shape.
        </p>
        <input
          type="file"
          accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => onFile(event.target.files?.[0])}
          className="mt-3 block w-full font-body text-sm text-muted file:mr-3 file:rounded-md file:border file:border-rule file:bg-surface file:px-3 file:py-1.5 file:font-body file:text-sm file:text-foreground"
        />
        {reading ? (
          <p className="mt-2 font-body text-sm text-muted">Reading {fileName}…</p>
        ) : null}
        {readError ? (
          <p className="mt-2 font-body text-sm text-danger-ink">{readError}</p>
        ) : null}
      </section>

      {parsed && parsed.headers.length > 0 ? (
        <>
          <section>
            <h2 className="font-display text-lg">Which column is which</h2>
            <p className="mt-1 font-body text-sm text-muted">
              Guessed from your headers. Change anything it got wrong — only{" "}
              <span className="text-foreground">Name</span> is required.
            </p>
            {kept.length > 0 ? (
              <p className="mt-2 font-body text-sm text-muted">
                Nothing is thrown away: {listColumns(kept)}{" "}
                {kept.length === 1 ? "has" : "have"} no field of their own, so
                they’re kept on each item and can be searched for — they just
                don’t appear in the items list.
              </p>
            ) : null}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {parsed.headers.map((header, index) => (
                <label key={`${header}-${index}`} className="block">
                  <span className="block truncate font-body text-xs text-muted">
                    {header || `Column ${index + 1}`}
                  </span>
                  <select
                    value={parsed.mapping[index] ?? ""}
                    onChange={(event) => {
                      const next = [...parsed.mapping];
                      const value = event.target.value;
                      next[index] = value === "" ? null : (value as ImportField);
                      // A field can only come from one column.
                      if (value !== "") {
                        for (let i = 0; i < next.length; i += 1) {
                          if (i !== index && next[i] === value) next[i] = null;
                        }
                      }
                      setMapping(next);
                    }}
                    className="mt-1 w-full rounded-md border border-rule bg-background px-3 py-2 font-body text-sm text-foreground"
                  >
                    <option value="">No field — keep for search</option>
                    {IMPORT_FIELDS.map((field) => (
                      <option key={field} value={field}>
                        {IMPORT_FIELD_LABELS[field]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section>
            <h2 className="font-display text-lg">
              {valid.length.toLocaleString()} ready to import
              {broken.length > 0 ? `, ${broken.length.toLocaleString()} can’t be` : ""}
            </h2>

            {broken.length > 0 ? (
              <div className="mt-3 rounded-lg border border-rule bg-surface px-4 py-3">
                <p className="font-body text-sm text-foreground">
                  These rows will be skipped:
                </p>
                <ul className="mt-2 space-y-1">
                  {broken.slice(0, 10).map((row) => (
                    <li key={row.line} className="font-body text-sm text-muted">
                      <span className="text-danger-ink">Line {row.line}</span>{" "}
                      — {row.errors.join("; ")}
                    </li>
                  ))}
                  {broken.length > 10 ? (
                    <li className="font-body text-sm text-muted">
                      …and {broken.length - 10} more.
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            {parsed.rows.length > 0 ? (
              <div className="mt-4 overflow-x-auto rounded-lg border border-rule">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-rule">
                      {["Line", "Name", "Category", "Qty", "Condition", "Location", "Tags", "Photo"].map(
                        (heading) => (
                          <th
                            key={heading}
                            className="px-3 py-2 font-body text-xs font-semibold uppercase tracking-wide text-muted"
                          >
                            {heading}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, PREVIEW_LIMIT).map((row) => (
                      <tr key={row.line} className="border-b border-rule last:border-b-0 align-top">
                        <td className="px-3 py-2 font-body text-sm text-muted tabular-nums">
                          {row.line}
                        </td>
                        <td className="px-3 py-2 font-body text-sm">
                          {row.errors.length > 0 ? (
                            <span className="text-danger-ink">{row.errors.join("; ")}</span>
                          ) : (
                            <span className="text-foreground">{row.name}</span>
                          )}
                          {row.warnings.length > 0 ? (
                            <p className="mt-0.5 font-body text-xs text-warning-ink">
                              {row.warnings.join("; ")}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={row.category === "costume" ? "accent" : "muted"}>
                            {CATEGORY_LABELS[row.category]}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 font-body text-sm text-muted tabular-nums">
                          {row.quantity}
                        </td>
                        <td className="px-3 py-2 font-body text-sm text-muted">
                          {row.condition ? CONDITION_LABELS[row.condition] : "—"}
                        </td>
                        <td className="px-3 py-2 font-body text-sm text-muted">
                          {row.locationName ?? "—"}
                        </td>
                        <td className="px-3 py-2 font-body text-sm text-muted">
                          {row.tags.length > 0 ? row.tags.join(", ") : "—"}
                        </td>
                        <td className="px-3 py-2 font-body text-sm text-muted">
                          {imageByLine.has(row.line) ? (
                            <span className="text-success-ink">In the sheet</span>
                          ) : row.photoUrl ? (
                            <span className="text-success-ink">Will fetch</span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.rows.length > PREVIEW_LIMIT ? (
                  <p className="border-t border-rule px-3 py-2 font-body text-xs text-muted">
                    Showing the first {PREVIEW_LIMIT} of{" "}
                    {parsed.rows.length.toLocaleString()} rows.
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>

          <div className="space-y-4">
            {missingLocations.length > 0 ? (
              <div className="rounded-lg border border-rule bg-surface px-4 py-3">
                <label className="flex items-start gap-2 font-body text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={createLocations}
                    onChange={(event) => setCreateLocations(event.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    Create {missingLocations.length} location
                    {missingLocations.length === 1 ? "" : "s"} that don’t exist yet
                    <span className="mt-1 block font-body text-xs text-muted">
                      {missingLocations.slice(0, 6).join(", ")}
                      {missingLocations.length > 6
                        ? `, and ${missingLocations.length - 6} more`
                        : ""}
                      . Unticked, those items come in unassigned and you can shelve
                      them later.
                    </span>
                  </span>
                </label>
              </div>
            ) : null}

            {embeddedCount > 0 || photoCount > 0 ? (
              <p className="font-body text-sm text-muted">
                {embeddedCount > 0
                  ? `${embeddedCount} row${embeddedCount === 1 ? " has a picture" : "s have pictures"} in the sheet itself`
                  : ""}
                {embeddedCount > 0 && photoCount > 0 ? ", and " : ""}
                {photoCount > 0
                  ? `${photoCount} row${photoCount === 1 ? "" : "s"} link${photoCount === 1 ? "s" : ""} to one`
                  : ""}
                . Pictures are attached after the items are created, a few at a
                time — it takes a moment, so leave this page open until it
                finishes.
              </p>
            ) : null}

            {importError ? (
              <p className="font-body text-sm text-danger-ink">{importError}</p>
            ) : null}

            <button
              type="button"
              onClick={runImport}
              disabled={valid.length === 0 || phase !== "idle"}
              className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 font-body text-sm font-medium text-background transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {phase === "importing"
                ? "Importing…"
                : phase === "photos"
                  ? `Attaching pictures… ${photoProgress.done} of ${photoProgress.total}`
                  : valid.length === 0
                    ? "Nothing to import"
                    : `Import ${valid.length.toLocaleString()} item${valid.length === 1 ? "" : "s"}`}
            </button>

            <p className="font-body text-xs text-muted">
              {fileName ? `From ${fileName}. ` : ""}
              Items are added, never merged — importing the same file twice
              gives you two copies of everything.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
