import { type NextRequest, NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { refreshSession } from "@/lib/supabase/proxy-session";

// Routes that don't require a signed-in session.
const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/privacy",
  "/auth/callback",
]);
// Tryout links (/try/<token>, migration 013): opened by people with no
// account yet.
const PUBLIC_PREFIXES = ["/try/"];
// Routes a signed-in user shouldn't see again (bounce to the app instead).
const AUTH_PATHS = new Set(["/login", "/signup"]);

// Refreshes the Supabase auth session on every request so it doesn't
// expire silently (src/lib/supabase/proxy-session.ts), and redirects based on
// sign-in state.
export async function proxy(request: NextRequest) {
  // Before .env.local is filled in (Day 1, step 3), skip the session
  // refresh entirely instead of crashing every request.
  if (!supabaseConfigured) {
    return NextResponse.next({ request });
  }

  const { user, response } = await refreshSession(request);

  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (!user && !isPublic) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(redirectUrl);
  }

  // Someone on a tryout link is signed in without an account; they may still
  // want to log in or sign up for real.
  if (user && !user.is_anonymous && AUTH_PATHS.has(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/inventory";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // The installable-app files are left out alongside the images: the
    // browser fetches the manifest *without* cookies, so running it through
    // here would bounce it to /login and the site would stop being
    // installable — and the service worker, its offline page and the
    // manifest have nothing to do with anyone's session anyway.
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|offline\\.html|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
