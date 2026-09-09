import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * PKCE code-exchange endpoint. Both @supabase/ssr clients in this project
 * default to flowType "pkce", so password-recovery links (and any future
 * magic-link/OAuth flows) land here with a `?code=` param rather than the
 * older `token_hash`+`type` format.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/locations";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    );
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(
      "That link is invalid or has expired."
    )}`
  );
}
