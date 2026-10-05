import { resetFixtures } from "@/lib/e2e-hooks";

export const dynamic = "force-dynamic";

/**
 * Puts the end-to-end tests' sample theatre back to how it started, so each
 * test begins from the same data. Only does anything in a fixture build;
 * everywhere else it's a 404 (see src/lib/e2e-hooks.ts).
 */
export async function POST() {
  if (!resetFixtures) return new Response("Not found", { status: 404 });
  resetFixtures();
  return Response.json({ ok: true });
}
