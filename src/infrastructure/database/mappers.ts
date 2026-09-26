// src/infrastructure/database/mappers.ts: row -> contract mappers. ISOMORPHIC (no server-only, no client import),
// so WS5 client components can map rows they read with the browser client.
// Row interfaces are structural and loose on purpose: generated Tables<"x"> rows are assignable.
import type {
  AccessMethod, Availability, CheckoutConnectorId, CheckoutEvent, CheckoutEventData, CheckoutState,
  CrawlLogEntry, CrawlRun, DomRecipe, ExtractionSource, IndexedProduct, IndexedVariant, Order, PaymentRailId,
  Platform, ProductSummary, ScanReport, Store, StoreRef, StoreStrategy, StoreSummary, StoreUrls,
} from "@/contracts";
import { PLATFORMS } from "@/contracts";

export const iso = (ts: string): string => new Date(ts).toISOString();
export const isoOrNull = (ts: string | null | undefined): string | null => (ts ? iso(ts) : null);

export function storeUrls(slug: string, base: string): StoreUrls {
  const b = base.replace(/\/+$/, "");
  return {
    page: `${b}/stores/${slug}`,
    products_json: `${b}/s/${slug}/products.json`,
    llms_txt: `${b}/s/${slug}/llms.txt`,
    feed: `${b}/s/${slug}/feed.acp.jsonl`,
    ucp: `${b}/s/${slug}/.well-known/ucp`,
    mcp: `${b}/api/mcp`,
  };
}

export function checkoutMethods(connector: string | null | undefined): CheckoutConnectorId[] {
  const c = (connector ?? "handoff") as CheckoutConnectorId;
  return c === "handoff" ? ["handoff"] : [c, "handoff"];
}

const asPlatform = (p: string | null | undefined): Platform =>
  (PLATFORMS as readonly string[]).includes(p ?? "") ? (p as Platform) : "unknown";

// ---------- stores ----------
export interface StoreRow {
  id: string; slug: string; domain: string; base_url: string; name: string | null; platform: string | null;
  currency: string | null; country: string | null; status: string; product_count: number;
  strategy: unknown; readiness: unknown; checkout_connector: string; claimed_at: string | null;
  opted_out: boolean; last_crawled_at: string | null; created_at: string; updated_at: string;
  best_method: string | null; dom_recipe: unknown; latest_scan_id: string | null;
}
export function toStore(r: StoreRow, base: string): Store {
  const readiness = (r.readiness ?? {}) as Store["readiness"];
  return {
    id: r.id, slug: r.slug, domain: r.domain, base_url: r.base_url, name: r.name,
    platform: asPlatform(r.platform), currency: r.currency, country: r.country,
    status: r.status as Store["status"], product_count: r.product_count,
    strategy: (r.strategy as StoreStrategy | null) ?? null,
    checkout_connector: (r.checkout_connector ?? "handoff") as CheckoutConnectorId,
    readiness, claimed: r.claimed_at !== null, claimed_at: isoOrNull(r.claimed_at), opted_out: r.opted_out,
    best_method: (r.best_method as AccessMethod | "none" | null) ?? null,
    dom_recipe: (r.dom_recipe as DomRecipe | null) ?? null,
    latest_scan_id: r.latest_scan_id ?? null,
    last_crawled_at: isoOrNull(r.last_crawled_at), created_at: iso(r.created_at), updated_at: iso(r.updated_at),
    urls: storeUrls(r.slug, base),
  };
}
export function toStoreSummary(r: StoreRow, base: string): StoreSummary {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted keys
  const { readiness, strategy: _s, dom_recipe: _d, ...rest } = toStore(r, base);
  return { ...rest, grade_before: readiness.before?.grade ?? null, grade_after: readiness.after?.grade ?? null };
}

// ---------- products ----------
export interface StoreRefRow { id: string; slug: string; name: string | null; domain: string; platform: string | null; checkout_connector: string }
export interface VariantRow {
  id: string; seq: number; product_id: string; external_id: string; title: string; options: unknown;
  sku: string | null; gtin: string | null; price_minor: number; compare_at_minor: number | null;
  currency: string; availability: string; inventory_quantity: number | null; image_url: string | null;
  url: string | null; position: number; checked_at: string;
}
export interface ProductRow {
  id: string; seq: number; handle: string; url: string; external_id: string | null; title: string;
  description: string | null; description_html: string | null; brand: string | null;
  product_type: string | null; category: string | null; tags: string[]; options: unknown; images: string[];
  currency: string | null; price_min_minor: number | null; price_max_minor: number | null;
  available: boolean; source: string | null; updated_at: string;
  stores: StoreRefRow;
  product_variants: VariantRow[];
}
const toStoreRef = (s: StoreRefRow): StoreRef =>
  ({ id: s.id, slug: s.slug, name: s.name, domain: s.domain, platform: asPlatform(s.platform) });

export function toIndexedVariant(v: VariantRow): IndexedVariant {
  return {
    id: v.id, seq: v.seq, product_id: v.product_id, external_id: v.external_id, position: v.position,
    title: v.title, options: (v.options ?? {}) as Record<string, string>, sku: v.sku, gtin: v.gtin,
    image_url: v.image_url, inventory_quantity: v.inventory_quantity,
    offer: {
      price: { amount: v.price_minor, currency: v.currency },
      compare_at: v.compare_at_minor === null ? null : { amount: v.compare_at_minor, currency: v.currency },
      availability: v.availability as Availability,
      url: v.url,
      checked_at: iso(v.checked_at),
    },
  };
}

