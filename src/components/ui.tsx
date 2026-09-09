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
        {intro ? (
          <p className="mt-2 max-w-xl font-body text-sm text-muted">{intro}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

const BADGE_TONES = {
  neutral: "border-rule text-foreground",
  muted: "border-rule text-muted",
  accent: "border-accent/40 text-accent",
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
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-body text-xs whitespace-nowrap ${BADGE_TONES[tone]}`}
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
}: {
  columns: ReactNode[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-rule">
            {columns.map((label, i) => (
              <th
                key={i}
                className="px-3 py-2 font-body text-xs font-medium uppercase tracking-wide text-muted"
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
        className="w-full rounded-md border border-rule bg-surface px-3 py-2 font-body text-sm text-foreground outline-none transition-colors focus:border-accent"
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
        className="w-full rounded-md border border-rule bg-surface px-3 py-2 font-body text-sm text-foreground outline-none transition-colors focus:border-accent"
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
        className="w-full rounded-md border border-rule bg-surface px-3 py-2 font-body text-sm text-foreground outline-none transition-colors focus:border-accent"
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
        className="block w-full font-body text-sm text-muted file:mr-3 file:rounded-md file:border file:border-rule file:bg-surface file:px-3 file:py-1.5 file:font-body file:text-sm file:text-foreground hover:file:bg-rule/40"
      />
      {helpText ? (
        <span className="mt-1 block font-body text-xs text-muted">
          {helpText}
        </span>
      ) : null}
    </label>
  );
}
