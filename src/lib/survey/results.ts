/**
 * Survey responses, made readable (migration 021, /survey-results).
 *
 * A response is stored as the survey's own values ("cant-find", "5-15"),
 * keyed by question id. This turns those back into the words people saw,
 * adds them up per question, works out the price range from the pricing
 * grid, and lays the lot out as a spreadsheet.
 *
 * Pure: it only reads the question list, so it's tested on its own
 * (results.test.mjs).
 */

import { QUESTIONS, type Question, type ScaleQuestion } from "@/lib/survey/storage-2026";

export type SurveyResponse = {
  id: string;
  survey: string;
  answers: Record<string, unknown>;
  email: string | null;
  created_at: string;
};

/** One answered question, in words. */
export type ReadableAnswer =
  | { id: string; prompt: string; kind: "choices"; values: string[] }
  | { id: string; prompt: string; kind: "text"; text: string }
  | { id: string; prompt: string; kind: "scale"; rows: { label: string; level: string }[] };

export type ReadableResponse = {
  id: string;
  received: string;
  theater: string | null;
  role: string | null;
  answers: ReadableAnswer[];
  phone: string | null;
  email: string | null;
  /** Answers to questions the survey no longer asks, kept so nothing is hidden. */
  extras: { key: string; value: string }[];
};

/** Shown at the top of each response rather than among its answers. */
const HEADER_IDS = new Set(["role", "theater_name"]);

