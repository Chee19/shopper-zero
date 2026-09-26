import "server-only";
import type {
  CrawlContext, CrawlLogEntry, CrawlStep, DomRecipe, ExtractionSource, NormalizedProduct, Platform, PlatformAdapter, Store,
} from "@/contracts";
import { collisionHandle } from "@/infrastructure/database";
import { flags } from "@/shared/env";
import { adapters } from "./adapters";
import { detectPlatform, type DetectionResult } from "./detect";
import { AdapterError } from "./errors";
import { createFetcher, type Fetcher, type FetchResult } from "./fetch";
import { extractJsonLdProduct } from "./jsonld";
import { modeCurrency } from "./normalize";
import { loadRobots, type RobotsInfo } from "./robots";
import { discoverProductUrls } from "./sitemap";
import { assertPublicHost, storeTarget, type StoreTarget } from "./url";

export interface PipelineInput {
  store: Store;
  maxProducts: number;
  deadline: number;
  tiers?: ExtractionSource[];
  preferred?: PreferredStrategy | null;
}
export type PreferredAdapter = "woocommerce" | "magento" | "squarespace" | "sfcc" | "shopify";
export interface PreferredStrategy {
  method: "api" | "dom";
  adapter?: PreferredAdapter;
  recipe?: DomRecipe | null;
  scan_id: string;
}
export type PipelineLogEntry = Omit<CrawlLogEntry, "at" | "step"> & { step: CrawlStep };
export interface PipelineHooks {
  log(e: PipelineLogEntry): void;
  onDetection?(d: DetectionResult, target: StoreTarget): Promise<void> | void;
  onStrategy?(s: StrategyLock): Promise<void> | void;
  onProduct(p: NormalizedProduct): Promise<void> | void;
  onPage?(ok: boolean): void;
}
export interface StrategyLock {
  tier: ExtractionSource;
  adapter?: Platform;
  sampled_at: string;
  sample: { tried: number; ok: number };
  partial?: boolean;
  from_scan_id?: string;
}
export type StopReason = "done" | "max_products" | "time_budget" | "blocked" | "error";
export interface PipelineResult {
  status: "succeeded" | "failed" | "blocked";
  stoppedBy: StopReason;
  error: string | null;
  target: StoreTarget;
  detection: DetectionResult | null;
  strategy: StrategyLock | null;
  productsEmitted: number;
  pagesFetched: number;
  pagesFailed: number;
  currency: string | null;
  siteName: string | null;
}

export const strategyLabel = (s: StrategyLock): string =>
  s.tier === "platform_api" && s.adapter ? `platform_api:${s.adapter}` : s.tier;

const DEFAULT_TIERS: ExtractionSource[] = ["platform_api", "jsonld"];
const LOCK_MIN = 3;
const ADAPTER_PROBE_MIN = 0.5;
// Workers only bound what is in flight when we stop; the fetcher's per-host queue sets the rate.
const PAGE_WORKERS = 4;
// Directive-level match so "max-image-preview:none" does not count.
const NO_AI = /(?:^|,)\s*(?:(?!max-)[\w-]+:\s*)?(?:noai|none)\s*(?=,|$)/i;

interface Run {
  input: PipelineInput;
  hooks: PipelineHooks;
  tiers: ExtractionSource[];
  target: StoreTarget;
  fetcher: Fetcher;
  detection: DetectionResult | null;
  strategy: StrategyLock | null;
  emitted: NormalizedProduct[];
  handles: Map<string, string>;
  misses: Record<string, number>;
  pagesFetched: number;
  pagesFailed: number;
  defaultCurrency: string | null;
}
interface Page { url: string; res: FetchResult; skip: string | null }

// Ends the run from any step; runPipeline turns it into the result.
class Stop extends Error {
  constructor(readonly by: StopReason, readonly reason: string | null = null) {
    super(reason ?? by);
  }
}

export async function runPipeline(input: PipelineInput, hooks: PipelineHooks): Promise<PipelineResult> {
  const run: Run = {
    input, hooks,
    tiers: input.tiers ?? DEFAULT_TIERS,
    target: storeTarget(input.store),
    fetcher: createFetcher({ deadline: input.deadline, userAgent: flags.crawlerUserAgent() }),
    detection: null, strategy: null, emitted: [], handles: new Map(), misses: {},
    pagesFetched: 0, pagesFailed: 0,
    defaultCurrency: input.store.currency,
  };
  try {
    return finish(run, await crawl(run), null);
  } catch (err) {
    if (err instanceof Stop) return finish(run, err.by, err.reason);
    return finish(run, "error", err instanceof Error ? err.message : String(err));
  }
}

