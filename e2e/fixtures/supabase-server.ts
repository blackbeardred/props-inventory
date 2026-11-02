// Fixture build only: stands in for "@/lib/supabase/server". See db.ts.
import { cookies } from "next/headers";
import { query, rpc, storageFrom } from "./db";

export async function createClient() {
  // Signed out, like the proxy stand-in, when the test says so; signed in
  // without an account (a tryout link, migration 013) with e2e-anonymous.
  let signedOut = false;
  let anonymous = false;
  try {
    const jar = await cookies();
    signedOut = jar.has("e2e-signed-out");
    anonymous = jar.has("e2e-anonymous");
  } catch {
    // Outside a request (a script, a test): signed in.
  }
  return {
    auth: {
      getUser: async () => ({
        data: {
          user: signedOut
            ? null
            : anonymous
              ? { id: "u1", email: null, is_anonymous: true }
              : { id: "u1", email: "stage.manager@example.com", is_anonymous: false },
        },
      }),
      signOut: async () => {
        const jar = await cookies();
        jar.delete("e2e-anonymous");
        jar.set("e2e-signed-out", "1", { path: "/" });
        signedOut = true;
        return { error: null };
      },
      signInAnonymously: async () => {
        const jar = await cookies();
        if (jar.has("e2e-no-anonymous")) {
          return { data: null, error: { message: "Anonymous sign-ins are disabled" } };
        }
        jar.delete("e2e-signed-out");
        jar.set("e2e-anonymous", "1", { path: "/" });
        signedOut = false;
        anonymous = true;
        return { data: { user: { id: "u1", is_anonymous: true } }, error: null };
      },
    },
    from: (table: string) => query(table),
    rpc: (name: string, args: Record<string, unknown>) => rpc(name, args),
    storage: { from: () => storageFrom() },
  };
}
