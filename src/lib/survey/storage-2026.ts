/**
 * The storage survey (Oct 2026): problem discovery with stage managers, prop
 * curators and directors. It asks how theaters keep track of what's in
 * storage today and what goes wrong. It's neutral on purpose: Propolis isn't
 * named, so the answers aren't steered.
 *
 * The questions are data, so the page (src/app/survey) and the checks below
 * read from the same list. Answers are saved by submit_survey (migration
 * 017) as one JSON object, keyed by question id. A choice's `value` is what's
 * stored, and its `label` is what people read. Change a label freely, but
 * keep a value once answers exist.
 *
 * Pure: no imports, so it's tested on its own (storage-2026.test.mjs).
 */

export const SURVEY_ID = "storage-2026";

export type Choice = { value: string; label: string };

type Base = { id: string; prompt: string; hint?: string; required?: boolean };
export type SingleQuestion = Base & {
  kind: "single";
  choices: Choice[];
  /** The choice that asks "Which?", saved as `<id>_other`. */
  otherValue?: string;
};
export type MultiQuestion = Base & {
  kind: "multi";
  choices: Choice[];
  /** A choice that asks for more, saved as `<id>_detail`. */
  detail?: { value: string; prompt: string };
  /** A choice that can't be picked with any other ("None of these"). */
  exclusive?: string;
};
export type ScaleQuestion = Base & { kind: "scale"; rows: Choice[]; levels: Choice[] };
export type TextQuestion = Base & { kind: "text"; placeholder?: string };
export type Question = SingleQuestion | MultiQuestion | ScaleQuestion | TextQuestion;
export type Section = { title: string; questions: Question[] };

export const SECTIONS: Section[] = [
  {
    title: "About you",
    questions: [
      {
        id: "role",
        kind: "single",
        prompt: "What’s your main role?",
        required: true,
        otherValue: "other",
        choices: [
          { value: "stage-manager", label: "Stage manager" },
          { value: "asm", label: "Assistant stage manager" },
          { value: "props", label: "Props master or prop curator" },
          { value: "costumes", label: "Costume designer or wardrobe" },
          { value: "director", label: "Director" },
          { value: "production-manager", label: "Production manager or technical director" },
          { value: "other", label: "Other" },
        ],
      },
      {
        id: "company",
        kind: "single",
        prompt: "What kind of company do you work with most?",
        otherValue: "other",
        choices: [
          { value: "community", label: "Community theater" },
          { value: "school", label: "High school or college" },
          { value: "professional", label: "Professional regional or resident theater" },
          { value: "touring", label: "Touring company" },
          { value: "opera-dance", label: "Opera or dance company" },
          { value: "other", label: "Other" },
        ],
      },
      {
        id: "productions",
        kind: "single",
        prompt: "About how many productions does it stage a year?",
        choices: [
          { value: "1-2", label: "1–2" },
          { value: "3-5", label: "3–5" },
          { value: "6-10", label: "6–10" },
          { value: "11-plus", label: "More than 10" },
        ],
      },
      {
        id: "items",
        kind: "single",
        prompt: "Roughly how many items are in storage?",
        hint: "Props, costumes and set pieces together.",
        choices: [
          { value: "under-200", label: "Under 200" },
          { value: "200-1000", label: "200–1,000" },
          { value: "1000-5000", label: "1,000–5,000" },
          { value: "over-5000", label: "Over 5,000" },
          { value: "not-sure", label: "Not sure" },
        ],
      },
    ],
  },
  {
    title: "How it works today",
    questions: [
      {
        id: "tracking",
        kind: "multi",
        prompt: "How does your company keep track of what’s in storage?",
        hint: "Choose all that apply.",
        detail: { value: "software", prompt: "Which app or software?" },
        choices: [
          { value: "memory", label: "Nobody does; people remember" },
          { value: "paper", label: "Paper lists or binders" },
          { value: "spreadsheet", label: "A spreadsheet (Excel or Google Sheets)" },
          { value: "photos", label: "Photos in a shared folder or on phones" },
          { value: "software", label: "An inventory app or software" },
          { value: "bins", label: "Labeled bins or shelves only" },
          { value: "other", label: "Something else" },
        ],
      },
      {
        id: "find",
        kind: "single",
        prompt: "When you need a specific item, how do you usually find out whether you have it, and where it is?",
        choices: [
          { value: "list", label: "We check a list or spreadsheet" },
          { value: "ask", label: "We ask someone who knows" },
          { value: "look", label: "Someone goes to storage and looks" },
          { value: "chat", label: "We ask in a group chat" },
          { value: "unknown", label: "We often can’t tell whether we have it" },
        ],
      },
      {
        id: "pull_time",
        kind: "single",
        prompt: "For your last production, how long did pulling props and costumes from storage take?",
        choices: [
          { value: "under-2h", label: "Under 2 hours" },
          { value: "2-5h", label: "2–5 hours" },
          { value: "1-2d", label: "1–2 days" },
          { value: "over-2d", label: "More than 2 days" },
          { value: "not-involved", label: "I wasn’t involved" },
        ],
      },
      {
        id: "rebought",
        kind: "single",
        prompt: "How often has your company bought, rented or built something it turned out to already own?",
        choices: [
          { value: "never", label: "Never" },
          { value: "once-twice", label: "Once or twice" },
          { value: "several", label: "Several times" },
          { value: "often", label: "Often" },
          { value: "dont-know", label: "Don’t know" },
        ],
      },
      {
        id: "problems",
        kind: "multi",
        prompt: "Which of these happened in the last year?",
        hint: "Choose all that apply.",
        exclusive: "none",
        choices: [
          { value: "cant-find", label: "Couldn’t find something we knew we had" },
          { value: "damaged", label: "An item was damaged or missing when it was pulled" },
          { value: "double-booked", label: "Two shows needed the same item at once" },
          { value: "not-returned", label: "Something wasn’t put back after a show" },
          { value: "loans", label: "Lost track of borrowed or rented items" },
          { value: "new-crew", label: "New crew or volunteers didn’t know where things go" },
          { value: "none", label: "None of these" },
        ],
      },
      {
        id: "frustration",
        kind: "text",
        prompt: "What’s the most frustrating part of managing storage today?",
        placeholder: "A story about the last time something went wrong is perfect.",
      },
    ],
  },
  {
    title: "What would help",
    questions: [
      {
        id: "importance",
        kind: "scale",
        prompt: "How important would each of these be to you?",
        levels: [
          { value: "not", label: "Not important" },
          { value: "somewhat", label: "Somewhat" },
          { value: "very", label: "Very" },
        ],
        rows: [
          { value: "search", label: "Searching by name, material or color" },
          { value: "photos", label: "A photo of every item" },
          { value: "location", label: "Knowing the exact room, shelf and box" },
          { value: "pull-lists", label: "A pull list for each show" },
          { value: "in-use", label: "Seeing what’s in use or out on loan" },
          { value: "offline", label: "Working on a phone in storage with no signal" },
          { value: "photo-search", label: "Finding an item from a photo" },
        ],
      },
      {
        id: "upkeep",
        kind: "multi",
        prompt: "Who would keep an inventory up to date at your company?",
        hint: "Choose all that apply.",
        choices: [
          { value: "me", label: "Me" },
          { value: "props", label: "The props master" },
          { value: "stage-management", label: "Stage management" },
          { value: "volunteers", label: "Volunteers" },
          { value: "students", label: "Students" },
          { value: "nobody", label: "Honestly, nobody has time" },
        ],
      },
      {
        id: "pay",
        kind: "single",
        prompt: "If a tool fixed this, would your company pay for it?",
        choices: [
          { value: "yes", label: "Yes" },
          { value: "maybe", label: "Maybe, depending on the price" },
          { value: "free-only", label: "Only if it’s free" },
          { value: "not-my-call", label: "It’s not my decision" },
          { value: "dont-know", label: "Don’t know" },
        ],
      },
      {
        id: "anything_else",
        kind: "text",
        prompt: "Anything else I should know?",
      },
    ],
  },
];

