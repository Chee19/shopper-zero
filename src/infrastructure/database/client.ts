// src/infrastructure/database/client.ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/infrastructure/supabase/admin";
import type { Database } from "@/infrastructure/database/types.gen";

let client: SupabaseClient<Database> | null = null;
/** Memoized service-role client (no session, bypasses RLS). Server code only. */
export function db(): SupabaseClient<Database> {
  return (client ??= createAdminClient());
}
