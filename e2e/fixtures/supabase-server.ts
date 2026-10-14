// Fixture build only: stands in for "@/lib/supabase/server". See db.ts.
import { cookies } from "next/headers";
import { query, rpc, storageFrom } from "./db";

export async function createClient() {
  // Signed out, like the proxy stand-in, when the test says so.
  let signedOut = false;
  try {
    signedOut = (await cookies()).has("e2e-signed-out");
  } catch {
    // Outside a request (a script, a test): signed in.
  }
  return {
    auth: {
      getUser: async () => ({ data: { user: signedOut ? null : { id: "u1", email: "stage.manager@example.com" } } }),
    },
    from: (table: string) => query(table),
    rpc: (name: string, args: Record<string, unknown>) => rpc(name, args),
    storage: { from: () => storageFrom() },
  };
}
