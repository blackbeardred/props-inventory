import Link from "next/link";
import type { MembershipSummary } from "@/lib/auth";
import { switchOrganization } from "@/app/(app)/account/actions";

/**
 * The organization name in the header. With one membership it's just a link
 * home; with several it opens into a list you can switch between. Built on
 * <details> so it needs no client JavaScript.
 */
export function OrgSwitcher({
  memberships,
  activeOrgId,
}: {
  memberships: MembershipSummary[];
  activeOrgId: string | null;
}) {
  const active = memberships.find((m) => m.org_id === activeOrgId);
  const activeName = active?.organizations?.name ?? "Props & Costume Inventory";

  if (memberships.length <= 1) {
    return (
      <Link
        href="/"
        className="font-display text-sm text-muted transition-colors hover:text-foreground"
      >
        {activeName}
      </Link>
    );
  }

  return (
    <details className="relative">
      <summary className="cursor-pointer list-none font-display text-sm text-muted transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        {activeName} <span aria-hidden="true">▾</span>
      </summary>
      <div className="absolute left-0 z-20 mt-2 w-60 rounded-md border border-rule bg-surface p-1 shadow-lg">
        {memberships.map((membership) => {
          const name =
            membership.organizations?.name ?? "Unnamed organization";

          if (membership.org_id === activeOrgId) {
            return (
              <span
                key={membership.org_id}
                className="block rounded px-3 py-1.5 font-body text-sm text-muted"
              >
                {name} <span className="text-xs">(current)</span>
              </span>
            );
          }

          return (
            <form key={membership.org_id} action={switchOrganization}>
              <input type="hidden" name="orgId" value={membership.org_id} />
              <button
                type="submit"
                className="block w-full rounded px-3 py-1.5 text-left font-body text-sm text-foreground transition-colors hover:bg-accent-soft/15 hover:text-accent"
              >
                {name}
              </button>
            </form>
          );
        })}
        <Link
          href="/account"
          className="mt-1 block rounded border-t border-rule px-3 py-1.5 font-body text-xs text-muted transition-colors hover:text-foreground"
        >
          Manage organizations
        </Link>
      </div>
    </details>
  );
}
