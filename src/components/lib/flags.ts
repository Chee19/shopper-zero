/** NEXT_PUBLIC_UI_MOCK=1: everything from fixtures, no Supabase client is ever constructed (spec 05 §6.1). Inlined at build time. */
export const UI_MOCK = process.env.NEXT_PUBLIC_UI_MOCK === "1";

/** True when the browser can build a Supabase client (Realtime + public reads). */
export const HAS_SUPABASE_ENV = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

export const SCAN_ID_RE = /^[0-9a-f-]{36}$/i;
export const REPLAY_ID_RE = /^replay-[a-z0-9-]{1,40}$/;
export const isReplayId = (id: string) => REPLAY_ID_RE.test(id);
