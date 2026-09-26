// TEMPORARY type-only copy of the WS1 contracts WS5 needs (spec 05 §3 fallback).
// Delete this file once src/lib/contracts lands on main and src/components/lib/contracts.ts re-exports "@/lib/contracts".

// ---------- primitives ----------
export type Money = { amount: number; currency: string };
export type IsoDateTime = string;
export type Availability = "in_stock" | "out_of_stock" | "preorder" | "unknown";
export type Platform =
  | "woocommerce" | "magento" | "bigcommerce" | "squarespace" | "sfcc"
  | "prestashop" | "wix" | "shopify" | "custom" | "unknown";
export type ExtractionSource = "platform_api" | "jsonld" | "microdata" | "opengraph" | "render" | "llm" | "dom_recipe";
export type CheckoutConnectorId = "woo_store_api" | "magento_guest" | "handoff" | "browser";
export type PaymentRailId = "stripe_spt" | "x402";
export const X402_NETWORKS = { base_sepolia: "eip155:84532", base: "eip155:8453" } as const;
export type X402Network = (typeof X402_NETWORKS)[keyof typeof X402_NETWORKS];
export type ApiErrorCode =
  | "bad_request" | "validation_error" | "unauthorized" | "payment_required" | "forbidden" | "not_found"
  | "conflict" | "invalid_state" | "idempotency_conflict" | "gone" | "unprocessable" | "rate_limited"
  | "internal" | "not_implemented" | "upstream_error" | "upstream_blocked" | "upstream_timeout";
export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: unknown; request_id?: string };
}

// ---------- scan (DECISIONS §A) ----------
export type AccessMethod = "api" | "dom" | "computer_use";
export type ProbeStatus = "pending" | "running" | "passed" | "partial" | "failed" | "skipped" | "blocked";
export type Capabilities = {
  catalog: boolean; product_detail: boolean; price_availability: boolean;
  variants: boolean; cart: boolean; checkout_reachable: boolean;
};
export type ProbeSignal = { id: string; label: string; ok: boolean; detail?: string; url?: string };
export type DomRecipe = {
  search_input?: string; product_card?: string; product_link?: string; title?: string; price?: string;
  variant_picker?: string; add_to_cart?: string; cart_link?: string; checkout_link?: string;
  notes?: string; verified_at?: string;
};
export type AccessProbe = {
  method: AccessMethod;
  status: ProbeStatus;
  started_at: string | null; finished_at: string | null; duration_ms: number | null;
  signals: ProbeSignal[];
  capabilities: Capabilities;
  sample_products: number;
  est_seconds_per_task: number | null;
  est_usd_per_task: number | null;
  endpoints?: string[];
  recipe?: DomRecipe;
  screenshots?: string[];
  steps?: { i: number; action: string; reasoning?: string; screenshot?: string }[];
  error?: { code: string; message: string };
};
export type ScanMode = "cascade" | "full";
export type ScanStatus = "queued" | "running" | "done" | "failed";
export type ScanReport = {
  id: string; store_id: string; url: string; mode: ScanMode; status: ScanStatus;
  platform: Platform;
  best_method: AccessMethod | "none";
  probes: AccessProbe[];
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  checks: ReadinessCheck[];
  after: { score: number; grade: "A" | "B" | "C" | "D" | "F" } | null;
  recommendations: string[];
  created_at: string; updated_at: string;
};
export const NO_CAPABILITIES: Capabilities = {
  catalog: false, product_detail: false, price_availability: false,
  variants: false, cart: false, checkout_reachable: false,
};
export interface ScanStartResult { scan_id: string; store_id: string; status_url: string; report_url: string }

// ---------- store ----------
export type StoreStatus = "pending" | "crawling" | "indexed" | "failed" | "blocked";
export type ReadinessCheckId =
  | "products_json" | "well_known_ucp" | "mcp_endpoint" | "llms_txt"
  | "jsonld_product_coverage" | "sitemap" | "robots_allows_agents" | "agent_checkout";
