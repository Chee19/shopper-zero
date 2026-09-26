// Indexing frames for the "Make it agent-ready" replay (round-1 crawl lane scripts, ~12–18 s).
import type { CrawlLogEntry, CrawlRun, CrawlStep, Store } from "@/components/lib/contracts";
import { PLATFORM_LABELS } from "@/components/lib/methods";
import type { IndexingFrame, ScanReplay } from "@/components/realtime/types";
import { RECORDED_AT } from "./stores";

export function buildIndexing(store: Store, opts: { products: number; discoverMsg: string; strategy: string }): ScanReplay["indexing"] {
  const base = Date.parse(RECORDED_AT) + 60_000;
  const iso = (ms: number) => new Date(base + ms).toISOString();
  const runId = `${store.id.slice(0, 24)}ffffffffffff`;
  const before = store.readiness.before;
  const after = store.readiness.after;

  const run: CrawlRun = {
    id: runId, store_id: store.id, status: "queued", strategy: null, products_found: 0, pages_fetched: 0, pages_failed: 0,
    log: [], error: null, started_at: null, finished_at: null, created_at: iso(0), updated_at: iso(0),
  };
  const startStore: Store = {
    ...store, status: "crawling", product_count: 0, readiness: before ? { before } : {},
  };

  const frames: IndexingFrame[] = [];
  const log: CrawlLogEntry[] = [];
  let at = 0;
  const push = (step: CrawlStep, msg: string, data?: CrawlLogEntry["data"], level: CrawlLogEntry["level"] = "info") =>
    log.push({ at: iso(at), step, level, msg, ...(data ? { data } : {}) });
  const emit = (run: Partial<CrawlRun>, store?: Partial<Store>) =>
    frames.push({ at_ms: at, run: { ...run, log: [...log], updated_at: iso(at) }, ...(store ? { store } : {}) });

  at = 300;
  push("detect", `Detected ${PLATFORM_LABELS[store.platform] ?? store.platform}`, { platform: store.platform });
  emit({ status: "running", started_at: iso(at), strategy: opts.strategy });
  at += 1200;
  push("robots", "robots.txt allows product pages · 1 req/s");
  emit({ pages_fetched: 2 });
  at += 1200;
  push("discover", opts.discoverMsg, { total_estimate: opts.products });
  emit({ pages_fetched: 4 });

  let found = 0;
  let pages = 4;
  while (found < opts.products) {
    at += 650;
    found = Math.min(opts.products, found + 3 + (found % 2));
    pages += 4;
    if (found % 9 < 4 || found === opts.products) push("extract", `Extracted ${found}/${opts.products} products`, { total_estimate: opts.products });
    emit({ products_found: found, pages_fetched: pages });
  }
  at += 900;
  push("publish", "Published products.json, UCP profile, MCP tools, ACP feed and llms.txt");
  emit({}, { product_count: found });
  at += 1100;
  push("readiness", after ? `Graded ${after.grade} (${after.score})` : "Graded");
  emit({ status: "succeeded", finished_at: iso(at) }, { status: "indexed", readiness: after ? { before, after } : {}, last_crawled_at: iso(at) });

  return { run, store: startStore, frames };
}
