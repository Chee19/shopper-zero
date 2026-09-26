import "server-only";
import { after } from "next/server";
import type { ScanReport, StartStoreCrawlFn, Store } from "@/contracts";
import {
  countActiveCrawlRuns, createCrawlRun, getActiveCrawlRun, getLatestCrawlRun, getLatestScanForStore, getStoreById,
  updateStore, upsertStoreForUrl,
} from "@/infrastructure/database";
import { flags, optionalEnv } from "@/shared/env";
import { AppError } from "@/shared/errors";
import { log } from "@/shared/log";
import { normalizeStoreUrl } from "@/shared/slug";
import type { PreferredAdapter, PreferredStrategy } from "./pipeline";
import { crawlStore } from "./run";
import { assertPublicHost } from "./url";

// A queued or running run older than this is dead (02 section 5.11 step 3).
const ACTIVE_WINDOW_MIN = 6;
const CACHE_MS = 6 * 3_600_000;
const SCAN_MAX_AGE_MS = 24 * 3_600_000;
// 02 section 5.9 step 0: platform-API signals first, then Shopify's products.json.
const SIGNAL_ADAPTERS: [string, PreferredAdapter][] = [
  ["woo_store_api", "woocommerce"], ["magento_graphql", "magento"], ["squarespace_json", "squarespace"],
  ["sfcc_product_variation", "sfcc"], ["products_json", "shopify"],
];

// 02 section 5.11: must run inside a request scope because of after().
export const startStoreCrawl: StartStoreCrawlFn = async (rawUrl, opts = {}) => {
  const store = await resolveStore(rawUrl, opts.storeId);
  if (store.opted_out) {
    throw new AppError("forbidden", "The merchant has opted out of ShoperZero.", { reason: "opted_out" });
  }

  // Reused even with force, so a double click never starts two crawls.
  const active = await getActiveCrawlRun(store.id, ACTIVE_WINDOW_MIN);
  if (active) return { store, crawl_run: active, reused: true, cached: true };
  if (!opts.force && recentlyCrawled(store)) {
    const latest = await getLatestCrawlRun(store.id);
    if (latest) return { store, crawl_run: latest, reused: false, cached: true };
  }

  const preferred = await preferredStrategy(store, opts.force ?? false);
  const maxRuns = Number(optionalEnv("CRAWL_MAX_CONCURRENT_RUNS") ?? 3) || 3;
  if ((await countActiveCrawlRuns(ACTIVE_WINDOW_MIN)) >= maxRuns) {
    throw new AppError("rate_limited", "Too many crawls running; retry in 30 s.");
  }

  const run = await createCrawlRun(store.id);
  // Scheduled before the status write so a failed write cannot strand a queued run.
  // after() only starts once the response is done, so the status write still lands first.
  after(() => crawlStore(store.id, run.id, { maxProducts: opts.maxProducts, preferred }));
  log.info("crawl.queued", { store_id: store.id, crawl_run_id: run.id, preferred: preferred?.method ?? null });
  const fresh = await updateStore(store.id, { status: "crawling" });
  return { store: fresh, crawl_run: run, reused: false, cached: false };
};

async function resolveStore(rawUrl: string, storeId: string | undefined): Promise<Store> {
  if (storeId) {
    const store = await getStoreById(storeId);
    if (!store) throw new AppError("not_found", "Store not found");
    return store;
  }
  const allowPrivate = flags.allowPrivateStoreHosts();
  let baseUrl: string;
  try {
    baseUrl = normalizeStoreUrl(rawUrl, { allowPrivate }).base_url;
  } catch {
    throw new AppError("validation_error", "Not a valid store URL", { reason: "invalid_url" });
  }
  await assertPublicHost(baseUrl, allowPrivate);
  return (await upsertStoreForUrl(rawUrl)).store;
}

function recentlyCrawled(store: Store): boolean {
  if (store.status !== "indexed" && store.status !== "blocked") return false;
  return !!store.last_crawled_at && Date.now() - Date.parse(store.last_crawled_at) < CACHE_MS;
}

// 02 section 5.9 step 0: a finished scan under 24 h old decides the method.
// Without one the pipeline runs full detection.
async function preferredStrategy(store: Store, force: boolean): Promise<PreferredStrategy | null> {
  const scan = await getLatestScanForStore(store.id, { status: "done" });
  if (!scan || !(Date.now() - Date.parse(scan.updated_at) < SCAN_MAX_AGE_MS)) return null;
  switch (scan.best_method) {
    case "api":
      return apiStrategy(store, scan);
    case "dom":
      return { method: "dom", recipe: store.dom_recipe, scan_id: scan.id };
    case "computer_use":
      if (force) return null;
      throw new AppError("unprocessable", "This store is reachable by computer use only; there is no catalog to index.");
    case "none":
      if (force) return null;
      throw new AppError("unprocessable", "No agent access method found");
  }
}

function apiStrategy(store: Store, scan: ScanReport): PreferredStrategy {
  const signals = scan.probes.find((p) => p.method === "api")?.signals ?? [];
  const ok = new Set(signals.filter((s) => s.ok).map((s) => s.id));
  const hit = SIGNAL_ADAPTERS.find(([id]) => ok.has(id));
  if (hit) return { method: "api", adapter: hit[1], scan_id: scan.id };
  // Indexing through a merchant's own UCP/MCP is out of scope, so a UCP/MCP-only api store falls back to T2.
  log.info("crawl.start.ucp_only", { store_id: store.id, scan_id: scan.id });
  return { method: "dom", scan_id: scan.id };
}
