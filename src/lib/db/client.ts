// src/lib/db/client.ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "./types.gen";

let client: SupabaseClient<Database> | null = null;
/** Memoized service-role client (no session, bypasses RLS). Server code only. */
export function db(): SupabaseClient<Database> {
  return (client ??= createAdminClient());
}
