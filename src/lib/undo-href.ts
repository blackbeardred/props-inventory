/**
 * Where to land after a delete: the page it happened from, carrying what the
 * Undo bar needs (src/components/deleted-bar.tsx) — the Recently Deleted
 * record and the name to show.
 */
export function withUndo(path: string, recordId: string, name: string): string {
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}deleted=${encodeURIComponent(recordId)}&deletedName=${encodeURIComponent(name)}`;
}
