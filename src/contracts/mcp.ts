import { z } from "zod";
import type { IndexedProduct } from "@/contracts/catalog";
import {
  CompleteCheckoutInputSchema, CreateCheckoutInputSchema, UpdateCheckoutInputSchema,
  type CheckoutSession,
} from "@/contracts/checkout";
import { PLATFORMS } from "@/contracts/primitives";
import type { ScanReport, ScanStartResult } from "@/contracts/scan";
import type { CrawlRun, CrawlRunStatus, Store, StoreSummary } from "@/contracts/store";

// Rule: a tool's structuredContent === the JSON body of its REST twin.
// B7: catalog outputs use the UCP product shape. Its exact fields are owned by WS3
// (src/features/catalog/formats/ucp.ts toUcpProduct, spec 03 §6.4); contracts keep it open.
export interface UcpProduct { id: string; title: string; [key: string]: unknown }
// Every tool also returns content: [{ type: "text", text: <1-3 line summary> }].

/** Optional UCP agent metadata. Logged to checkouts.agent_profile / never required. */
export const UcpMetaSchema = z
  .looseObject({
    "ucp-agent": z.looseObject({ profile: z.string().max(2048).optional() }).optional(),
  })
  .optional()
  .describe("Optional UCP agent metadata: { 'ucp-agent': { profile } }");

const Id = z.uuid();

// ---------- catalog (WS3: src/infrastructure/mcp/tools/catalog.ts) ----------
export const ListStoresInputSchema = z.object({
  query: z.string().trim().max(200).optional().describe("Matches store name or domain"),
  platform: z.enum(PLATFORMS).optional(),
  has_checkout: z.boolean().optional().describe("true = only stores with a headless checkout connector"),
  limit: z.number().int().min(1).max(50).optional().describe("Default 20"),
  meta: UcpMetaSchema,
});
export interface ListStoresOutput { stores: StoreSummary[] }

export const SearchCatalogInputSchema = z.object({
  catalog: z.object({
    query: z.string().trim().max(500).optional()
      .describe("Keywords only, e.g. 'hoodie'. Put price limits in filters.price, not in the query."),
    store: z.string().trim().max(255).optional()
      .describe("Store slug, domain or id. Omit to search all stores."),
    filters: z.object({
      price: z.object({
        min: z.number().int().min(0).optional(),
        max: z.number().int().min(0).optional(),
      }).optional().describe("Integer minor units (cents), e.g. $50 = 5000"),
      available: z.boolean().optional().describe("Default true (in stock only)"),
      brands: z.array(z.string().max(100)).max(20).optional(),
      categories: z.array(z.string().max(100)).max(20).optional(),
    }).optional(),
    context: z.object({
      currency: z.string().length(3).toUpperCase().optional(),
      address_country: z.string().length(2).toUpperCase().optional(),
      language: z.string().max(35).optional(),
    }).optional(),
    pagination: z.object({
      cursor: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(50).optional().describe("Default 10"),
    }).optional(),
  }),
  meta: UcpMetaSchema,
});
export interface SearchCatalogOutput {
  products: UcpProduct[];     // "summary" mode (B7); built from ProductSummary ids + hydration, score copied over
  pagination: { cursor: string | null; has_next_page: boolean; total_count: number };
  [key: string]: unknown;     // WS3 extras, e.g. ucp envelope, messages
}

export const LookupCatalogInputSchema = z.object({
  catalog: z.object({
    ids: z.array(z.string().trim().min(1).max(100)).min(1).max(10)
      .describe("Product ids, variant ids, or '{store_slug}:{product_seq}'"),
  }),
  meta: UcpMetaSchema,
});
export interface LookupCatalogOutput { products: UcpProduct[]; not_found: string[]; [key: string]: unknown } // + UCP messages

export const GetProductInputSchema = z.object({
  catalog: z.object({
    id: z.string().trim().min(1).max(100).describe("Product id, variant id, or '{store_slug}:{product_seq}'"),
    verify: z.boolean().optional().describe("true = re-check live price/stock on the merchant site first"),
    selected: z.array(z.object({ name: z.string(), label: z.string() })).max(3).optional()
      .describe("Selected options, e.g. [{name:'Size', label:'M'}]; narrows variants and reports option availability"),
  }),
  meta: UcpMetaSchema,
});
export interface GetProductOutput {
  product: UcpProduct;        // "full" mode (B7)
  verification?: { verified_at: string; ok: boolean; changed_variant_ids: string[]; errors: string[] };
}
/** GET /api/v1/products/{id}?format=indexed (REST only, B7). */
export interface GetProductIndexedOutput {
  product: IndexedProduct;
  verification?: GetProductOutput["verification"];
}

