import "server-only";

export { UI_MOCK } from "@/components/lib/flags";

// Fallback until WS1's `appUrl` from "@/lib/env" lands on main (spec 05 §6.1).
export function appUrl(): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export function crawlerUserAgent(): string {
  return process.env.CRAWLER_USER_AGENT?.trim() || `ShoperZeroBot/0.1 (+${appUrl()}/bot)`;
}