export type ReadinessGrade = "A" | "B" | "C" | "D" | "F";
export function gradeFor(score: number): ReadinessGrade {
  return score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
}
export interface ReadinessCheck { id: ReadinessCheckId; label: string; pass: boolean; weight: number; detail?: string }
export interface ReadinessReport { score: number; grade: ReadinessGrade; checks: ReadinessCheck[]; computed_at: IsoDateTime }
export interface StoreStrategy { tier: ExtractionSource; adapter?: Platform; sampled_at?: IsoDateTime }
export interface StoreUrls { page: string; products_json: string; llms_txt: string; feed: string; ucp: string; mcp: string }
export interface Store {
  id: string;
  slug: string;
  domain: string;
  base_url: string;
  name: string | null;
  platform: Platform;
  currency: string | null;
  country: string | null;
  status: StoreStatus;
  product_count: number;
  strategy: StoreStrategy | null;
  checkout_connector: CheckoutConnectorId;
  readiness: { before?: ReadinessReport; after?: ReadinessReport };
  claimed: boolean;
  claimed_at: IsoDateTime | null;
  opted_out: boolean;
  best_method: AccessMethod | "none" | null;
  dom_recipe: DomRecipe | null;
  latest_scan_id: string | null;
  last_crawled_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  urls: StoreUrls;
}
export type StoreSummary = Omit<Store, "readiness" | "strategy" | "dom_recipe"> & {
  grade_before: ReadinessGrade | null;
  grade_after: ReadinessGrade | null;
};
export type CrawlRunStatus = "queued" | "running" | "succeeded" | "failed";
export type CrawlStep = "detect" | "robots" | "discover" | "extract" | "publish" | "readiness" | "done" | "error";
export interface CrawlLogEntry {
  at: IsoDateTime;
  step?: CrawlStep;
  level: "info" | "warn" | "error";
  msg: string;
  data?: { total_estimate?: number; platform?: Platform; [key: string]: unknown };
}
export interface CrawlRun {
  id: string;
  store_id: string;
  status: CrawlRunStatus;
  strategy: string | null;
  products_found: number;
  pages_fetched: number;
  pages_failed: number;
  log: CrawlLogEntry[];
  error: string | null;
  started_at: IsoDateTime | null;
  finished_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}
export type ClaimMethod = "dns_txt" | "meta_tag";
export interface StoreClaim { store_id: string; method: ClaimMethod; token: string; verified_at: IsoDateTime | null; created_at: IsoDateTime }
export interface PublicMetrics {
  stores_total: number;
  stores_indexed: number;
  products: number;
  variants: number;
  agent_requests: number;
  agent_requests_24h: number;
  checkouts: number;
  orders: number;
  gmv_minor: Record<string, number>;
  stores_by_best_method?: Partial<Record<AccessMethod | "none", number>>;
  orders_by_rail?: Partial<Record<"stripe_spt" | "x402", number>>;
  median_seconds_to_agent_ready?: number | null;
}

// ---------- catalog ----------
export interface Offer {
  price: Money; compare_at: Money | null; availability: Availability; url: string | null; checked_at: string;
}
export interface NormalizedVariant {
  external_id: string | null; title: string; options: Record<string, string>; sku: string | null; gtin: string | null;
  image_url: string | null; inventory_quantity: number | null; offer: Offer;
}
export interface StoreRef { id: string; slug: string; name: string | null; domain: string; platform: Platform }
export interface IndexedVariant extends NormalizedVariant {
  id: string; seq: number; product_id: string; external_id: string; position: number;
}
export interface IndexedProduct {
  id: string;
  seq: number;
  store: StoreRef;
  external_id: string | null;
  url: string;
  handle: string;
  title: string;
  description_html: string | null;
  description_text: string | null;
  brand: string | null;
  product_type: string | null;
  category: string | null;
  tags: string[];
  images: { url: string; alt?: string }[];
  options: { name: string; values: string[] }[];
  source: ExtractionSource;
  price_range: { min: Money; max: Money };
  available: boolean;
  variants: IndexedVariant[];
  checkout_methods: CheckoutConnectorId[];
  updated_at: IsoDateTime;
}

