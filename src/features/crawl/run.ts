import "server-only";
import type { CrawlRun, ExtractionSource, NormalizedProduct, Store } from "@/contracts";
import { EXTRACTION_SOURCES } from "@/contracts";
import {
  claimCrawlRun, getCrawlRun, getIndexStats, getStoreById, setStoreReadiness, updateCrawlRun, updateStore, upsertScan,
  upsertStoreProducts,
  type CrawlRunPatch,
} from "@/infrastructure/database";
import { flags, optionalEnv } from "@/shared/env";
import { log } from "@/shared/log";
import { computeReadiness } from "@/features/readiness";
import { shortHash } from "@/shared/slug";
import { resolveCheckoutConnector } from "./checkout-connector";
import {
  runPipeline, strategyLabel, type PipelineHooks, type PipelineInput, type PipelineResult, type PreferredStrategy,
} from "./pipeline";
import { ProgressWriter } from "./progress";

// Superset of CrawlStoreFn's opts: startStoreCrawl passes the scan's preferred method through here.
export interface CrawlStoreOpts { maxProducts?: number; preferred?: PreferredStrategy | null }

const MAX_PRODUCTS_CAP = 500;
const DEFAULT_BUDGET_MS = 240_000;
const BATCH_SIZE = 10;
const MAX_FAILED_BATCHES = 3;
// Products upsert on (store_id, url), so a unique violation for a product means another row owns its handle.
const HANDLE_COLLISION = /handle|23505|duplicate key|unique/i;

type Upserted = Awaited<ReturnType<typeof upsertStoreProducts>>;
type RunStatus = "succeeded" | "failed";
interface Outcome { status: RunStatus; error: string | null }

interface Crawl {
  runId: string;
  store: Store;
  progress: ProgressWriter;
  seenAt: string;
  buffer: NormalizedProduct[];
  chain: Promise<void>;
  failedBatches: number;
  abort: string | null;
}

// 02 section 5.10: never throws, and once the run is claimed it always ends succeeded or failed.
export async function crawlStore(storeId: string, crawlRunId: string, opts: CrawlStoreOpts = {}): Promise<CrawlRun> {
  let start: Awaited<ReturnType<typeof loadAndClaim>>;
  try {
    start = await loadAndClaim(storeId, crawlRunId);
  } catch (err) {
    log.error("crawl.run.claim_failed", err, { store_id: storeId, crawl_run_id: crawlRunId });
    return syntheticRun(storeId, crawlRunId, { error: errorText(err) });
  }
  if ("done" in start) return start.done;

  const c: Crawl = {
    runId: crawlRunId, store: start.store, progress: new ProgressWriter(crawlRunId), seenAt: new Date().toISOString(),
    buffer: [], chain: Promise.resolve(), failedBatches: 0, abort: null,
  };
  if (c.store.opted_out) return closeRun(c, "failed", "opted_out", "The merchant has opted out of ShoperZero.");

  let result: PipelineResult | null = null;
  let crash: string | null = null;
  try {
    const input = pipelineInput(c.store, opts);
    log.info("crawl.run.start", { ...ids(c), max_products: input.maxProducts, preferred: input.preferred?.method ?? null });
    result = await runPipeline(input, hooks(c));
  } catch (err) {
    crash = errorText(err);
  }
  return finalize(c, result, crash);
}

async function loadAndClaim(storeId: string, runId: string): Promise<{ store: Store } | { done: CrawlRun }> {
  const fields = { store_id: storeId, crawl_run_id: runId };
  const store = await getStoreById(storeId);
  if (!store) {
    log.warn("crawl.run.store_missing", fields);
    return { done: syntheticRun(storeId, runId, { error: "store_not_found" }) };
  }
  if (!(await claimCrawlRun(runId))) {
    log.info("crawl.run.already_claimed", fields);
    return { done: (await getCrawlRun(runId)) ?? syntheticRun(storeId, runId, { error: "crawl_run_not_found" }) };
  }
  return { store };
}

function pipelineInput(store: Store, opts: CrawlStoreOpts): PipelineInput {
  const budget = Number(optionalEnv("CRAWL_TIME_BUDGET_MS")) || DEFAULT_BUDGET_MS;
  return {
    store,
    maxProducts: Math.min(opts.maxProducts ?? flags.crawlMaxProducts(), MAX_PRODUCTS_CAP),
    deadline: Date.now() + budget,
    tiers: crawlTiers(),
    preferred: opts.preferred ?? null,
  };
}

