/**
 * Whether the two NEXT_PUBLIC_SUPABASE_* variables are present.
 *
 * The list pages use this to show a "connect Supabase" note instead of
 * crashing when `.env.local` hasn't been filled in yet (Day 1, step 3).
 */
export const supabaseConfigured =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
