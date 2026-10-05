// Fixture build only: stands in for "@/lib/supabase/server". See db.ts.
import { query, rpc, storageFrom } from "./db";

export async function createClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "u1", email: "stage.manager@example.com" } } }),
    },
    from: (table: string) => query(table),
    rpc: (name: string, args: Record<string, unknown>) => rpc(name, args),
    storage: { from: () => storageFrom() },
  };
}
