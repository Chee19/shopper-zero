import type { ScanReplay } from "@/components/realtime/types";
import { buildCascadeFrames } from "./cascade";
import { buildIndexing } from "./crawl-scripts";
import { MOCK_SCANS } from "./scans";
import { MOCK_STORES, RECORDED_AT } from "./stores";

export { MOCK_STORES, mockStoreBySlug, withAppUrl, storeUrls, MOCK_WOO_URL, RECORDED_AT } from "./stores";
export { mockProducts } from "./products";
export { MOCK_SCANS } from "./scans";
export { MOCK_METRICS } from "./metrics";
export { MOCK_CHECKOUTS } from "./checkout-scripts";
export { mockClaimView, MOCK_CLAIM_TOKEN } from "./claims";
export { buildCascadeFrames } from "./cascade";
export { mockShot } from "./shots";

const INDEXING: Record<string, { products: number; discoverMsg: string; strategy: string }> = {
  "shoperzero-demo": { products: 24, discoverMsg: "WooCommerce Store API: 24 products", strategy: "platform_api" },
  "berlinpackaging-com": { products: 40, discoverMsg: "Sitemap: 1,204 product URLs · taking 40", strategy: "jsonld" },
  "meridian-athletic-example": { products: 0, discoverMsg: "No machine-readable catalog", strategy: "render" },
  "lockedshop-example": { products: 0, discoverMsg: "Blocked by bot protection", strategy: "render" },
};

const PACE: Record<string, number> = { "replay-cu": 0.75 };

export function mockScanReplay(id: string): ScanReplay | null {
  const final = MOCK_SCANS[id];
  if (!final) return null;
  const store = MOCK_STORES.find((s) => s.id === final.store_id);
  if (!store) return null;
  const idx = INDEXING[store.slug] ?? { products: 8, discoverMsg: "Sitemap", strategy: "jsonld" };
  return {
    id,
    recorded_at: RECORDED_AT,
    final,
    frames: buildCascadeFrames(final, PACE[id] ?? 1),
    indexing: buildIndexing(store, idx),
    store,
  };
}