async function crawl(run: Run): Promise<StopReason> {
  if (timeUp(run)) throw new Stop("time_budget");
  await assertPublicHost(run.target.origin, flags.allowPrivateStoreHosts());
  const loaded = await readRobots(run);
  const d = await detect(run);
  // detectPlatform reloads robots.txt when the homepage redirected to another origin.
  const robots = run.fetcher.robots && run.fetcher.robots !== loaded ? reportRobots(run, run.fetcher.robots) : loaded;
  const adapter = await chooseAdapter(run, d);
  await run.hooks.onDetection?.(d, run.target);
  const stop = adapter ? await drainAdapter(run, adapter, d) : null;
  return stop ?? crawlPages(run, robots, d);
}

async function readRobots(run: Run): Promise<RobotsInfo> {
  return reportRobots(run, await loadRobots(run.fetcher, run.target.origin));
}

function reportRobots(run: Run, robots: RobotsInfo): RobotsInfo {
  const delay = robots.crawlDelaySec ? `, crawl-delay ${robots.crawlDelaySec}s` : "";
  run.hooks.log({
    level: "info", step: "robots", msg: `robots.txt HTTP ${robots.status}${delay}`,
    data: { url: robots.url, crawl_delay: robots.crawlDelaySec, content_signal: robots.contentSignal, sitemaps: robots.sitemaps.length },
  });
  if (robots.blocksUs) throw new Stop("blocked", `blocked:${robots.blocksUs}`);
  return robots;
}

async function detect(run: Run): Promise<DetectionResult> {
  const d = await detectPlatform(run.fetcher, run.target);
  run.detection = d;
  if (d.blocked === "deadline") throw new Stop("time_budget");
  if (d.blocked === "challenge" || d.blocked === "forbidden" || d.blocked === "robots" || d.blocked === "content_signal") throw new Stop("blocked", `blocked:${d.blocked}`);
  if (d.blocked) throw new Stop("error", `homepage_${d.blocked}`);
  run.hooks.log({
    level: "info", step: "detect", msg: `Detected ${d.platform}${d.hint ? ` (${d.hint})` : ""}`,
    data: { platform: d.platform, confidence: d.confidence, signals: d.signals },
  });
  return d;
}

// Step 0: a fresh scan's method overrides the fingerprint verdict.
async function chooseAdapter(run: Run, d: DetectionResult): Promise<PlatformAdapter | null> {
  const { preferred } = run.input;
  if (!run.tiers.includes("platform_api")) return null;
  if (!preferred) return d.adapter;
  const note = (level: "info" | "warn", msg: string) =>
    run.hooks.log({ level, step: "detect", msg: `Scan ${preferred.scan_id}: ${msg}`, data: { scan_id: preferred.scan_id } });
  if (preferred.method === "dom") {
    note("info", "DOM access, skipping the platform API");
    return null;
  }
  const named = preferred.adapter ? adapters[preferred.adapter] : undefined;
  if (!named) {
    note("warn", `no ${preferred.adapter ?? "platform"} adapter yet; falling back to sitemap+JSON-LD`);
    return null;
  }
  const confidence = await named.detect(adapterContext(run, d)).catch(() => 0);
  if (confidence < ADAPTER_PROBE_MIN) {
    note("warn", `${named.platform} API probe failed; falling back to sitemap+JSON-LD`);
    return null;
  }
  Object.assign(d, { platform: named.platform, confidence, adapter: named });
  d.signals.push(`scan:${preferred.scan_id}`);
  note("info", `using the ${named.platform} API`);
  return named;
}

function adapterContext(run: Run, d: DetectionResult): CrawlContext {
  return {
    domain: run.input.store.domain,
    baseUrl: run.target.baseUrl,
    homepageHtml: d.homepage.html,
    headers: d.homepage.headers,
    fetch: run.fetcher.asFetch(),
    log: (e) => run.hooks.log({ ...e, step: "extract" }),
    signal: AbortSignal.timeout(Math.max(0, run.input.deadline - Date.now())),
  };
}

