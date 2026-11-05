"use client";

/**
 * The copyright line under the standalone pages: signing up and in, the
 * privacy policy, the survey, a tryout link.
 *
 * Rendered once, in the root layout, rather than in each page. The two kinds
 * of page that aren't listed carry their own: the landing page has its dark
 * footer, and the signed-in app puts the line at the foot of its content,
 * above the phone's tab bar. A new standalone page goes in the list below.
 */

import { usePathname } from "next/navigation";
import { copyrightNotice } from "@/lib/copyright";

const STANDALONE = [
  "/login",
  "/signup",
  "/onboarding",
  "/forgot-password",
  "/reset-password",
  "/privacy",
  "/survey",
  "/try",
];

export function SiteFooter() {
  const pathname = usePathname();
  const standalone = STANDALONE.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!standalone) return null;

  return (
    <footer data-site-footer data-print-hide className="px-6 pb-8 pt-4 text-center font-body text-xs text-muted">
      {copyrightNotice()}
    </footer>
  );
}
