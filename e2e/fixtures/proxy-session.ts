// Fixture build only: stands in for "@/lib/supabase/proxy-session". Everyone
// is signed in as the sample theatre's owner unless the request carries an
// `e2e-signed-out` cookie, so the proxy's own redirect rules (signed-out
// people sent to /login, signed-in people bounced off it) still run and can
// be tested both ways.
import { type NextRequest, NextResponse } from "next/server";

export async function refreshSession(request: NextRequest) {
  const signedOut = request.cookies.has("e2e-signed-out");
  return {
    user: signedOut ? null : { id: "u1" },
    response: NextResponse.next({ request }),
  };
}
