import "server-only";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { flags, optionalEnv } from "@/shared/env";
import { log } from "@/shared/log";
import { installGuards, type GuardOptions, type GuardState } from "./browser-guard";

export interface BrowserHandle {
  page: Page;
  context: BrowserContext;
  provider: "browserbase" | "local";
  costUsdPerMinute: number; // Browserbase Developer overage $0.12/h; local is free
  guard: GuardState;
  close(): Promise<void>;
}

export const VIEWPORT = { width: 1280, height: 800 };

// connectOverCDP errors echo the connect URL, whose query carries the Browserbase signingKey.
export const redactUrlQueries = (msg: string): string => msg.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>]*)[?#][^\s"'<>]*/gi, "$1");

// Browser libraries load on first use: importing playwright-core at module load crashes every route that
// imports the scan feature when its data files are missing from a serverless bundle.
async function launch(): Promise<{ browser: Browser; provider: BrowserHandle["provider"] } | null> {
  const apiKey = optionalEnv("BROWSERBASE_API_KEY");
  const projectId = optionalEnv("BROWSERBASE_PROJECT_ID");
  if (!(apiKey && projectId) && process.env.VERCEL) return null; // no Chromium inside a Vercel function
  const { chromium } = await import("playwright-core");
  if (apiKey && projectId) {
    const { default: Browserbase } = await import("@browserbasehq/sdk");
    // Browserbase solves captchas by default; we never bypass bot walls.
    const session = await new Browserbase({ apiKey }).sessions.create({
      projectId, browserSettings: { solveCaptchas: false, viewport: VIEWPORT },
    });
    return { browser: await chromium.connectOverCDP(session.connectUrl, { timeout: 15_000 }), provider: "browserbase" };
  }
  return { browser: await chromium.launch({ headless: true, timeout: 15_000 }), provider: "local" };
}

// Returns null when no browser can be had; a launch failure is logged and also returns null.
export async function openBrowser(opts: GuardOptions): Promise<BrowserHandle | null> {
  let launched: Awaited<ReturnType<typeof launch>> = null;
  try {
    launched = await launch();
    if (!launched) return null;
    const { browser, provider } = launched;
    const context = browser.contexts()[0]
      ?? await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, serviceWorkers: "block" });
    const page = context.pages()[0] ?? await context.newPage();
    await page.setViewportSize(VIEWPORT);
    await context.setExtraHTTPHeaders({ "X-ShoperZero-Scan": flags.crawlerUserAgent() });
    // New tabs and popups would escape the page guards.
    context.on("page", (p) => {
      if (p !== page) void p.close().catch(() => {});
    });
    const guard = await installGuards(page, opts);
    return {
      page, context, provider, guard,
      costUsdPerMinute: provider === "browserbase" ? 0.002 : 0,
      close: () => browser.close().catch(() => {}),
    };
  } catch (e) {
    log.warn("scan.browser.open_failed", { provider: launched?.provider, err: redactUrlQueries(e instanceof Error ? e.message : String(e)) });
    await launched?.browser.close().catch(() => {});
    return null;
  }
}