function crawlTiers(): ExtractionSource[] | undefined {
  const tiers = (optionalEnv("CRAWL_TIERS") ?? "").split(",").map((s) => s.trim())
    .filter((s): s is ExtractionSource => (EXTRACTION_SOURCES as readonly string[]).includes(s));
  return tiers.length ? tiers : undefined;
}

// Hook writes are best effort: finalize rewrites platform and strategy, so a failed write must not kill the crawl.
function hooks(c: Crawl): PipelineHooks {
  return {
    log: (e) => c.progress.log(e),
    onDetection: (d, target) => bestEffort(c, "detection", async () => {
      const redirected = target.baseUrl !== c.store.base_url.replace(/\/+$/, "");
      c.store = await updateStore(c.store.id, {
        platform: d.platform,
        metadata: {
          detection: { confidence: d.confidence, signals: d.signals }, platform_hint: d.hint, site_name: d.siteName,
        },
        ...(redirected ? { base_url: target.baseUrl } : {}),
      });
    }),
    onStrategy: (s) => {
      c.progress.setStrategy(strategyLabel(s));
      return bestEffort(c, "strategy", async () => {
        c.store = await updateStore(c.store.id, { strategy: s });
      });
    },
    onProduct: (p) => addProduct(c, p),
    onPage: (ok) => c.progress.add({ pages_fetched: 1, pages_failed: ok ? 0 : 1 }),
  };
}

async function bestEffort(c: Crawl, hook: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    log.warn("crawl.run.hook_failed", { ...ids(c), hook, error: String(err) });
  }
}

// Product batcher.

async function addProduct(c: Crawl, p: NormalizedProduct): Promise<void> {
  c.buffer.push(p);
  if (c.buffer.length >= BATCH_SIZE) await queueBatch(c);
}

// Batches persist one at a time.
// Once aborted the chain stays rejected, so every later onProduct throws and stops the pipeline.
function queueBatch(c: Crawl): Promise<void> {
  const batch = c.buffer.splice(0);
  if (batch.length) c.chain = c.chain.then(() => persistBatch(c, batch));
  return c.chain;
}

async function persistBatch(c: Crawl, batch: NormalizedProduct[]): Promise<void> {
  let r: Upserted;
  try {
    r = await upsertWithRetry(c, batch);
  } catch (err) {
    r = emptyUpsert(batch, err);
  }
  tally(c, r);
  // skipped[] is bad input, not a DB failure, so only a batch that saved nothing and failed something counts.
  c.failedBatches = r.upserted === 0 && r.failed.length > 0 ? c.failedBatches + 1 : 0;
  if (c.failedBatches >= MAX_FAILED_BATCHES) {
    c.abort = `persist_failed: ${r.failed[0]?.error ?? "unknown"}`.slice(0, 500);
    log.error("crawl.run.persist_aborted", undefined, { ...ids(c), error: c.abort });
    throw new Error(c.abort);
  }
}

async function upsertWithRetry(c: Crawl, batch: NormalizedProduct[]): Promise<Upserted> {
  const r = await upsertStoreProducts(c.store.id, batch, { seenAt: c.seenAt });
  const collided = new Set(r.failed.filter((f) => HANDLE_COLLISION.test(f.error)).map((f) => f.url));
  if (!collided.size) return r;
  // 246 keeps "-" plus the 8-char hash within the 255-char handle limit.
  const again = batch.filter((p) => collided.has(p.url))
    .map((p) => ({ ...p, handle: `${p.handle.slice(0, 246)}-${shortHash(p.url)}` }));
  const r2 = await upsertStoreProducts(c.store.id, again, { seenAt: c.seenAt }).catch((err) => emptyUpsert(again, err));
  return {
    upserted: r.upserted + r2.upserted,
    unchanged: r.unchanged + r2.unchanged,
    product_ids: [...r.product_ids, ...r2.product_ids],
    skipped: [...r.skipped, ...r2.skipped],
    failed: [...r.failed.filter((f) => !collided.has(f.url)), ...r2.failed],
  };
}

function emptyUpsert(batch: NormalizedProduct[], err: unknown): Upserted {
  const error = errorText(err);
  return { upserted: 0, unchanged: 0, product_ids: [], skipped: [], failed: batch.map((p) => ({ url: p.url, error })) };
}

function tally(c: Crawl, r: Upserted): void {
  for (const s of r.skipped) c.progress.log({ level: "warn", msg: `Skipped ${s.url}: ${s.reason}`.slice(0, 300) });
  if (r.failed.length) {
    c.progress.log({ level: "warn", msg: `${r.failed.length} products not saved: ${r.failed[0].error}`.slice(0, 300) });
    log.warn("crawl.run.batch_failed", { ...ids(c), failed: r.failed.length, error: r.failed[0].error });
  }
  c.progress.add({ products_found: r.upserted, pages_failed: r.skipped.length + r.failed.length });
}

