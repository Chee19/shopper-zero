import type { NormalizedProduct, Offer } from "@/contracts/catalog";
import type { CrawlLogEntry } from "@/contracts/store";
import type { Platform } from "@/contracts/primitives";

// ---------- crawler plug-in (WS2) ----------
export interface CrawlContext {
  domain: string;             // Store.domain
  baseUrl: string;            // Store.base_url, no trailing slash
  homepageHtml: string;       // GET baseUrl body (may be "" if blocked)
  headers: Headers;           // homepage response headers
  fetch: typeof fetch;        // polite fetch: robots-aware, 1-2 rps/host, CRAWLER_USER_AGENT, timeout
  log: (entry: Omit<CrawlLogEntry, "at">) => void; // appends to crawl_runs.log (buffered)
  signal?: AbortSignal;       // aborted when the time budget (~280 s) runs out
}

export interface PlatformAdapter {
  platform: Platform;
  /** Confidence 0..1 that this adapter can list products for the store. Must not throw. */
  detect(ctx: CrawlContext): Promise<number>;
  /** Yields normalized products, at most opts.max. May throw (the runner falls back to the JSON-LD engine). */
  listProducts(ctx: CrawlContext, opts: { max: number }): AsyncIterable<NormalizedProduct>;
  /** Live re-check of one variant's price/stock (used by verifyOffer). */
  fetchOffer?(
    ctx: CrawlContext,
    product: { url: string; external_id: string | null },
    variantExternalId: string | null,
  ): Promise<Offer>;
}
