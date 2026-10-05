import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Refreshes the Supabase auth session for one request, and says who's signed
 * in. Separate from src/proxy.ts so the end-to-end tests can swap just this
 * part for a signed-in stand-in (e2e/fixtures/proxy-session.ts) and still run
 * the proxy's own redirect rules.
 * See: https://supabase.com/docs/guides/auth/server-side/nextjs
 */
export async function refreshSession(
  request: NextRequest
): Promise<{ user: { id: string } | null; response: NextResponse }> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Touch the session so it refreshes if needed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { user, response };
}
