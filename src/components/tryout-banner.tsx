/**
 * The strip across the top for someone on a tryout link (migration 013):
 * whose test copy this is, and a way to say what they thought. Only shown to
 * anonymous users, which is what opening a tryout link makes them.
 */
const FEEDBACK_EMAIL = "arjunallenbhatkhande@gmail.com";

export function TryoutBanner({ name }: { name: string }) {
  const subject = encodeURIComponent(`Propolis feedback from ${name}`);
  return (
    <div data-tryout-banner data-print-hide className="border-b border-rule bg-honey/15">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-6 py-1.5 xl:max-w-7xl xl:px-8 2xl:max-w-[96rem]">
        <p className="font-body text-sm text-foreground">
          <span className="font-medium">Test copy for {name}.</span>{" "}
          <span className="hidden text-muted sm:inline">Try anything: it’s yours alone.</span>
        </p>
        <a
          href={`mailto:${FEEDBACK_EMAIL}?subject=${subject}`}
          className="inline-flex min-h-11 items-center font-body text-sm font-medium text-accent-ink underline underline-offset-2 md:min-h-0"
        >
          Send feedback
        </a>
      </div>
    </div>
  );
}
