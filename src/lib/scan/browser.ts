import "server-only";
import Browserbase from "@browserbasehq/sdk";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { flags, optionalEnv } from "@/lib/env";
import { log } from "@/lib/log";
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

async function launch(): Promise<{ browser: Browser; provider: BrowserHandle["provider"] } | null> {
  const apiKey = optionalEnv("BROWSERBASE_API_KEY");
  const projectId = optionalEnv("BROWSERBASE_PROJECT_ID");
  if (apiKey && projectId) {
    // Browserbase solves captchas by default; we never bypass bot walls.
    const session = await new Browserbase({ apiKey }).sessions.create({
      projectId, browserSettings: { solveCaptchas: false, viewport: VIEWPORT },
    });
    return { browser: await chromium.connectOverCDP(session.connectUrl, { timeout: 15_000 }), provider: "browserbase" };
  }
  // Chromium cannot run inside a Vercel function (bundle size, cold start).
  if (process.env.VERCEL) return null;
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
    log.warn("scan.browser.open_failed", { provider: launched?.provider, err: e instanceof Error ? e.message : String(e) });
    await launched?.browser.close().catch(() => {});
    return null;
  }
}