// T0: the first product proves the API works; any failure before it falls back to T2.
async function drainAdapter(run: Run, adapter: PlatformAdapter, d: DetectionResult): Promise<StopReason | null> {
  let n = 0;
  try {
    for await (const product of adapter.listProducts(adapterContext(run, d), { max: run.input.maxProducts })) {
      if (n++ === 0) await lock(run, { tier: "platform_api", adapter: adapter.platform, sample: { tried: 1, ok: 1 } });
      await emit(run, product);
      if (full(run)) return "max_products";
      if (timeUp(run)) return "time_budget";
    }
  } catch (err) {
    if (n > 0) throw err;
    fallBack(run, adapter, err);
    return null;
  }
  if (n === 0) {
    fallBack(run, adapter, "no products");
    return null;
  }
  return timeUp(run) ? "time_budget" : "done";
}

function fallBack(run: Run, adapter: PlatformAdapter, cause: unknown): void {
  const status = cause instanceof AdapterError ? cause.httpStatus || cause.reason : cause instanceof Error ? cause.message : String(cause);
  run.hooks.log({
    level: "warn", step: "extract", msg: `platform API unavailable (${status}); falling back to sitemap+JSON-LD`,
    data: { platform: adapter.platform },
  });
}

// T2: discover, sample 5 pages to lock the tier, then extract the rest.
async function crawlPages(run: Run, robots: RobotsInfo, d: DetectionResult): Promise<StopReason> {
  // ponytail: jsonld is the only T2 tier built (R9), so there is nothing to escalate to; add a cheapest-first tier list with one-step escalation when a second tier lands.
  if (!run.tiers.includes("jsonld")) throw new Stop("error", "no_extraction_tier");
  const urls = await discover(run, robots, d);
  const sampled = await sample(run, urls);
  return extractRest(run, urls.filter((u) => !sampled.has(u)));
}

async function discover(run: Run, robots: RobotsInfo, d: DetectionResult): Promise<string[]> {
  if (timeUp(run)) throw new Stop("time_budget");
  const disc = await discoverProductUrls(run.fetcher, run.target, robots, {
    platform: d.platform, hint: d.hint, max: Math.min(run.input.maxProducts * 4, 5000), homepageHtml: d.homepage.html,
  });
  run.hooks.log({
    level: "info", step: "discover", msg: `Found ${disc.urls.length} product URLs via ${disc.source}`,
    data: { source: disc.source, sitemaps: disc.sitemapsFetched.length, product_sitemap: disc.productSitemapFound },
  });
  if (timeUp(run)) throw new Stop("time_budget");
  if (!disc.urls.length) throw new Stop("error", "no_product_urls");
  return disc.urls.map((u) => u.loc);
}

async function sample(run: Run, urls: string[]): Promise<Set<string>> {
  const n = urls.length;
  const picked = [...new Set([0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1])].map((i) => urls[i]);
  const pages = await Promise.all(picked.map((u) => fetchPage(run, u)));
  if (pages.some((p) => p.skip === "deadline")) throw new Stop("time_budget");
  const products = pages.map((p) => readPage(run, p));
  const ok = products.filter(Boolean).length;
  const bar = pages.length >= 5 ? LOCK_MIN : Math.ceil(0.6 * pages.length);
  run.hooks.log({
    level: ok ? "info" : "warn", step: "extract", msg: `JSON-LD on ${ok}/${pages.length} sampled pages`,
    data: { sample: { tried: pages.length, ok }, misses: { ...run.misses }, total_estimate: Math.min(run.input.maxProducts, n) },
  });
  if (!ok) {
    if (pages.filter(isChallenged).length >= 3) throw new Stop("blocked", "blocked:challenge");
    throw new Stop("error", "no_structured_data");
  }
  await lock(run, { tier: "jsonld", sample: { tried: pages.length, ok }, ...(ok < bar ? { partial: true } : {}) });
  for (const p of products) if (p) await emit(run, p);
  return new Set(picked);
}

async function extractRest(run: Run, urls: string[]): Promise<StopReason> {
  const s: { next: number; checked: number; challenged: number; stop: StopReason | null; failure: unknown } =
    { next: 0, checked: 0, challenged: 0, stop: null, failure: null };
  const worker = async () => {
    try {
      while (!s.stop && s.next < urls.length) {
        if (full(run)) {
          s.stop = "max_products";
          break;
        }
        const page = await fetchPage(run, urls[s.next++]);
        if (page.skip === "deadline") {
          s.stop ??= "time_budget";
          break;
        }
        // Another worker hit the cap while this fetch was in flight; drop the page uncounted.
        if (full(run)) break;
        // Circuit breaker (02 5.2 item 12): 5 of the first 10 non-sample fetches challenged.
        if (s.checked < 10) {
          s.checked++;
          if (isChallenged(page) && ++s.challenged >= 5) {
            s.stop ??= "blocked";
            break;
          }
        }
        const product = readPage(run, page);
        if (product) await emit(run, product);
      }
    } catch (err) {
      s.failure ??= err;
      s.stop = "error";
    }
  };
  await Promise.all(Array.from({ length: PAGE_WORKERS }, worker));
  if (s.failure) throw s.failure;
  if (s.stop === "blocked") throw new Stop("blocked", "blocked:challenge");
  return s.stop ?? (full(run) ? "max_products" : "done");
}

