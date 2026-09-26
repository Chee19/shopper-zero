import { z } from "zod";

// ---------- money ----------
/** amount = INTEGER minor units (cents); currency = ISO 4217, upper-case. */
export type Money = { amount: number; currency: string };
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, "ISO 4217 upper-case code");
export const MoneySchema = z.object({
  amount: z.number().int().min(0),
  currency: CurrencySchema,
});

/** ISO 8601 UTC timestamp string, e.g. "2026-09-26T10:00:00.000Z". */
export type IsoDateTime = string;

// ---------- enumerations (single source of truth; DB CHECK constraints mirror these) ----------
export const AVAILABILITIES = ["in_stock", "out_of_stock", "preorder", "unknown"] as const;
export type Availability = (typeof AVAILABILITIES)[number];

export const PLATFORMS = [
  "woocommerce", "magento", "bigcommerce", "squarespace", "sfcc",
  "prestashop", "wix", "shopify", "custom", "unknown",
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const EXTRACTION_SOURCES = ["platform_api", "jsonld", "microdata", "opengraph", "render", "llm", "dom_recipe"] as const; // dom_recipe: WS2 stretch tier
export type ExtractionSource = (typeof EXTRACTION_SOURCES)[number];

export const CHECKOUT_CONNECTOR_IDS = ["woo_store_api", "magento_guest", "handoff", "browser", "provence_demo"] as const;
export type CheckoutConnectorId = (typeof CHECKOUT_CONNECTOR_IDS)[number];

export const PAYMENT_RAIL_IDS = ["stripe_spt"] as const;
export type PaymentRailId = (typeof PAYMENT_RAIL_IDS)[number];

export const AGENT_SURFACES = ["mcp", "rest", "products_json", "feed", "llms_txt", "ucp", "openapi", "agent_card"] as const;
export type AgentSurface = (typeof AGENT_SURFACES)[number];

// ---------- protocol constants (pin here, import everywhere) ----------
export const UCP_VERSION = "2026-08-25" as const;
export const UCP_SUPPORTED_VERSIONS = ["2026-08-25", "2026-04-08"] as const;
export const ACP_VERSION = "2026-04-17" as const;
export const PAYMENT_HANDLER_IDS = {
  stripe_spt: "app.shoperzero.stripe_spt",
} as const;
export type PaymentHandlerId = (typeof PAYMENT_HANDLER_IDS)[PaymentRailId];

// ---------- limits ----------
export const QUOTE_TTL_SECONDS = 600;          // checkout quote validity (10 min)
export const DEFAULT_MAX_PRODUCTS_PER_CRAWL = 150;
export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_LIMIT = 50;
export const LOOKUP_MAX_IDS = 10;
export const LIST_STORES_MAX_LIMIT = 50;
export const PRODUCTS_JSON_DEFAULT_LIMIT = 30;  // Shopify default
export const PRODUCTS_JSON_MAX_LIMIT = 250;
