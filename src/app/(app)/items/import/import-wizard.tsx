"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import {
  CSV_TEMPLATE,
  IMPORT_FIELDS,
  IMPORT_FIELD_LABELS,
  MAX_IMPORT_ROWS,
  parseItemsCsv,
  type ImportField,
  type ParsedFile,
} from "@/lib/csv";
import { CATEGORY_LABELS, CONDITION_LABELS } from "@/lib/inventory";
import { importItems } from "./actions";

const PREVIEW_LIMIT = 15;

export function ImportWizard({
  locationNames,
}: {
  locationNames: string[];
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [mapping, setMapping] = useState<(ImportField | null)[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  // Re-parsing on every mapping change keeps one source of truth: the file
  // text. The same function runs again on the server after submitting.
  const parsed: ParsedFile | null = useMemo(() => {
    if (text === null) return null;
    return parseItemsCsv(text, mapping ?? undefined);
  }, [text, mapping]);

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
    try {
      const content = await file.text();
      setText(content);
    } catch {
      setReadError("Couldn’t read that file. Is it a plain .csv?");
      setText(null);
    }
  }

  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`;

  return (
    <div className="space-y-8">
      <section>
        <label className="block font-body text-sm font-medium text-foreground">
          Your spreadsheet, saved as CSV
        </label>
        <p className="mt-1 font-body text-sm text-muted">
          In Excel or Google Sheets, use File → Save as / Download → CSV. Up to{" "}
          {MAX_IMPORT_ROWS.toLocaleString()} rows at a time.{" "}
          <a href={templateHref} download="items-template.csv" className="text-accent hover:underline">
            Download a template
          </a>{" "}
          if you’d rather start from the right shape.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => onFile(event.target.files?.[0])}
          className="mt-3 block w-full font-body text-sm text-muted file:mr-3 file:rounded-md file:border file:border-rule file:bg-surface file:px-3 file:py-1.5 file:font-body file:text-sm file:text-foreground"
        />
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
              <span className="text-foreground">Name</span> is required, and
              columns set to “Ignore” are left out.
            </p>
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
                    <option value="">Ignore this column</option>
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
                      {["Line", "Name", "Category", "Qty", "Condition", "Location", "Tags"].map(
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

          <form action={importItems} className="space-y-4">
            {/* errors and warnings are for this screen only — dropping them keeps a
                two-thousand-row payload comfortably inside the server action
                body limit. */}
            <input
              type="hidden"
              name="rows"
              value={JSON.stringify(
                valid.map(({ errors: _errors, warnings: _warnings, ...row }) => row)
              )}
            />

            {missingLocations.length > 0 ? (
              <div className="rounded-lg border border-rule bg-surface px-4 py-3">
                <label className="flex items-start gap-2 font-body text-sm text-foreground">
                  <input
                    type="checkbox"
                    name="createLocations"
                    defaultChecked
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

            <SubmitButton pendingText="Importing…" disabled={valid.length === 0}>
              {valid.length === 0
                ? "Nothing to import"
                : `Import ${valid.length.toLocaleString()} item${valid.length === 1 ? "" : "s"}`}
            </SubmitButton>
            <p className="font-body text-xs text-muted">
              {fileName ? `From ${fileName}. ` : ""}
              Items are added, never merged — importing the same file twice
              gives you two copies of everything.
            </p>
          </form>
        </>
      ) : null}
    </div>
  );
}