async function fetchPage(run: Run, url: string): Promise<Page> {
  const res = await run.fetcher.get(url, { kind: "html" });
  const robotsTag = res.headers.get("x-robots-tag") ?? "";
  const skip = res.blocked ?? (!res.ok ? `http_${res.status}` : NO_AI.test(robotsTag) ? "noai" : null);
  if (skip === "noai") run.hooks.log({ level: "info", step: "extract", msg: `Skipped ${url}: X-Robots-Tag ${robotsTag}` });
  return { url, res, skip };
}

const isChallenged = (p: Page) => p.res.blocked === "challenge" || p.res.blocked === "forbidden";

// Every fetched PDP is reported once through onPage; a page without a product counts as failed.
function readPage(run: Run, page: Page): NormalizedProduct | null {
  let product: NormalizedProduct | null = null;
  let miss = page.skip;
  if (!miss) {
    const r = extractJsonLdProduct(page.res.body, page.res.finalUrl, {
      defaultCurrency: run.defaultCurrency, checkedAt: new Date().toISOString(), baseUrl: run.target.baseUrl,
    });
    product = r.product;
    miss = r.miss;
  }
  if (miss) run.misses[miss] = (run.misses[miss] ?? 0) + 1;
  run.pagesFetched++;
  if (!product) run.pagesFailed++;
  run.hooks.onPage?.(product !== null);
  return product;
}

async function lock(run: Run, s: Omit<StrategyLock, "sampled_at" | "from_scan_id">): Promise<void> {
  const scanId = run.input.preferred?.scan_id;
  run.strategy = { ...s, sampled_at: new Date().toISOString(), ...(scanId ? { from_scan_id: scanId } : {}) };
  run.hooks.log({
    level: "info", step: "extract", msg: `Strategy ${strategyLabel(run.strategy)}${s.partial ? " (partial)" : ""}`,
    data: { strategy: run.strategy },
  });
  await run.hooks.onStrategy?.(run.strategy);
}

async function emit(run: Run, product: NormalizedProduct): Promise<void> {
  // The 5 sampled products can exceed a small maxProducts.
  if (full(run)) return;
  const owner = run.handles.get(product.handle);
  // Same scheme as the DB writer (DECISIONS C10); 248 keeps "-" plus the 6-char hash within the 255-char handle limit.
  const p = owner !== undefined && owner !== product.url
    ? { ...product, handle: collisionHandle(product.handle.slice(0, 248), product.url) }
    : product;
  run.handles.set(p.handle, p.url);
  run.emitted.push(p);
  if (run.emitted.length >= 3) run.defaultCurrency = modeCurrency(run.emitted) ?? run.defaultCurrency;
  await run.hooks.onProduct(p);
}

const full = (run: Run) => run.emitted.length >= run.input.maxProducts;
// Same 2 s margin at which the fetcher stops issuing requests.
const timeUp = (run: Run) => Date.now() > run.input.deadline - 2000;

function finish(run: Run, stoppedBy: StopReason, error: string | null): PipelineResult {
  const productsEmitted = run.emitted.length;
  const status = productsEmitted > 0 ? "succeeded" : stoppedBy === "blocked" ? "blocked" : "failed";
  const err = error ?? (status === "succeeded" ? null : stoppedBy);
  const data = { products: productsEmitted, pages_fetched: run.pagesFetched, pages_failed: run.pagesFailed, misses: run.misses };
  if (status === "succeeded") {
    const why = err ? `${stoppedBy}: ${err}` : stoppedBy;
    run.hooks.log({ level: err ? "warn" : "info", step: "extract", msg: `Extracted ${productsEmitted} products (${why})`, data });
  } else {
    run.hooks.log({ level: "error", step: "error", msg: err ?? stoppedBy, data });
  }
  return {
    status, stoppedBy, error: err,
    target: run.target, detection: run.detection, strategy: run.strategy,
    productsEmitted, pagesFetched: run.pagesFetched, pagesFailed: run.pagesFailed,
    currency: modeCurrency(run.emitted),
    siteName: run.detection?.siteName ?? null,
  };
}
