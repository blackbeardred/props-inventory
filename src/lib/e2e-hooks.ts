/**
 * Test-only hooks, which in a normal build do nothing.
 *
 * In a fixture build (E2E_FIXTURES=1, see next.config.ts) this module is
 * swapped for e2e/fixtures/hooks.ts, which puts the in-memory sample theatre
 * back the way it started. Anywhere else resetFixtures is null and
 * /api/e2e/reset answers 404, so there's nothing to call in production.
 */
export const resetFixtures: ((options: URLSearchParams) => void) | null = null;