// ---------- checkout ----------
export type CheckoutStatus =
  | "incomplete" | "requires_escalation" | "ready_for_complete" | "complete_in_progress" | "completed" | "canceled";
export type CheckoutState =
  | "quoting" | "awaiting_payment" | "requires_action" | "payment_authorized" | "placing_order"
  | "order_placed" | "completed" | "refunding" | "failed" | "expired" | "canceled" | "handoff";
export const STATE_TO_STATUS: Record<CheckoutState, CheckoutStatus> = {
  quoting: "incomplete",
  awaiting_payment: "ready_for_complete",
  requires_action: "requires_escalation",
  payment_authorized: "complete_in_progress",
  placing_order: "complete_in_progress",
  order_placed: "completed",
  completed: "completed",
  refunding: "complete_in_progress",
  failed: "canceled",
  expired: "canceled",
  canceled: "canceled",
  handoff: "requires_escalation",
};
export interface Address {
  name: string; line1: string; line2?: string; city: string; region?: string; postal_code: string; country: string;
}
export interface Buyer { email: string; name?: string; phone?: string }
export interface LineItem {
  id: string; variant_id: string; product_id: string; title: string; variant_title: string; quantity: number;
  unit_price: Money; total: Money; image_url: string | null; url: string | null;
}
export interface ShippingOption { id: string; title: string; amount: Money }
export type TotalType = "subtotal" | "shipping" | "tax" | "discount" | "total";
export interface Total { type: TotalType; amount: number; display_text?: string }
export type PaymentHandler =
  | { id: "app.shoperzero.stripe_spt"; rail: "stripe_spt"; config: { accepted: "card"[]; test_mode: boolean; profile?: string } }
  | { id: "app.shoperzero.x402"; rail: "x402"; config: { pay_url: string; network: X402Network; asset: "USDC"; amount: string } };
export interface Message {
  type: "error" | "warning" | "info";
  code: string;
  content: string;
  path?: string;
  severity?: "recoverable" | "requires_buyer_input" | "requires_buyer_review" | "unrecoverable";
}
export interface CheckoutLink { type: "timeline" | "merchant_product" | "terms_of_service"; url: string }
export interface Order {
  id: string;
  checkout_id: string;
  store_id: string;
  status: "placed" | "confirmed" | "failed" | "refunded";
  merchant_order_id: string | null;
  merchant_order_url: string | null;
  payment: { rail: PaymentRailId; reference: string; amount: Money; payer?: string };
  created_at: IsoDateTime;
}
export interface CheckoutSession {
  id: string;
  ucp_version: "2026-08-25";
  store: { id: string; slug: string; domain: string; name: string | null };
  connector: CheckoutConnectorId;
  state: CheckoutState;
  status: CheckoutStatus;
  line_items: LineItem[];
  buyer?: Buyer;
  fulfillment?: { address?: Address; options: ShippingOption[]; selected_option_id?: string };
  totals: Total[];
  currency: string;
  payment: { handlers: PaymentHandler[] };
  continue_url?: string;
  messages?: Message[];
  links: CheckoutLink[];
  order?: Order;
  expires_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}
export type CheckoutEventData = {
  rail?: PaymentRailId;
  payment_intent_id?: string;
  tx_hash?: string;
  network?: X402Network;
  merchant_order_id?: string;
  merchant_order_url?: string;
  continue_url?: string;
  amount?: Money;
  error_code?: string;
  simulated?: boolean;
};
export interface CheckoutEvent {
  id: number;
  checkout_id: string;
  from_state: CheckoutState | null;
  to_state: CheckoutState;
  message: string | null;
  data: CheckoutEventData;
  created_at: IsoDateTime;
}
