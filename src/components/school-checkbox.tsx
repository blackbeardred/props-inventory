/**
 * "This is a school": the box on both forms that start a theater
 * (onboarding, and Start a new theater on Your account). Ticked, the theater
 * is made a school (migration 018): one account, the teacher's, and no
 * invite code. It can be switched later on the Theatre page.
 */
export function SchoolCheckbox({ name = "isSchool" }: { name?: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-rule bg-surface px-3 py-2.5 md:min-h-0" data-school-checkbox>
      <input
        type="checkbox"
        name={name}
        value="1"
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)]"
      />
      <span className="font-body text-sm">
        <span className="block font-medium text-foreground">This is a school</span>
        <span className="mt-0.5 block text-muted">
          One account, the teacher’s. Students don’t get accounts, so Propolis holds no student data.
        </span>
      </span>
    </label>
  );
}
