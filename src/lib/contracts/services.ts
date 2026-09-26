// Cross-stream function signatures. Implementations MUST be typed with these, e.g.
//   export const verifyOffer: VerifyOfferFn = async (variantId) => { ... };
import type { Offer } from "./catalog";
import type {
  CheckoutEvent, CheckoutSession, CompleteCheckoutInput, CreateCheckoutInput, Order, UpdateCheckoutInput,
} from "./checkout";
import type { AgentSurface } from "./primitives";
import type { ScanMode, ScanReport, ScanStartResult } from "./scan";
import type { CrawlRun, ReadinessReport, Store } from "./store";

export interface RequestContext {
  surface: Extract<AgentSurface, "mcp" | "rest">;
  request_id: string;
  idempotency_key?: string;   // REST Idempotency-Key header or MCP idempotency_key arg
  agent_profile?: string;     // UCP-Agent header profile or meta["ucp-agent"].profile
  user_agent?: string;
}

// ---------- WS2: import from "@/lib/crawl" (src/lib/crawl/index.ts) ----------
/**
 * Normalize rawUrl (or use opts.storeId for POST /api/v1/stores {store_id}), upsert the stores row, reuse the
 * latest ScanReport to pick the method (api → platform adapter, dom → sitemap + JSON-LD / DOM recipe), insert a
 * queued crawl_run, schedule crawlStore() with after(). Returns immediately.
 * reused = an active run (< 6 min) was returned (even with force); cached = indexed, crawled < 6 h ago and !force.
 */
export type StartStoreCrawlFn = (
  rawUrl: string,
  opts?: { maxProducts?: number; force?: boolean; storeId?: string },
) => Promise<{ store: Store; crawl_run: CrawlRun; reused: boolean; cached: boolean }>;
/** Runs the whole crawl synchronously (called inside after()). Never throws: failures end in status "failed". */
export type CrawlStoreFn = (
  storeId: string,
  crawlRunId: string,
  opts?: { maxProducts?: number },
) => Promise<CrawlRun>;
/** Live re-check of one variant; persists the new offer via db.updateVariantOffer. Timeout 8 s. */
export type VerifyOfferFn = (variantId: string) => Promise<Offer>;
/** "before": derived from the store's latest ScanReport (B2; probes the site only if there is none). "after": score with our hosted surfaces. */
export type ComputeReadinessFn = (store: Store, phase: "before" | "after") => Promise<ReadinessReport>;

// ---------- WS2 scan: import from "@/lib/scan" (src/lib/scan/index.ts) ----------
/** Normalize URL, upsertStoreForUrl, reuse an active scan (< 6 min) or insert a queued one (db.upsertScan), schedule runScan() with after(). Returns immediately. */
export type StartScanFn = (
  rawUrl: string,
  opts?: { mode?: ScanMode },
) => Promise<ScanStartResult & { reused: boolean }>; // reused = an active scan (< 6 min) was returned
/** Runs the cascade (api → dom → computer_use) inside after(). Persists every probe transition via db.upsertScan (Realtime). Never throws: failures end in status "failed". */
export type RunScanFn = (scanId: string) => Promise<ScanReport>;

// ---------- WS4: import from "@/lib/checkout" (src/lib/checkout/index.ts) ----------
// All throw AppError (src/lib/errors.ts): not_found, validation_error, invalid_state, gone,
// idempotency_conflict, upstream_error. Business outcomes (out of stock, handoff, declined)
// are NOT thrown: they come back as a CheckoutSession with messages[] (HTTP 200).
export interface CheckoutService {
  createCheckout(input: CreateCheckoutInput, ctx: RequestContext): Promise<CheckoutSession>;
  updateCheckout(id: string, input: UpdateCheckoutInput, ctx: RequestContext): Promise<CheckoutSession>;
  getCheckout(id: string): Promise<CheckoutSession>;
  completeCheckout(id: string, input: CompleteCheckoutInput, ctx: RequestContext): Promise<CheckoutSession>;
  cancelCheckout(id: string, ctx: RequestContext): Promise<CheckoutSession>;
  getOrder(id: string): Promise<Order>;
  listCheckoutEvents(checkoutId: string): Promise<CheckoutEvent[]>;
}
