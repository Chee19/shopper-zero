import type {
  CheckoutConnectorId, ExtractionSource, IsoDateTime, Platform,
} from "@/contracts/primitives";
import type { AccessMethod, DomRecipe } from "@/contracts/scan"; // type-only cycle with scan.ts is fine

export const STORE_STATUSES = ["pending", "crawling", "indexed", "failed", "blocked"] as const;
export type StoreStatus = (typeof STORE_STATUSES)[number];

// ---------- readiness (WS2 computes, WS5 renders) ----------
export const READINESS_CHECK_IDS = [
  "products_json", "well_known_ucp", "mcp_endpoint", "llms_txt",
  "jsonld_product_coverage", "sitemap", "robots_allows_agents", "agent_checkout",
] as const;
export type ReadinessCheckId = (typeof READINESS_CHECK_IDS)[number];
/** Default weights; they sum to 100. */
export const READINESS_WEIGHTS: Record<ReadinessCheckId, number> = {
  products_json: 15, well_known_ucp: 15, mcp_endpoint: 15, llms_txt: 10,
  jsonld_product_coverage: 15, sitemap: 10, robots_allows_agents: 10, agent_checkout: 10,
};
export type ReadinessGrade = "A" | "B" | "C" | "D" | "F";
/** score >= 90 A, >= 75 B, >= 60 C, >= 40 D, else F. */
export function gradeFor(score: number): ReadinessGrade {
  return score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
}
export interface ReadinessCheck {
  id: ReadinessCheckId;
  label: string;
  pass: boolean;
  weight: number;
  detail?: string;
}
export interface ReadinessReport {
  score: number;              // 0..100; `before` = the latest ScanReport.score (02 §6.8), `after` = the via-ShoperZero score
  grade: ReadinessGrade;
  checks: ReadinessCheck[];
  computed_at: IsoDateTime;
}

// ---------- store ----------
export interface StoreStrategy {
  tier: ExtractionSource;     // chosen extraction tier
  adapter?: Platform;         // platform adapter used when tier = platform_api
  sampled_at?: IsoDateTime;
}

export interface StoreUrls {
  page: string;               // {APP_URL}/stores/{slug}        (human)
  products_json: string;      // {APP_URL}/s/{slug}/products.json
  llms_txt: string;           // {APP_URL}/s/{slug}/llms.txt
  feed: string;               // {APP_URL}/s/{slug}/feed.acp.jsonl
  ucp: string;                // {APP_URL}/s/{slug}/.well-known/ucp
  mcp: string;                // {APP_URL}/api/mcp
}

export interface Store {
  id: string;
  slug: string;
  domain: string;             // identity key: host without "www." + optional locale path, e.g. "bulk.com/uk"
  base_url: string;           // fetch root: "https://www.bulk.com/uk"
  name: string | null;
  platform: Platform;         // "unknown" until detected
  currency: string | null;
  country: string | null;
  status: StoreStatus;
  product_count: number;
  strategy: StoreStrategy | null;
  checkout_connector: CheckoutConnectorId; // "handoff" unless a real connector works
  readiness: { before?: ReadinessReport; after?: ReadinessReport }; // before: derived from the latest ScanReport (B2)
  claimed: boolean;           // stores.claimed_at is not null
  claimed_at: IsoDateTime | null; // WS5 CCR-8
  opted_out: boolean;
  // ---- scan and score (DECISIONS §A) ----
  best_method: AccessMethod | "none" | null; // null = never scanned; copied from the latest finished ScanReport
  dom_recipe: DomRecipe | null;              // from the dom probe; reused by indexing and WS4's browser connector (stretch)
  latest_scan_id: string | null;             // scans.id of the most recent scan (any status)
  last_crawled_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  urls: StoreUrls;
}

/** Trimmed store for list_stores / GET /api/v1/stores. Keeps best_method (WS3 CR-4). */
export type StoreSummary = Omit<Store, "readiness" | "strategy" | "dom_recipe"> & {
  grade_before: ReadinessGrade | null;
  grade_after: ReadinessGrade | null;
};

// ---------- crawl runs ----------
export const CRAWL_RUN_STATUSES = ["queued", "running", "succeeded", "failed"] as const;
export type CrawlRunStatus = (typeof CRAWL_RUN_STATUSES)[number];
/** WS5 CCR-1 (B14), keyed by `at`. WS2 appends one entry per phase; the log keeps the last 50. */
export const CRAWL_STEPS = ["detect", "robots", "discover", "extract", "publish", "readiness", "done", "error"] as const;
export type CrawlStep = (typeof CRAWL_STEPS)[number];
export interface CrawlLogEntry {
  at: IsoDateTime;
  step?: CrawlStep;           // drives the UI stage rail; entries without it are plain log lines
  level: "info" | "warn" | "error";
  msg: string;                // human readable, shown in the UI
  data?: { total_estimate?: number; platform?: Platform; [key: string]: unknown };
}
export interface CrawlRun {
  id: string;
  store_id: string;
  status: CrawlRunStatus;
  strategy: string | null;    // ExtractionSource or adapter label, free text
  products_found: number;
  pages_fetched: number;
  pages_failed: number;
  log: CrawlLogEntry[];       // capped at the last 50 entries (WS5 CCR-1). WS2's CrawlRunView is a superset of CrawlRun.
  error: string | null;
  started_at: IsoDateTime | null;
  finished_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

// ---------- merchant claim (WS5) ----------
export type ClaimMethod = "dns_txt" | "meta_tag";
export interface StoreClaim {
  store_id: string;
  method: ClaimMethod;
  token: string;              // DNS: TXT record at "_shoperzero.<host>" with value "shoperzero-verify=<token>";
                              // meta: <meta name="shoperzero-verify" content="<token>"> on the homepage
  verified_at: IsoDateTime | null;
  created_at: IsoDateTime;
}

// ---------- metrics (WS5 metrics strip) ----------
export interface PublicMetrics {
  stores_total: number;
  stores_indexed: number;
  products: number;
  variants: number;
  agent_requests: number;
  agent_requests_24h: number;
  checkouts: number;
  orders: number;
  gmv_minor: Record<string, number>; // currency -> minor units
  // round 2, optional (WS5): the UI must tolerate their absence
  stores_by_best_method?: Partial<Record<AccessMethod | "none", number>>; // non-opted-out stores with a best_method
  orders_by_rail?: Partial<Record<"stripe_spt", number>>;        // placed + confirmed orders
  median_seconds_to_agent_ready?: number | null; // median (finished_at - created_at) of succeeded crawl runs
}
