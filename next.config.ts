import type { NextConfig } from "next";

/**
 * E2E_FIXTURES=1 builds the app against an in-memory sample theatre instead
 * of Supabase, for the end-to-end tests (e2e/, see e2e/README.md). Five
 * modules are swapped for the stand-ins in e2e/fixtures/; everything else —
 * every page, server action and the proxy's redirect rules — is the real
 * code. A fixture build goes to .next-e2e, so it never overwrites the normal
 * one, and it refuses to build on Vercel at all.
 */
const fixtures = process.env.E2E_FIXTURES === "1";

if (fixtures && process.env.VERCEL) {
  throw new Error("E2E_FIXTURES is for test runs only; unset it in the Vercel project.");
}

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Photo uploads (Day 4) go through a Server Action; the default 1MB
      // body limit is too small for a phone photo. Leaves headroom above
      // the 8MB file-size check in items/new/actions.ts for multipart
      // overhead.
      bodySizeLimit: "10mb",
    },
  },
  ...(fixtures
    ? {
        distDir: ".next-e2e",
        devIndicators: false,
        env: {
          // The sample theatre stands in for Supabase, but the pages still
          // check these are set before they try to use it.
          NEXT_PUBLIC_SUPABASE_URL: "https://fixtures.invalid",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixtures",
        },
        turbopack: {
          resolveAlias: {
            "@/lib/supabase/server": "./e2e/fixtures/supabase-server.ts",
            "@/lib/supabase/client": "./e2e/fixtures/supabase-client.ts",
            "@/lib/supabase/proxy-session": "./e2e/fixtures/proxy-session.ts",
            "@/lib/embedding": "./e2e/fixtures/embedding.ts",
            "@/lib/ai/see-items": "./e2e/fixtures/see-items.ts",
            "@/lib/e2e-hooks": "./e2e/fixtures/hooks.ts",
          },
        },
      }
    : {}),
};

export default nextConfig;