export const QUESTIONS: Question[] = SECTIONS.flatMap((s) => s.questions);

export const MAX_TEXT = 2000;
export const MAX_SHORT = 200;

export type RawAnswers = Record<string, unknown>;
export type CleanResult = { answers: Record<string, unknown>; missing: string[]; answered: number };

const text = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "";

/**
 * Keeps only what the survey asked: known questions, real choices, written
 * answers trimmed to length, and "Which?" details only beside the choice that
 * asks for them. Reports required questions left empty. The database checks
 * size and shape again, so this is for tidy answers, not security.
 */
export function cleanAnswers(raw: RawAnswers): CleanResult {
  const answers: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const q of QUESTIONS) {
    const v = raw[q.id];
    if (q.kind === "single") {
      if (typeof v === "string" && q.choices.some((c) => c.value === v)) {
        answers[q.id] = v;
        if (q.otherValue && v === q.otherValue) {
          const other = text(raw[`${q.id}_other`], MAX_SHORT);
          if (other) answers[`${q.id}_other`] = other;
        }
      }
    } else if (q.kind === "multi") {
      const picked = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
      let kept = q.choices.map((c) => c.value).filter((value) => picked.includes(value));
      if (q.exclusive && kept.includes(q.exclusive)) kept = [q.exclusive];
      if (kept.length) {
        answers[q.id] = kept;
        if (q.detail && kept.includes(q.detail.value)) {
          const detail = text(raw[`${q.id}_detail`], MAX_SHORT);
          if (detail) answers[`${q.id}_detail`] = detail;
        }
      }
    } else if (q.kind === "scale") {
      const given = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
      const rated: Record<string, string> = {};
      for (const row of q.rows) {
        const level = given[row.value];
        if (typeof level === "string" && q.levels.some((l) => l.value === level)) rated[row.value] = level;
      }
      if (Object.keys(rated).length) answers[q.id] = rated;
    } else {
      const t = text(v, MAX_TEXT);
      if (t) answers[q.id] = t;
    }
    if (q.required && answers[q.id] === undefined) missing.push(q.id);
  }
  const answered = QUESTIONS.filter((q) => answers[q.id] !== undefined).length;
  return { answers, missing, answered };
}

/** A typed email, tidied; "" when left empty; null when it isn't an email. */
export function cleanEmail(raw: unknown): string | null {
  const e = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!e) return "";
  return e.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}
