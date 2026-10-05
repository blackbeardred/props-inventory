// Fixture build only: stands in for "@/lib/supabase/client" in the browser.
// The browser's copy of the sample theatre starts fresh on every page load.
import { query, rpc, storageFrom } from "./db";

export function createClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (table: string) => query(table),
    rpc: (name: string, args: Record<string, unknown>) => rpc(name, args),
    storage: { from: () => storageFrom() },
  };
}