export function toIndexedProduct(r: ProductRow): IndexedProduct {
  const variants = [...(r.product_variants ?? [])].sort((a, b) => a.position - b.position).map(toIndexedVariant);
  const currency = r.currency ?? variants[0]?.offer.price.currency ?? "USD";
  return {
    id: r.id, seq: r.seq, external_id: r.external_id, url: r.url, handle: r.handle, title: r.title,
    description_html: r.description_html, description_text: r.description, brand: r.brand,
    product_type: r.product_type, category: r.category, tags: r.tags ?? [],
    images: (r.images ?? []).map((url) => ({ url })),
    options: (r.options ?? []) as IndexedProduct["options"],
    source: (r.source ?? "jsonld") as ExtractionSource,
    store: toStoreRef(r.stores),
    price_range: {
      min: { amount: r.price_min_minor ?? 0, currency },
      max: { amount: r.price_max_minor ?? 0, currency },
    },
    available: r.available,
    variants,
    checkout_methods: checkoutMethods(r.stores.checkout_connector),
    updated_at: iso(r.updated_at),
  };
}

export interface ProductSummaryRow extends Omit<ProductRow, "product_variants" | "description" | "description_html" | "options" | "tags" | "external_id" | "category" | "source"> {
  product_variants: { count: number }[];
}
export function toProductSummary(r: ProductSummaryRow, score?: number): ProductSummary {
  const currency = r.currency ?? "USD";
  return {
    id: r.id, seq: r.seq, handle: r.handle, title: r.title, brand: r.brand, product_type: r.product_type,
    url: r.url, image_url: r.images?.[0] ?? null,
    price_range: { min: { amount: r.price_min_minor ?? 0, currency }, max: { amount: r.price_max_minor ?? 0, currency } },
    available: r.available, variants_count: r.product_variants?.[0]?.count ?? 0,
    store: toStoreRef(r.stores), checkout_methods: checkoutMethods(r.stores.checkout_connector),
    ...(score !== undefined ? { score } : {}),
  };
}

// ---------- crawl runs ----------
export interface CrawlRunRow {
  id: string; store_id: string; status: string; strategy: string | null; products_found: number;
  pages_fetched: number; pages_failed: number; log: unknown; error: string | null;
  started_at: string | null; finished_at: string | null; created_at: string; updated_at: string;
}
export function toCrawlRun(r: CrawlRunRow): CrawlRun {
  return {
    id: r.id, store_id: r.store_id, status: r.status as CrawlRun["status"], strategy: r.strategy,
    products_found: r.products_found, pages_fetched: r.pages_fetched, pages_failed: r.pages_failed,
    log: (Array.isArray(r.log) ? r.log : []) as CrawlLogEntry[], error: r.error,
    started_at: isoOrNull(r.started_at), finished_at: isoOrNull(r.finished_at),
    created_at: iso(r.created_at), updated_at: iso(r.updated_at),
  };
}

// ---------- checkout events / orders ----------
export interface CheckoutEventRow {
  id: number; checkout_id: string; from_state: string | null; to_state: string;
  message: string | null; data: unknown; created_at: string;
}
export function toCheckoutEvent(r: CheckoutEventRow): CheckoutEvent {
  return {
    id: r.id, checkout_id: r.checkout_id, from_state: r.from_state as CheckoutState | null,
    to_state: r.to_state as CheckoutState, message: r.message,
    data: (r.data ?? {}) as CheckoutEventData, created_at: iso(r.created_at),
  };
}

// ---------- scans (DECISIONS §A) ----------
export interface ScanRow {
  id: string; store_id: string; url: string; mode: string; status: string; platform: string;
  best_method: string; probes: unknown; score: number; grade: string; checks: unknown;
  after: unknown; recommendations: unknown; created_at: string; updated_at: string;
}
const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
/** Row -> the exact ScanReport contract. Also usable in the browser on Realtime payloads (payload.new). */
export function toScanReport(r: ScanRow): ScanReport {
  return {
    id: r.id, store_id: r.store_id, url: r.url,
    mode: r.mode as ScanReport["mode"], status: r.status as ScanReport["status"],
    platform: asPlatform(r.platform), best_method: r.best_method as ScanReport["best_method"],
    probes: asArray<ScanReport["probes"][number]>(r.probes),
    score: r.score, grade: r.grade as ScanReport["grade"],
    checks: asArray<ScanReport["checks"][number]>(r.checks),
    after: (r.after as ScanReport["after"]) ?? null,
    recommendations: asArray<string>(r.recommendations),
    created_at: iso(r.created_at), updated_at: iso(r.updated_at),
  };
}
export interface OrderRow {
  id: string; checkout_id: string; store_id: string; merchant_order_id: string | null;
  merchant_order_url: string | null; status: string; rail: string; payment_reference: string | null;
  payer: string | null; amount_minor: number; currency: string; created_at: string;
}
export function toOrder(r: OrderRow): Order {
  return {
    id: r.id, checkout_id: r.checkout_id, store_id: r.store_id, status: r.status as Order["status"],
    merchant_order_id: r.merchant_order_id, merchant_order_url: r.merchant_order_url,
    payment: {
      rail: r.rail as PaymentRailId, reference: r.payment_reference ?? "",
      amount: { amount: r.amount_minor, currency: r.currency },
      ...(r.payer ? { payer: r.payer } : {}),
    },
    created_at: iso(r.created_at),
  };
}
