import type { ReactNode } from "react";

/**
 * One titled block on the Theatre and Account pages: a rule, a heading, an
 * optional line of explanation, then the controls.
 */
export function SettingsSection({
  id,
  title,
  intro,
  children,
}: {
  id?: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-rule pt-8">
      <h2 className="font-display text-xl">{title}</h2>
      {intro ? (
        <p className="mt-1 max-w-xl font-body text-sm text-muted">{intro}</p>
      ) : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}
