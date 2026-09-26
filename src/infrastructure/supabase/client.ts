import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/infrastructure/database/types.gen";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
