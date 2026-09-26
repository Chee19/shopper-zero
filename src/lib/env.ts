// src/lib/env.ts  (server-only)
import "server-only";
import { AppError } from "@/lib/errors";

export type EnvName =
  | "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" | "SUPABASE_SECRET_KEY"
  | "APP_URL" | "CRAWLER_USER_AGENT" | "CRAWL_MAX_PRODUCTS" | "ALLOW_PRIVATE_STORE_HOSTS" | "LOG_LEVEL"
  | "STRIPE_SECRET_KEY" | "STRIPE_PREVIEW_VERSION"
  | "X402_NETWORK" | "X402_FACILITATOR_URL" | "X402_PAY_TO" | "DEMO_WALLET_PRIVATE_KEY" | "DEMO_WALLET_ENABLED"
  | "WOO_DEMO_URL" | "WOO_CONSUMER_KEY" | "WOO_CONSUMER_SECRET"
  | "CRAWL_TIME_BUDGET_MS" | "CRAWL_MAX_CONCURRENT_RUNS" | "CRAWL_TIERS"
  | "ANTHROPIC_API_KEY" | "SCAN_MODEL" | "SCAN_MAX_CONCURRENT" | "SCAN_CU_ENABLED" | "SCAN_CU_MAX_STEPS"
  | "BROWSERBASE_API_KEY" | "BROWSERBASE_PROJECT_ID" | "JS_SHOP_FIXTURE_URL"
  | "STRIPE_SPT_MODE" | "X402_FLOW" | "DEMO_WALLET_MAX_USD" | "DEMO_WALLET_TOKEN"
  | "CHECKOUT_ALLOWED_DOMAINS" | "CHECKOUT_BROWSER_ENABLED" | "CHECKOUT_BROWSER_HOSTS" | "CHECKOUT_FORCE_HANDOFF"
  | "NEXT_PUBLIC_UI_MOCK"
  | "OPENAI_API_KEY" | "FIRECRAWL_API_KEY" | "CRON_SECRET";

/** Read lazily (never at module top level) so `next build` works without secrets. */
export function optionalEnv(name: EnvName): string | undefined {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? undefined : v.trim();
}

/** Throws AppError("not_implemented") naming the missing variable; the feature degrades, the app does not crash. */
export function requireEnv(name: EnvName): string {
  const v = optionalEnv(name);
  if (!v) throw new AppError("not_implemented", `Server is missing ${name}`);
  return v;
}

/** Public base URL, no trailing slash. APP_URL > Vercel production URL > localhost. */
export function appUrl(): string {
  const explicit = optionalEnv("APP_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export const flags = {
  demoWalletEnabled: () => optionalEnv("DEMO_WALLET_ENABLED") === "true",
  allowPrivateStoreHosts: () => optionalEnv("ALLOW_PRIVATE_STORE_HOSTS") === "true",
  crawlMaxProducts: () => Number(optionalEnv("CRAWL_MAX_PRODUCTS") ?? 150) || 150,
  crawlerUserAgent: () =>
    optionalEnv("CRAWLER_USER_AGENT") ?? `ShoperZeroBot/0.1 (+${appUrl()}/bot)`,
  scanCuEnabled: () => (optionalEnv("SCAN_CU_ENABLED") ?? "1") !== "0",
  scanCuMaxSteps: () => Math.min(Number(optionalEnv("SCAN_CU_MAX_STEPS") ?? 15) || 15, 15),
};
