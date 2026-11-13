import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Notice, PageHeading } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { getUserAndProfile } from "@/lib/auth";
import { SURVEY_ID } from "@/lib/survey/storage-2026";
import {
  priceRange,
  readResponse,
  tally,
  type PriceRange,
  type ReadableResponse,
  type SurveyResponse,
  type Tally,
} from "@/lib/survey/results";

export const metadata: Metadata = {
  title: "Survey results · Propolis",
  robots: { index: false, follow: false },
};

// Live answers: never a cached copy.
export const dynamic = "force-dynamic";

/**
 * The storage survey's answers, for the one account allowed to read them
 * (migration 021): every response in words, totals for each question, and
 * the price range. The database refuses everyone else, so this page only
 * ever shows them what to do about it.
 *
 * A tap on the ntfy notification lands on #r-<id>, the response it was for.
 */
export default async function SurveyResultsPage() {
  if (!supabaseConfigured) redirect("/");
  const { user, profile } = await getUserAndProfile();
  if (!user) redirect("/login?next=/survey-results");
  if (!profile) redirect("/onboarding");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("survey_results", { p_survey: SURVEY_ID });

  if (error) {
    const notSetUp = error.code === "PGRST202";
    return (
      <>
        <PageHeading title="Survey results" />
        <div className="max-w-2xl space-y-4" data-survey-results-locked>
          {notSetUp ? (
            <Notice title="Survey results aren’t switched on yet">
              Run migration 021 (supabase/migrations/021_survey_results.sql) in the Supabase SQL
              Editor, then open this page again.
            </Notice>
          ) : (
            <Notice title="This page is private">
              Only the account chosen to read the survey can see its responses.
            </Notice>
          )}
          {!notSetUp && !user.is_anonymous ? (
            <div className="rounded-lg border border-rule px-5 py-4">
              <p className="font-body text-sm text-foreground">
                If this is your survey, make this account its reader. In the Supabase SQL Editor, run:
              </p>
              <pre
                className="mt-3 overflow-x-auto rounded-md bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-foreground"
                data-reader-sql
              >
                {`insert into notify_settings (key, value) values ('survey_reader', '${user.id}')\non conflict (key) do update set value = excluded.value;`}
              </pre>
              <p className="mt-3 font-body text-sm text-muted">
                That line has this account’s ID in it. Only one account can be the reader; running it
                again with another ID moves it.
              </p>
            </div>
          ) : null}
        </div>
      </>
    );
  }

  const responses = (data ?? []) as SurveyResponse[];
  const readable = responses.map(readResponse);
  const totals = tally(responses);
  const price = priceRange(responses);
  const n = responses.length;

  return (
    <>
      <PageHeading
        title="Survey results"
        intro={
          n
            ? `${n} ${n === 1 ? "response" : "responses"} to the storage survey, newest first.`
            : "Nobody has answered the storage survey yet."
        }
        action={
          n ? (
            <a
              href="/survey-results/download"
              className="inline-flex min-h-11 items-center justify-center rounded-md md:min-h-0 bg-accent px-4 py-2 font-body text-sm font-medium text-background transition-colors hover:opacity-90"
              data-survey-download
            >
              Download spreadsheet
            </a>
          ) : null
        }
      />

      {n ? (
        <>
          <nav aria-label="On this page" className="-mt-4 mb-8 flex flex-wrap gap-2 xl:hidden">
            {[
              ["#responses", "Responses"],
              ["#price", "Price range"],
              ["#totals", "Totals"],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="inline-flex min-h-11 items-center rounded-full border border-rule px-3 font-body text-sm text-foreground md:min-h-0 md:py-1"
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="grid items-start gap-10 xl:grid-cols-[minmax(0,1fr)_400px]">
            <section id="responses" aria-labelledby="responses-title" className="min-w-0 scroll-mt-20">
              <h2 id="responses-title" className="sr-only">
                Responses
              </h2>
              <ol className="space-y-6">
                {readable.map((r) => (
                  <ResponseCard key={r.id} response={r} />
                ))}
              </ol>
            </section>

            <div className="min-w-0 space-y-10 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto xl:pr-1">
              <PriceSection price={price} />
              <TotalsSection totals={totals} />
            </div>
          </div>
        </>
      ) : (
        <div className="max-w-2xl">
          <Notice title="No responses yet">
            When someone answers at /survey, their response appears here and your ntfy app tells you.
          </Notice>
        </div>
      )}
    </>
  );
}

function ResponseCard({ response: r }: { response: ReadableResponse }) {
  return (
    <li
      id={`r-${r.id}`}
      className="scroll-mt-20 rounded-xl border border-rule bg-surface px-5 py-5 target:ring-2 target:ring-honey md:px-6"
      data-response
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-display text-2xl leading-tight text-foreground">{r.theater ?? "Theater not given"}</h3>
        <p className="font-mono text-xs text-muted">{r.received}</p>
      </div>
      {r.role ? <p className="mt-1 font-body text-sm font-medium text-accent-ink">{r.role}</p> : null}
      {r.phone || r.email ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-4 font-body text-sm text-foreground" data-contact>
          {r.phone ? (
            <span>
              Open to a call:{" "}
              <a
                href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}
                className="inline-flex min-h-11 items-center text-accent-ink underline underline-offset-2 md:min-h-0"
              >
                {r.phone}
              </a>
            </span>
          ) : null}
          {r.email ? (
            <a
              href={`mailto:${r.email}`}
              className="inline-flex min-h-11 items-center text-accent-ink underline underline-offset-2 md:min-h-0"
            >
              {r.email}
            </a>
          ) : null}
        </p>
      ) : null}

      {r.answers.length ? (
        <dl className="mt-5 space-y-4 border-t border-rule pt-5">
          {r.answers.map((a) => (
            <div key={a.id} data-answer={a.id}>
              <dt className="font-body text-xs text-muted">{a.prompt}</dt>
              <dd className="mt-1 font-body text-sm text-foreground">
                {a.kind === "text" ? (
                  <blockquote className="border-l-2 border-honey pl-3 whitespace-pre-line">{a.text}</blockquote>
                ) : a.kind === "choices" ? (
                  a.values.length === 1 ? (
                    a.values[0]
                  ) : (
                    <ul className="list-disc space-y-0.5 pl-5">
                      {a.values.map((v) => (
                        <li key={v}>{v}</li>
                      ))}
                    </ul>
                  )
                ) : (
                  <table className="w-full border-collapse text-left">
                    <tbody>
                      {a.rows.map((row) => (
                        <tr key={row.label} className="border-b border-rule/60 last:border-0">
                          <td className="py-1 pr-3 align-top">{row.label}</td>
                          <td className="py-1 text-right align-top font-medium whitespace-nowrap">{row.level}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {r.extras.length ? (
        <div className="mt-4 border-t border-rule pt-4">
          <p className="font-body text-xs text-muted">Answers to questions the survey no longer asks</p>
          <ul className="mt-1 space-y-0.5 font-body text-sm text-foreground">
            {r.extras.map((x) => (
              <li key={x.key}>
                <span className="font-mono text-xs text-muted">{x.key}:</span> {x.value}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

const pct = (share: number) => `${Math.round(share * 100)}%`;

function PriceSection({ price }: { price: PriceRange }) {
  return (
    <section id="price" aria-labelledby="price-title" className="scroll-mt-20" data-price-range>
      <h2 id="price-title" className="font-display text-xl">
        Price range
      </h2>
      {price.answered === 0 ? (
        <p className="mt-2 font-body text-sm text-muted">Nobody has answered the pricing question yet.</p>
      ) : (
        <>
          <p className="mt-2 font-body text-base text-foreground" data-price-summary>
            {price.low && price.high
              ? price.low === price.high
                ? `Acceptable: ${price.low} a month.`
                : `Acceptable: ${price.low} to ${price.high} a month.`
              : "No price band suits most people yet."}
            {price.bargain ? ` Most often called a bargain: ${price.bargain}.` : ""}
          </p>
          <p className="mt-1 font-body text-xs text-muted">
            From {price.answered} {price.answered === 1 ? "answer" : "answers"}. Acceptable means fewer than half
            find it too cheap to trust or too expensive to consider.
            {price.answered < 10 ? " A rough guide until there are about 10." : ""}
          </p>
          <table className="mt-4 w-full border-collapse text-left font-body text-sm">
            <thead>
              <tr className="border-b border-rule text-xs text-muted">
                <th className="py-1.5 pr-2 font-medium">Per month</th>
                <th className="py-1.5 pr-2 text-right font-medium">Too cheap</th>
                <th className="py-1.5 text-right font-medium">Too expensive</th>
              </tr>
            </thead>
            <tbody>
              {price.bands.map((b) => (
                <tr
                  key={b.label}
                  className={`border-b border-rule/60 ${b.acceptable ? "bg-accent-soft/15 font-medium text-accent-ink" : "text-foreground"}`}
                  data-acceptable={b.acceptable || undefined}
                >
                  <td className="py-1.5 pr-2 pl-1">{b.label}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{pct(b.tooCheap)}</td>
                  <td className="py-1.5 pr-1 text-right tabular-nums">{pct(b.tooExpensive)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function TotalsSection({ totals }: { totals: Tally[] }) {
  return (
    <section id="totals" aria-labelledby="totals-title" className="scroll-mt-20">
      <h2 id="totals-title" className="font-display text-xl">
        Totals
      </h2>
      <div className="mt-4 space-y-7">
        {totals.map((t) => (
          <div key={t.id} data-total={t.id}>
            <h3 className="font-body text-sm font-medium text-foreground">{t.prompt}</h3>
            <p className="font-mono text-[11px] text-muted">
              {t.answered} {t.answered === 1 ? "answer" : "answers"}
              {t.kind === "multi" ? " · people could pick several" : ""}
            </p>
            {t.kind === "single" || t.kind === "multi" ? (
              <>
                <ul className="mt-2 space-y-1.5">
                  {t.counts.map((c) => (
                    <li key={c.label} className="font-body text-sm">
                      <div className="flex justify-between gap-3">
                        <span className={c.count ? "text-foreground" : "text-muted"}>{c.label}</span>
                        <span className="font-medium tabular-nums text-foreground">{c.count}</span>
                      </div>
                      <div className="mt-0.5 h-1.5 rounded-full bg-foreground/[0.06]" aria-hidden="true">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: t.answered ? `${(c.count / t.answered) * 100}%` : "0%" }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
                {t.written.length ? (
                  <p className="mt-2 font-body text-xs text-muted">In their words: {t.written.join(" · ")}</p>
                ) : null}
              </>
            ) : t.kind === "scale" ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full border-collapse text-left font-body text-xs">
                  <thead>
                    <tr className="border-b border-rule text-muted">
                      <th className="py-1 pr-2 font-medium" />
                      {t.levels.map((level) => (
                        <th key={level} className="px-1 py-1 text-right font-medium whitespace-nowrap">
                          {level}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.map((row) => (
                      <tr key={row.label} className="border-b border-rule/60">
                        <td className="py-1 pr-2 text-foreground">{row.label}</td>
                        {row.counts.map((count, i) => (
                          <td
                            key={i}
                            className={`px-1 py-1 text-right tabular-nums ${count ? "font-medium text-foreground" : "text-muted"}`}
                          >
                            {count}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : t.kind === "text" ? (
              <ul className="mt-2 space-y-0.5 font-body text-sm text-foreground">
                {t.texts.length ? t.texts.map((text, i) => <li key={i}>{text}</li>) : <li className="text-muted">None yet</li>}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
