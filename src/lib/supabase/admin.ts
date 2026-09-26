import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role client for crawlers, indexers and background jobs. Bypasses RLS.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
