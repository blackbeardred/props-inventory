/**
 * The last checklist and production this device had open, so the hexagon menu
 * can offer "back to my checklist" and put the right production first.
 *
 * localStorage, per device, never trusted: it's a convenience, and every value
 * read back is checked for shape. Paths are rebuilt from the stored id rather
 * than stored as text, so nothing read from storage can send anyone off-site.
 */

const CHECKLIST_KEY = "recent:checklist";
const PRODUCTION_KEY = "recent:production";

export type RecentProduction = { id: string; name: string };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function read(key: string): RecentProduction | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null");
    if (
      parsed &&
      typeof parsed.id === "string" &&
      ID.test(parsed.id) &&
      typeof parsed.name === "string"
    ) {
      return { id: parsed.id, name: parsed.name.slice(0, 120) };
    }
  } catch {
    // Unreadable or blocked: no shortcut, nothing broken.
  }
  return null;
}

function write(key: string, value: RecentProduction): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Can't remember it; the menu just won't offer it.
  }
}

export function rememberChecklist(production: RecentProduction): void {
  write(CHECKLIST_KEY, production);
  write(PRODUCTION_KEY, production);
}

export function rememberProduction(production: RecentProduction): void {
  write(PRODUCTION_KEY, production);
}

export function lastChecklist(): RecentProduction | null {
  return read(CHECKLIST_KEY);
}

export function lastProduction(): RecentProduction | null {
  return read(PRODUCTION_KEY);
}

export function checklistHref(production: RecentProduction): string {
  return `/productions/${production.id}/checklist`;
}
