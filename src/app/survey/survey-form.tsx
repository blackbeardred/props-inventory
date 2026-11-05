"use client";

import { useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  MAX_SHORT,
  MAX_TEXT,
  SECTIONS,
  SURVEY_ID,
  cleanAnswers,
  cleanPhone,
  type MultiQuestion,
  type Question,
  type ScaleQuestion,
  type SingleQuestion,
} from "@/lib/survey/storage-2026";

type Answers = Record<string, unknown>;

const tile =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-rule bg-background px-4 py-2.5 font-body text-[15px] leading-snug text-foreground transition-colors hover:border-accent-soft has-[:checked]:border-accent has-[:checked]:bg-surface has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent";
const field =
  "mt-2 block w-full rounded-lg border border-rule bg-background px-4 py-3 font-body text-[15px] text-foreground outline-none transition-colors focus:border-accent";

/** Question numbers run through the whole survey, sections and all. */
const NUMBERS = new Map(SECTIONS.flatMap((s) => s.questions).map((q, i) => [q.id, i + 1]));
const TOTAL = NUMBERS.size + 1; // and the phone number at the end

function Prompt({ q }: { q: Question }) {
  return (
    <legend className="w-full">
      <span className="flex gap-3">
        <span className="pt-1 font-mono text-xs font-bold text-honey-ink tabular-nums">{NUMBERS.get(q.id)}</span>
        <span>
          <span className="block font-display text-xl leading-snug text-foreground">
            {q.prompt}
            {q.required ? <span className="text-honey-ink"> *</span> : null}
          </span>
          {q.hint ? <span className="mt-1 block font-body text-sm text-muted">{q.hint}</span> : null}
        </span>
      </span>
    </legend>
  );
}

