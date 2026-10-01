// Where this app is being served from, as an absolute URL.
//
// Needed wherever a link has to survive leaving the browser: a password reset
// email, and a QR code printed on a box. Derived from the request rather than
// configured, so preview deployments send people to themselves instead of to
// production.

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"];

export function isLocalHost(host: string): boolean {
  const name = host.split(":")[0];
  return LOCAL_HOSTS.includes(name) || name.endsWith(".local");
}

/** "https://props.example.org" — no trailing slash. */
export function originFromHost(host: string | null): string {
  const resolved = host ?? "localhost:3000";
  const protocol = isLocalHost(resolved) ? "http" : "https";
  return `${protocol}://${resolved}`;
}
