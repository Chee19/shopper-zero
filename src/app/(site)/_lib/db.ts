import "server-only";
import type {
  CheckoutEvent, CheckoutSession, CrawlRun, IndexedProduct, PublicMetrics, ScanReport, Store, StoreClaim, StoreSummary,
  ClaimMethod,
} from "@/components/lib/contracts";

/** The subset of WS1's "@/lib/db" helpers (spec 00 §6.10) that WS5 reads through. */
export type DbApi = {
  getScan(id: string): Promise<ScanReport | null>;
  getLatestScanForStore(storeId: string): Promise<ScanReport | null>;
  getStoreById(id: string): Promise<Store | null>;
  getStoreBySlug(slug: string): Promise<Store | null>;
  listStores(opts?: { limit?: number; include_opted_out?: boolean }): Promise<StoreSummary[]>;
  listStoreProducts(storeId: string, opts: { limit: number; page?: number; order?: "seq" | "recent" }): Promise<{ products: IndexedProduct[]; total: number }>;
  getCrawlRun(id: string): Promise<CrawlRun | null>;
  getLatestCrawlRun(storeId: string): Promise<CrawlRun | null>;
  listCheckoutEvents(checkoutId: string): Promise<CheckoutEvent[]>;
  getPublicMetrics(): Promise<PublicMetrics>;
  getClaim(storeId: string): Promise<StoreClaim | null>;
  upsertClaim(storeId: string, method: ClaimMethod): Promise<StoreClaim>;
  markClaimVerified(storeId: string): Promise<void>;
  setStoreOptOut(storeId: string, optedOut: boolean): Promise<void>;
};

/**
 * Lazily loads the server-only db helpers, so UI_MOCK builds never construct a Supabase client (spec 05 §6.1).
 * Returns null until WS1's "@/lib/db" is on main; callers degrade to "not found" / "unavailable".
 */
export async function loadDb(): Promise<DbApi | null> {
  return null;
}

/** WS4's checkout service (throws when missing). Null until "@/lib/checkout/service" lands. */
export async function loadCheckoutService(): Promise<{ getCheckout(id: string): Promise<CheckoutSession> } | null> {
  return null;
}
