import { createClient } from "@/infrastructure/supabase/client";

let client: ReturnType<typeof createClient> | null = null;

/** One browser client per tab. Never call this in UI_MOCK (spec 05 §6.1). */
export const browserSupabase = () => (client ??= createClient());