export function SurveyForm() {
  const [answers, setAnswers] = useState<Answers>({});
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState(""); // a field only bots fill in
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [missingRole, setMissingRole] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  const set = (key: string, value: unknown) => setAnswers((a) => ({ ...a, [key]: value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const { answers: clean, missing } = cleanAnswers(answers);
    if (missing.includes("role")) {
      setMissingRole(true);
      document.getElementById("q-role")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const tidyPhone = cleanPhone(phone);
    if (tidyPhone === null) {
      setError("That phone number doesn’t look right. Check it, or leave it empty.");
      return;
    }
    // The number travels with the answers; the email column stays empty.
    if (tidyPhone) clean.phone = tidyPhone;
    setStatus("sending");
    if (website) {
      // Filled in by a bot: thank it and send nothing.
      setStatus("sent");
      return;
    }
    try {
      const { error: rpcError } = await createClient().rpc("submit_survey", {
        p_survey: SURVEY_ID,
        p_answers: clean,
      });
      if (rpcError) {
        setStatus("idle");
        setError(
          rpcError.code === "PGRST202"
            ? "The survey isn’t switched on yet. Please try again later."
            : rpcError.message || "Your answers couldn’t be sent. Please try again."
        );
        return;
      }
      setStatus("sent");
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      setStatus("idle");
      setError("Your answers couldn’t be sent. Check your connection and try again; nothing you typed is lost.");
    }
  }

  if (status === "sent") {
    return (
      <div ref={topRef} className="mt-10 rounded-xl border border-rule bg-surface px-6 py-8" data-survey-thanks role="status">
        <p className="font-display text-3xl leading-tight text-foreground">Thank you! Your answers are in.</p>
        <p className="mt-3 font-body text-base leading-relaxed text-foreground">
          If you know other stage managers, prop people or directors, please pass this survey on.
          Every theater does it a little differently, and that’s what I’m trying to learn.
        </p>
      </div>
    );
  }

  const single = (q: SingleQuestion) => (
    <>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {q.choices.map((c) => (
          <label key={c.value} className={tile}>
            <input
              type="radio"
              name={q.id}
              value={c.value}
              checked={answers[q.id] === c.value}
              onChange={() => {
                set(q.id, c.value);
                if (q.id === "role") setMissingRole(false);
              }}
              className="size-4 shrink-0 accent-[var(--accent)]"
            />
            {c.label}
          </label>
        ))}
      </div>
      {q.otherValue && answers[q.id] === q.otherValue ? (
        <label className="mt-3 block font-body text-sm text-muted">
          Which?
          <input
            id={`${q.id}_other`}
            type="text"
            maxLength={MAX_SHORT}
            value={String(answers[`${q.id}_other`] ?? "")}
            onChange={(e) => set(`${q.id}_other`, e.target.value)}
            className={field}
          />
        </label>
      ) : null}
    </>
  );

  const multi = (q: MultiQuestion) => {
    const picked = (answers[q.id] as string[] | undefined) ?? [];
    const toggle = (value: string, on: boolean) => {
      let next = on ? [...picked, value] : picked.filter((v) => v !== value);
      if (on && q.exclusive) next = value === q.exclusive ? [value] : next.filter((v) => v !== q.exclusive);
      set(q.id, next);
    };
    return (
      <>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {q.choices.map((c) => (
            <label key={c.value} className={tile}>
              <input
                type="checkbox"
                name={q.id}
                value={c.value}
                checked={picked.includes(c.value)}
                onChange={(e) => toggle(c.value, e.target.checked)}
                className="size-4 shrink-0 accent-[var(--accent)]"
              />
              {c.label}
            </label>
          ))}
        </div>
        {q.detail && picked.includes(q.detail.value) ? (
          <label className="mt-3 block font-body text-sm text-muted">
            {q.detail.prompt}
            <input
              id={`${q.id}_detail`}
              type="text"
              maxLength={MAX_SHORT}
              value={String(answers[`${q.id}_detail`] ?? "")}
              onChange={(e) => set(`${q.id}_detail`, e.target.value)}
              className={field}
            />
          </label>
        ) : null}
      </>
    );
  };

  const scale = (q: ScaleQuestion) => {
    const rated = (answers[q.id] as Record<string, string> | undefined) ?? {};
    return (
      <div className="mt-4 divide-y divide-rule rounded-lg border border-rule bg-background">
        {q.rows.map((row) => (
          <div
            key={row.value}
            role="radiogroup"
            aria-label={row.label}
            className="grid gap-3 px-4 py-3.5 md:grid-cols-[1fr_auto] md:items-center"
            data-scale-row={row.value}
          >
            <span className="font-body text-[15px] text-foreground">{row.label}</span>
            <div className={`grid grid-cols-3 gap-1.5 ${q.levels.length > 3 ? "md:w-[30rem] md:grid-cols-6" : "md:w-[21rem]"}`}>
              {q.levels.map((level) => (
                <label
                  key={level.value}
                  className="flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-rule px-2 py-2 text-center font-body text-[13px] leading-tight text-muted transition-colors hover:border-accent-soft has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:text-background has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent"
                >
                  <input
                    type="radio"
                    name={`${q.id}.${row.value}`}
                    value={level.value}
                    checked={rated[row.value] === level.value}
                    onChange={() => set(q.id, { ...rated, [row.value]: level.value })}
                    className="sr-only"
                  />
                  {level.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const question = (q: Question) => (
    <fieldset
      key={q.id}
      id={`q-${q.id}`}
      data-question={q.id}
      className="scroll-mt-6"
      aria-describedby={q.id === "role" && missingRole ? "role-missing" : undefined}
    >
      <Prompt q={q} />
      {q.kind === "single" ? single(q) : null}
      {q.kind === "multi" ? multi(q) : null}
      {q.kind === "scale" ? scale(q) : null}
      {q.kind === "text" && q.short ? (
        <input
          id={q.id}
          type="text"
          autoComplete="organization"
          maxLength={MAX_SHORT}
          placeholder={q.placeholder}
          value={String(answers[q.id] ?? "")}
          onChange={(e) => set(q.id, e.target.value)}
          className={`${field} mt-4`}
        />
      ) : null}
      {q.kind === "text" && !q.short ? (
        <textarea
          id={q.id}
          rows={4}
          maxLength={MAX_TEXT}
          placeholder={q.placeholder}
          value={String(answers[q.id] ?? "")}
          onChange={(e) => set(q.id, e.target.value)}
          className={`${field} mt-4 resize-y leading-relaxed`}
        />
      ) : null}
      {q.id === "role" && missingRole ? (
        <p id="role-missing" className="mt-3 font-body text-sm font-medium text-danger-ink" role="alert">
          Choose your main role to send your answers. It’s the only required question.
        </p>
      ) : null}
    </fieldset>
  );

  return (
    <form onSubmit={submit} noValidate className="mt-10" data-survey-form>
      <div ref={topRef} />
      {SECTIONS.map((section) => (
        <section key={section.title} className="mt-12 first:mt-0">
          <h2 className="flex items-center gap-3 border-b border-rule pb-3 font-mono text-xs font-bold uppercase tracking-[0.12em] text-muted">
            <span aria-hidden="true" className="hex w-3 bg-honey" />
            {section.title}
          </h2>
          <div className="mt-8 space-y-10">{section.questions.map(question)}</div>
        </section>
      ))}

      <section className="mt-12">
        <h2 className="flex items-center gap-3 border-b border-rule pb-3 font-mono text-xs font-bold uppercase tracking-[0.12em] text-muted">
          <span aria-hidden="true" className="hex w-3 bg-honey" />
          Stay in touch
        </h2>
        <div className="mt-8">
          <label htmlFor="phone" className="flex gap-3">
            <span className="pt-1 font-mono text-xs font-bold text-honey-ink tabular-nums">{TOTAL}</span>
            <span>
              <span className="block font-display text-xl leading-snug text-foreground">
                Are you open to a 15-minute follow-up call? Please leave your phone number!
              </span>
              <span className="mt-1 block font-body text-sm text-muted">
                Optional. Used only to contact you about this research.
              </span>
            </span>
          </label>
          <input
            id="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            maxLength={40}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={`${field} mt-4`}
          />
        </div>
        {/* Hidden from people; bots fill it in. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label htmlFor="website">Website</label>
          <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
      </section>

      {error ? (
        <p className="mt-8 rounded-lg border border-danger bg-surface px-4 py-3 font-body text-sm text-danger-ink" role="alert" data-survey-error>
          {error}
        </p>
      ) : null}

      <div className="mt-10 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={status === "sending"}
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-accent px-7 py-3 font-body text-base font-semibold text-background transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
        >
          {status === "sending" ? "Sending…" : "Send my answers"}
        </button>
        <span className="font-body text-sm text-muted">Skip anything you’d rather not answer.</span>
      </div>
    </form>
  );
}
