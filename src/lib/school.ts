/**
 * School theaters (migration 018): one account, the teacher's.
 *
 * The rule itself lives in the database (a trigger on memberships, and the
 * school functions). This file holds the small pieces the pages share: the
 * handover link's shape, how long it lasts, and the words for who has to
 * be removed before a theater can become a school.
 */

/** What the database says when a second account tries to join a school. */
export const ONE_ACCOUNT = "School theatres have one account, the teacher's.";

/** A handover link lasts this long (the table's default, in 018). */
export const HANDOVER_DAYS = 7;

/** 32 hex characters, as create_school_handover() makes them. */
export function isHandoverToken(token: string): boolean {
  return /^[0-9a-f]{32}$/.test(token);
}

export function handoverPath(token: string): string {
  return `/handover/${token}`;
}

/** When a link made at `from` stops working. */
export function handoverExpires(from: Date): Date {
  return new Date(from.getTime() + HANDOVER_DAYS * 24 * 60 * 60 * 1000);
}

/** "Pat", "Pat and Jo", "Pat, Jo and Sam". */
export function listNames(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? "";
  return `${clean.slice(0, -1).join(", ")} and ${clean.at(-1)}`;
}

/** Everyone but the person asking: who has to go before it can be a school. */
export function othersToRemove(
  members: { user_id: string; profiles: { full_name: string | null } | null }[],
  selfId: string
): string[] {
  return members
    .filter((m) => m.user_id !== selfId)
    .map((m) => m.profiles?.full_name?.trim() || "Unnamed member");
}

/**
 * Where to go after logging in or signing up: a path on this site, or the
 * fallback. "//elsewhere.com" and "/\elsewhere.com" are addresses on other
 * sites as far as a browser is concerned, so they're refused too.
 */
export function safeNext(raw: unknown, fallback: string): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

/**
 * The function isn't there: migration 018 hasn't been run. PostgREST says
 * PGRST202 when it can't find a function, or a function with that argument.
 */
export function schoolNotSetUp(error: { code?: string; message: string } | null): boolean {
  return Boolean(error && (error.code === "PGRST202" || /could not find the function/i.test(error.message)));
}

export const NOT_SET_UP =
  "School theaters aren’t switched on yet: run migration 018 (018_school_theatres.sql) in Supabase, then try again.";