/** Short headings for the spreadsheet, where the full question is too long. */
const SHORT: Record<string, string> = {
  role: "Role",
  theater_name: "Theater",
  company: "Kind of company",
  items: "Items in storage",
  tracking: "How they keep track",
  software_name: "Software they use",
  find: "How they find an item",
  pull_time: "Time to pull for the last show",
  rebought: "Bought something they already owned",
  problems: "Happened in the last year",
  importance: "How important",
  price_points: "Monthly price that feels",
  pay_model: "Easier way to pay",
  anything_else: "Anything else",
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const labelOf = (choices: { value: string; label: string }[], value: string) =>
  choices.find((c) => c.value === value)?.label ?? value;

/** "Nov 12, 2026, 4:03 PM", in California time, where Arjun reads it. */
export function formatReceived(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Their role in words: the choice's label, or their own words for "Other". */
export function roleOf(answers: Record<string, unknown>): string | null {
  const q = QUESTIONS.find((x) => x.id === "role");
  const v = str(answers.role);
  if (!q || q.kind !== "single" || !v) return null;
  if (q.otherValue && v === q.otherValue) return str(answers.role_other) || labelOf(q.choices, v);
  return labelOf(q.choices, v);
}

/** The keys a question can have written into a response. */
function keysFor(q: Question): string[] {
  if (q.kind === "single" && q.otherValue) return [q.id, `${q.id}_other`];
  if (q.kind === "multi" && q.detail) return [q.id, `${q.id}_detail`];
  return [q.id];
}

function readAnswer(q: Question, answers: Record<string, unknown>): ReadableAnswer | null {
  const v = answers[q.id];
  if (q.kind === "single") {
    const value = str(v);
    if (!value) return null;
    let label = labelOf(q.choices, value);
    const other = str(answers[`${q.id}_other`]);
    if (q.otherValue && value === q.otherValue && other) label = `${label}: ${other}`;
    return { id: q.id, prompt: q.prompt, kind: "choices", values: [label] };
  }
  if (q.kind === "multi") {
    const picked = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    if (!picked.length) return null;
    const detail = str(answers[`${q.id}_detail`]);
    const values = picked.map((value) => {
      const label = labelOf(q.choices, value);
      return q.detail && value === q.detail.value && detail ? `${label}: ${detail}` : label;
    });
    return { id: q.id, prompt: q.prompt, kind: "choices", values };
  }
  if (q.kind === "scale") {
    const given = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    const rows = q.rows
      .filter((row) => str(given[row.value]))
      .map((row) => ({ label: row.label, level: labelOf(q.levels, str(given[row.value])) }));
    return rows.length ? { id: q.id, prompt: q.prompt, kind: "scale", rows } : null;
  }
  const text = str(v);
  return text ? { id: q.id, prompt: q.prompt, kind: "text", text } : null;
}

const KNOWN_KEYS = new Set([...QUESTIONS.flatMap(keysFor), "phone"]);

function extraValue(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (v && typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k}: ${String(x)}`)
      .join(", ");
  }
  return v == null ? "" : String(v);
}

/** One response, in words, in the order the survey asked. */
export function readResponse(r: SurveyResponse): ReadableResponse {
  const answers = r.answers && typeof r.answers === "object" ? r.answers : {};
  return {
    id: r.id,
    received: formatReceived(r.created_at),
    theater: str(answers.theater_name) || null,
    role: roleOf(answers),
    answers: QUESTIONS.filter((q) => !HEADER_IDS.has(q.id))
      .map((q) => readAnswer(q, answers))
      .filter((a): a is ReadableAnswer => a !== null),
    phone: str(answers.phone) || null,
    email: r.email?.trim() || null,
    extras: Object.keys(answers)
      .filter((key) => !KNOWN_KEYS.has(key))
      .map((key) => ({ key, value: extraValue(answers[key]) }))
      .filter((x) => x.value),
  };
}

// ── Totals ──────────────────────────────────────────────────────────────

export type ChoiceTally = {
  id: string;
  prompt: string;
  kind: "single" | "multi";
  /** How many responses answered this question. */
  answered: number;
  counts: { label: string; count: number }[];
  /** "Other" in their own words, and "What else?" details. */
  written: string[];
};
export type ScaleTally = {
  id: string;
  prompt: string;
  kind: "scale";
  answered: number;
  levels: string[];
  rows: { label: string; counts: number[] }[];
};
export type TextTally = { id: string; prompt: string; kind: "text"; answered: number; texts: string[] };
export type Tally = ChoiceTally | ScaleTally | TextTally;

/** Written answers that belong on a response, not in a list of totals. */
const NOT_TALLIED = new Set(["theater_name", "anything_else"]);

/** Every question added up, in survey order. */
export function tally(responses: SurveyResponse[]): Tally[] {
  const all = responses.map((r) => (r.answers && typeof r.answers === "object" ? r.answers : {}));
  return QUESTIONS.filter((q) => !NOT_TALLIED.has(q.id)).map((q): Tally => {
    if (q.kind === "single" || q.kind === "multi") {
      const counts = q.choices.map((c) => ({ value: c.value, label: c.label, count: 0 }));
      const written: string[] = [];
      let answered = 0;
      for (const a of all) {
        const v = a[q.id];
        const picked = q.kind === "single" ? (typeof v === "string" ? [v] : []) : Array.isArray(v) ? v : [];
        const known = picked.filter((p) => counts.some((c) => c.value === p));
        if (!known.length) continue;
        answered += 1;
        for (const p of known) counts.find((c) => c.value === p)!.count += 1;
        const extra = str(a[q.kind === "single" ? `${q.id}_other` : `${q.id}_detail`]);
        if (extra) written.push(extra);
      }
      return {
        id: q.id,
        prompt: q.prompt,
        kind: q.kind,
        answered,
        counts: counts.map(({ label, count }) => ({ label, count })),
        written,
      };
    }
    if (q.kind === "scale") {
      let answered = 0;
      const rows = q.rows.map((row) => ({ value: row.value, label: row.label, counts: q.levels.map(() => 0) }));
      for (const a of all) {
        const given = a[q.id] && typeof a[q.id] === "object" ? (a[q.id] as Record<string, unknown>) : {};
        let any = false;
        for (const row of rows) {
          const i = q.levels.findIndex((l) => l.value === given[row.value]);
          if (i >= 0) {
            row.counts[i] += 1;
            any = true;
          }
        }
        if (any) answered += 1;
      }
      return {
        id: q.id,
        prompt: q.prompt,
        kind: "scale",
        answered,
        levels: q.levels.map((l) => l.label),
        rows: rows.map(({ label, counts }) => ({ label, counts })),
      };
    }
    const texts = all.map((a) => str(a[q.id])).filter(Boolean);
    return { id: q.id, prompt: q.prompt, kind: "text", answered: texts.length, texts };
  });
}

// ── Price range ─────────────────────────────────────────────────────────

export type PriceRange = {
  /** Responses that answered both "too cheap" and "too expensive". */
  answered: number;
  bands: { label: string; tooCheap: number; tooExpensive: number; acceptable: boolean }[];
  /** The cheapest and dearest acceptable bands, or null when none is. */
  low: string | null;
  high: string | null;
  /** The band named "a bargain" most often, or null with no answers. */
  bargain: string | null;
};

/**
 * Where the price feels right, from the pricing grid.
 *
 * Each person names the band where it starts to feel too cheap and the
 * band where it gets too expensive. A band is too cheap for them when it's
 * at or below their "too cheap" band, and too expensive when it's at or
 * above their "too expensive" one. The acceptable range is the bands that
 * fewer than half find either. It's Van Westendorp's price grid, read on
 * bands rather than exact prices, since that's how it was asked.
 */
export function priceRange(responses: SurveyResponse[]): PriceRange {
  const q = QUESTIONS.find((x) => x.id === "price_points") as ScaleQuestion | undefined;
  if (!q) return { answered: 0, bands: [], low: null, high: null, bargain: null };
  const index = (given: Record<string, unknown>, row: string) =>
    q.levels.findIndex((l) => l.value === given[row]);

  const people = responses
    .map((r) => (r.answers?.price_points && typeof r.answers.price_points === "object" ? (r.answers.price_points as Record<string, unknown>) : {}))
    .map((given) => ({
      tooCheap: index(given, "too-cheap"),
      tooExpensive: index(given, "too-expensive"),
      bargain: index(given, "bargain"),
    }));
  const counted = people.filter((p) => p.tooCheap >= 0 && p.tooExpensive >= 0);
  const n = counted.length;

  const bands = q.levels.map((level, b) => {
    const tooCheap = n ? counted.filter((p) => b <= p.tooCheap).length / n : 0;
    const tooExpensive = n ? counted.filter((p) => b >= p.tooExpensive).length / n : 0;
    return { label: level.label, tooCheap, tooExpensive, acceptable: n > 0 && tooCheap < 0.5 && tooExpensive < 0.5 };
  });
  const ok = bands.filter((b) => b.acceptable);

  const bargainCounts = q.levels.map((_, b) => people.filter((p) => p.bargain === b).length);
  const most = Math.max(0, ...bargainCounts);

  return {
    answered: n,
    bands,
    low: ok[0]?.label ?? null,
    high: ok[ok.length - 1]?.label ?? null,
    bargain: most > 0 ? q.levels[bargainCounts.indexOf(most)].label : null,
  };
}

// ── Spreadsheet ─────────────────────────────────────────────────────────

/** One row per response, in words: headings first, newest response first. */
export function resultsTable(responses: SurveyResponse[]): string[][] {
  const questions = QUESTIONS.filter((q) => !HEADER_IDS.has(q.id));
  const headings = ["Received", "Theater", "Role"];
  for (const q of questions) {
    if (q.kind === "scale") for (const row of q.rows) headings.push(`${SHORT[q.id] ?? q.prompt}: ${row.label}`);
    else headings.push(SHORT[q.id] ?? q.prompt);
  }
  headings.push("Phone", "Email", "Other answers", "Survey");

  const rows = responses.map((r) => {
    const read = readResponse(r);
    const byId = new Map(read.answers.map((a) => [a.id, a]));
    const cells = [read.received, read.theater ?? "", read.role ?? ""];
    for (const q of questions) {
      const a = byId.get(q.id);
      if (q.kind === "scale") {
        const given = a?.kind === "scale" ? new Map(a.rows.map((row) => [row.label, row.level])) : new Map();
        for (const row of q.rows) cells.push(given.get(row.label) ?? "");
      } else if (a?.kind === "choices") cells.push(a.values.join("; "));
      else if (a?.kind === "text") cells.push(a.text);
      else cells.push("");
    }
    cells.push(read.phone ?? "", read.email ?? "", read.extras.map((x) => `${x.key}: ${x.value}`).join("; "), r.survey);
    return cells;
  });
  return [headings, ...rows];
}