// ---------- indexing (WS2: src/features/crawl/mcp-tools.ts) ----------
export const IndexStoreInputSchema = z.object({
  url: z.string().trim().min(3).max(2048).describe("Store homepage URL or domain, e.g. 'www.bulk.com/uk'"),
  meta: UcpMetaSchema,
});
/** = POST /api/v1/stores body (WS2 02 §15.1(c)). reused = an active run (< 6 min) was returned; cached = no new crawl was needed. */
export interface IndexStoreResult {
  store: Store;
  crawl_run_id: string;
  status: CrawlRunStatus;
  reused: boolean;
  cached: boolean;
}
export type IndexStoreOutput = IndexStoreResult;

export const GetCrawlStatusInputSchema = z.object({ crawl_run_id: Id, meta: UcpMetaSchema });
export type GetCrawlStatusOutput = CrawlRun; // WS2 returns getCrawlRunView(id), a superset of CrawlRun

// ---------- scan (WS2: src/features/crawl/mcp-tools.ts, DECISIONS §A) ----------
export const ScanStoreInputSchema = z.object({
  url: z.string().trim().min(3).max(2048).describe('Store homepage URL or domain, e.g. "https://www.bulk.com/uk" or "bulk.com".'),
  mode: z.enum(["cascade", "full"]).optional().describe('Default "cascade": stop at the first access method that works.'),
  meta: UcpMetaSchema,
});
export type ScanStoreOutput = ScanStartResult; // {scan_id, store_id, status_url, report_url} = POST /api/v1/scans 202 body

export const GetScanInputSchema = z.object({ scan_id: z.uuid().describe("From scan_store."), meta: UcpMetaSchema });
export type GetScanOutput = ScanReport;           // = GET /api/v1/scans/{id}

// ---------- checkout (WS4: src/features/checkout/mcp-tools.ts) ----------
export const CreateCheckoutToolInputSchema = z.object({
  checkout: CreateCheckoutInputSchema,
  idempotency_key: z.string().min(1).max(255).optional(),
  meta: UcpMetaSchema,
});
export const UpdateCheckoutToolInputSchema = z.object({ id: Id, checkout: UpdateCheckoutInputSchema, meta: UcpMetaSchema });
export const GetCheckoutToolInputSchema = z.object({ id: Id, meta: UcpMetaSchema });
export const CompleteCheckoutToolInputSchema = z.object({ id: Id, checkout: CompleteCheckoutInputSchema, meta: UcpMetaSchema });
export const CancelCheckoutToolInputSchema = z.object({ id: Id, meta: UcpMetaSchema });
export const GetOrderToolInputSchema = z.object({ id: Id.describe("Order id (CheckoutSession.order.id)"), meta: UcpMetaSchema });
export type CheckoutToolOutput = CheckoutSession; // create/update/get/complete/cancel_checkout
// get_order output: Order
// CCR-W4-R2-6: WS4's registrar registers create_checkout / update_checkout with its own
// CreateCheckoutMcpInputSchema / UpdateCheckoutMcpInputSchema (spec 04 §12.1), which extend the two
// schemas above to ALSO accept Shopify/UCP line items { item: { id }, quantity } (id may carry a
// "sz:variant:" prefix) and normalize them to { variant_id, quantity } before calling the service.
// The contract schemas stay the REST shape; MCP_TOOL_INPUTS keeps them for docs.

// ---------- demo wallet (WS4: /api/demo-wallet/mcp, test mode only) ----------
export const WalletIssueSptInputSchema = z.object({
  checkout_id: Id,
  amount: z.number().int().min(1).describe("Minor units; must equal the checkout total"),
  currency: z.string().length(3).toUpperCase(),
});
export interface WalletIssueSptOutput { token: string; expires_at: string | null; test_mode: true }

// ---------- registry ----------
export const MCP_TOOL_INPUTS = {
  list_stores: ListStoresInputSchema,
  search_catalog: SearchCatalogInputSchema,
  lookup_catalog: LookupCatalogInputSchema,
  get_product: GetProductInputSchema,
  index_store: IndexStoreInputSchema,
  get_crawl_status: GetCrawlStatusInputSchema,
  scan_store: ScanStoreInputSchema,
  get_scan: GetScanInputSchema,
  create_checkout: CreateCheckoutToolInputSchema,
  update_checkout: UpdateCheckoutToolInputSchema,
  get_checkout: GetCheckoutToolInputSchema,
  complete_checkout: CompleteCheckoutToolInputSchema,
  cancel_checkout: CancelCheckoutToolInputSchema,
  get_order: GetOrderToolInputSchema,
} as const;
export type McpToolName = keyof typeof MCP_TOOL_INPUTS;

export const DEMO_WALLET_TOOL_INPUTS = {
  wallet_issue_spt: WalletIssueSptInputSchema,
} as const;

/** Shape every tool handler returns (assignable to the SDK's CallToolResult). */
export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}