// Finalize.

async function finalize(c: Crawl, result: PipelineResult | null, crash: string | null): Promise<CrawlRun> {
  // A rejection here is the abort, already recorded in c.abort.
  await queueBatch(c).catch(() => {});
  const outcome = runOutcome(c, result, crash);
  const found = c.progress.counts.products_found;
  if (outcome.status === "succeeded") c.progress.log({ level: "info", step: "publish", msg: `Saved ${found} products` });
  await bestEffort(c, "finalize_store", () => finalizeStore(c, result));
  await bestEffort(c, "finalize_readiness", () => finalizeReadiness(c));
  if (outcome.status === "succeeded") {
    return closeRun(c, "succeeded", outcome.error, `Indexed ${found} products`);
  }
  // The pipeline already logged its own failure, so only failures decided here need an error entry.
  const pipelineFailed = result !== null && result.status !== "succeeded";
  return closeRun(c, "failed", outcome.error, pipelineFailed ? null : outcome.error ?? "failed");
}

function runOutcome(c: Crawl, result: PipelineResult | null, crash: string | null): Outcome {
  if (crash !== null || !result) return { status: "failed", error: crash ?? "no_result" };
  if (c.abort) return { status: "failed", error: c.abort };
  if (result.status !== "succeeded") return { status: "failed", error: result.error };
  if (c.progress.counts.products_found === 0) return { status: "failed", error: "no_products_saved" };
  return { status: "succeeded", error: result.error };
}

async function finalizeStore(c: Crawl, result: PipelineResult | null): Promise<void> {
  const stats = await getIndexStats(c.store.id).catch(() => null);
  const productCount = stats?.product_count ?? Math.max(c.store.product_count, c.progress.counts.products_found);
  const blocked = result?.status === "blocked";
  const platform = result?.detection?.platform ?? c.store.platform;
  const connector = resolveCheckoutConnector({ ...c.store, platform });
  c.store = await updateStore(c.store.id, {
    // A failed re-crawl of an indexed store keeps it indexed (02 section 4).
    status: blocked ? "blocked" : productCount > 0 ? "indexed" : "failed",
    platform,
    currency: result?.currency ?? c.store.currency,
    name: c.store.name ?? result?.siteName ?? null,
    strategy: result?.strategy ?? c.store.strategy,
    checkout_connector: connector,
    checkout_methods: [connector],
    last_crawled_at: new Date().toISOString(),
    metadata: { block_reason: blocked ? (result.error ?? "blocked").replace(/^blocked:/, "") : null },
  });
}

// The actual via-ShoperZero score replaces the scan's projection (02 section 5.10 step 7).
async function finalizeReadiness(c: Crawl): Promise<void> {
  const after = await computeReadiness(c.store, "after");
  await setStoreReadiness(c.store.id, "after", after);
  if (c.store.latest_scan_id) await upsertScan({ id: c.store.latest_scan_id, after: { score: after.score, grade: after.grade } });
}

async function closeRun(c: Crawl, status: RunStatus, error: string | null, msg: string | null): Promise<CrawlRun> {
  if (msg) {
    c.progress.log(status === "succeeded"
      ? { level: "info", step: "done", msg }
      : { level: "error", step: "error", msg });
  }
  await c.progress.flush();
  const patch: CrawlRunPatch = {
    ...c.progress.counts, status, error: error?.slice(0, 500) ?? null, finished_at: new Date().toISOString(),
  };
  log.info("crawl.run.finished", { ...ids(c), status, error: patch.error, products_found: patch.products_found });
  try {
    return await updateCrawlRun(c.runId, patch);
  } catch (err) {
    log.error("crawl.run.finalize_failed", err, ids(c));
    return syntheticRun(c.store.id, c.runId, patch);
  }
}

function syntheticRun(storeId: string, id: string, patch: Partial<CrawlRun>): CrawlRun {
  const now = new Date().toISOString();
  return {
    id, store_id: storeId, status: "failed", strategy: null, products_found: 0, pages_fetched: 0, pages_failed: 0,
    log: [], error: null, started_at: null, finished_at: now, created_at: now, updated_at: now, ...patch,
  };
}

const ids = (c: Crawl) => ({ store_id: c.store.id, crawl_run_id: c.runId });
const errorText = (err: unknown) => String(err).slice(0, 500);
