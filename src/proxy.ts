import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/supabase/config";

// Routes that don't require a signed-in session.
const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/auth/callback",
]);
// Routes a signed-in user shouldn't see again (bounce to the app instead).
const AUTH_PATHS = new Set(["/login", "/signup"]);

// Refreshes the Supabase auth session on every request so it doesn't
// expire silently, and redirects based on sign-in state.
// See: https://supabase.com/docs/guides/auth/server-side/nextjs
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Before .env.local is filled in (Day 1, step 3), skip the session
  // refresh entirely instead of crashing every request.
  if (!supabaseConfigured) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
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

  const { pathname } = request.nextUrl;

  if (!user && !PUBLIC_PATHS.has(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(redirectUrl);
  }

  if (user && AUTH_PATHS.has(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/locations";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
