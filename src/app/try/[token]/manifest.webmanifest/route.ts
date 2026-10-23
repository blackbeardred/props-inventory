import manifest from "@/app/manifest";

/**
 * The manifest a tryout link's page points to, so a tester who adds the link
 * to their home screen gets an app that opens their test copy.
 *
 * The site's own manifest starts at /inventory. For someone with no account
 * that's a dead end: on an iPhone a home-screen app keeps its own cookies,
 * apart from Safari's, so it starts signed out, and /inventory sends it to a
 * log-in page they have no password for. Starting at the link instead
 * (?open=1) signs them back into their copy on its own; see the page.
 *
 * Its own id, so it installs as a separate app from Propolis proper.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{32}$/.test(token)) return new Response("Not found", { status: 404 });
  const base = manifest();
  return Response.json(
    { ...base, id: `/try/${token}`, start_url: `/try/${token}?open=1`, shortcuts: undefined },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } }
  );
}
