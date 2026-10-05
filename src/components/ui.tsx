import type { ReactNode } from "react";

export function PageHeading({
  title,
  intro,
  action,
}: {
  title: string;
  intro?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl leading-tight">{title}</h1>
        {/* A <div> when the intro is markup (a breadcrumb, a row of badges):
            a <nav> or a list inside a <p> is invalid HTML, and React then
            throws away the server render to fix it. */}
        {intro ? (
          typeof intro === "string" ? (
            <p className="mt-2 max-w-xl font-body text-sm text-muted">{intro}</p>
          ) : (
            <div className="mt-2 max-w-xl font-body text-sm text-muted">{intro}</div>
          )
        ) : null}
      </div>
      {/* max-w-full rather than shrink-0: a row of buttons that can't shrink
          can't wrap either, and on a phone that pushed the production page
          to 540px wide with "Edit production" off the edge. */}
      {action ? <div className="max-w-full">{action}</div> : null}
    </div>
  );
}

// Tinted fills rather than outlines: a status colour only reads as status
// when its hue is actually present as a ground. Each tone pairs a light wash
// of its hue with that hue's darkened ink, every pair clearing WCAG AA on the
// card tan (see the -ink values in globals.css). The accent tone takes
// --accent-ink rather than --accent: the plain accent clears AA on the bare
// card but drops to 4.02 once its own tint is underneath it.
const BADGE_TONES = {
  neutral: "bg-foreground/[0.06] text-foreground",
  muted: "bg-foreground/[0.05] text-muted",
  accent: "bg-accent-soft/15 text-accent-ink",
  success: "bg-success/15 text-success-ink",
  warning: "bg-warning/20 text-warning-ink",
  danger: "bg-danger/15 text-danger-ink",
} as const;

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONES;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-body text-xs font-medium whitespace-nowrap ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-rule px-6 py-16 text-center">
      <p className="font-display text-lg">{title}</p>
      {children ? (
        <p className="mx-auto mt-2 max-w-sm font-body text-sm text-muted">
          {children}
        </p>
      ) : null}
    </div>
  );
}

export function Notice({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-rule bg-surface px-5 py-4">
      <p className="font-body text-sm font-medium text-foreground">{title}</p>
      {children ? (
        <div className="mt-1 font-body text-sm text-muted">{children}</div>
      ) : null}
    </div>
  );
}

export function DataTable({
  columns,
  children,
  phoneHidden = [],
}: {
  columns: ReactNode[];
  children: ReactNode;
  /**
   * Column indexes left out below md, where a table that scrolls sideways
   * hides the very links people came for. The rows' own cells must hide the
   * same columns (`hidden md:table-cell`).
   */
  phoneHidden?: number[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-rule">
            {columns.map((label, i) => (
              <th
                key={i}
                className={`px-3 py-2 font-body text-xs font-medium uppercase tracking-wide text-muted ${
                  phoneHidden.includes(i) ? "hidden md:table-cell" : ""
                }`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function TextField({
  label,
  name,
  type = "text",
  required,
  autoComplete,
  defaultValue,
  minLength,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  defaultValue?: string;
  minLength?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-body text-sm text-muted">
        {label}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        minLength={minLength}
        className="min-h-11 w-full rounded-md border border-rule bg-surface px-3 py-2 font-body text-sm text-foreground outline-none transition-colors focus:border-accent md:min-h-0"
      />
    </label>
  );
}

export function SelectField({
  label,
  name,
  defaultValue,
  required,
  children,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-body text-sm text-muted">
        {label}
      </span>
      <select
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="min-h-11 w-full rounded-md border border-rule bg-surface px-3 py-2 font-body text-sm text-foreground outline-none transition-colors focus:border-accent md:min-h-0"
      >
        {children}
      </select>
    </label>
  );
}

export function TextareaField({
  label,
  name,
  rows = 3,
  defaultValue,
}: {
  label: string;
  name: string;
  rows?: number;
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-body text-sm text-muted">
        {label}
      </span>
      <textarea
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        className="min-h-11 w-full rounded-md border border-rule bg-surface px-3 py-2 font-body text-sm text-foreground outline-none transition-colors focus:border-accent md:min-h-0"
      />
    </label>
  );
}

export function FileField({
  label,
  name,
  accept,
  helpText,
}: {
  label: string;
  name: string;
  accept?: string;
  helpText?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-body text-sm text-muted">
        {label}
      </span>
      <input
        type="file"
        name={name}
        accept={accept}
        className="block min-h-11 w-full font-body text-sm text-muted md:min-h-0 file:mr-3 file:rounded-md file:border file:border-rule file:bg-surface file:px-3 file:py-1.5 file:font-body file:text-sm file:text-foreground hover:file:bg-rule/40"
      />
      {helpText ? (
        <span className="mt-1 block font-body text-xs text-muted">
          {helpText}
        </span>
      ) : null}
    </label>
  );
}
