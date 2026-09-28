/**
 * The columns an import had no field for, shown on the item's own page.
 *
 * Deliberately only here. These values are part of what a search matches, so
 * without somewhere to see them an item could turn up for a word that appears
 * nowhere on screen — which reads as a bug. Showing them on the one page
 * someone opens to ask "what is this thing?" answers that, without putting a
 * donor's name and an insurance value into every list in the app.
 */
export function ImportDataPanel({ data }: { data: Record<string, string> }) {
  const entries = Object.entries(data ?? {});
  if (entries.length === 0) return null;

  return (
    <div className="mt-8 max-w-lg border-t border-rule pt-6">
      <h2 className="font-body text-sm font-medium text-foreground">
        From your spreadsheet
      </h2>
      <p className="mt-1 font-body text-xs text-muted">
        Columns the import had no field for. They’re kept so nothing from the
        original list is lost, and searching any of these values finds this
        item — they just don’t appear anywhere else.
      </p>

      <dl className="mt-3 space-y-2">
        {entries.map(([heading, value]) => (
          <div
            key={heading}
            className="flex flex-col gap-0.5 font-body text-sm sm:flex-row sm:gap-3"
          >
            <dt className="shrink-0 text-muted sm:w-40">{heading}</dt>
            <dd className="break-words text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
