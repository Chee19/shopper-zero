import { z } from "zod";
import {
  AVAILABILITIES, EXTRACTION_SOURCES, MoneySchema,
  type CheckoutConnectorId, type IsoDateTime, type Money, type Platform,
} from "@/contracts/primitives";

// ---------- crawler output (WS2 produces; validated by db.upsertStoreProducts) ----------
export const OfferSchema = z.object({
  price: MoneySchema,
  compare_at: MoneySchema.nullable(),            // strikethrough / list price
  availability: z.enum(AVAILABILITIES),
  url: z.url({ protocol: /^https?$/ }).nullable(),                      // PDP URL with this variant selected
  checked_at: z.iso.datetime({ offset: true }),  // when price/stock was observed
});
export type Offer = z.infer<typeof OfferSchema>;

export const NormalizedVariantSchema = z.object({
  external_id: z.string().min(1).max(255).nullable(), // source variant id / sku; stable across crawls. Woo: Store API purchasable id (B9). WS2 always fills it.
  title: z.string().min(1).max(500),                   // "M / Blue" or "Default Title"
  options: z.record(z.string(), z.string()),           // { Size: "M", Color: "Blue" }
  sku: z.string().max(255).nullable(),
  gtin: z.string().max(64).nullable(),
  image_url: z.url({ protocol: /^https?$/ }).nullable(),
  inventory_quantity: z.number().int().nullable(),
  offer: OfferSchema,
});
export type NormalizedVariant = z.infer<typeof NormalizedVariantSchema>;

export const NormalizedProductSchema = z.object({
  external_id: z.string().min(1).max(255).nullable(), // productGroupID ?? productID ?? sku. Woo: the Woo product id (B9)
  url: z.url({ protocol: /^https?$/ }),                                        // canonical absolute PDP URL on the merchant site
  handle: z.string().min(1).max(255),                  // slug.ts handleFromUrl(url) unless the platform gives one
  title: z.string().min(1).max(500),
  description_html: z.string().nullable(),
  description_text: z.string().nullable(),
  brand: z.string().max(255).nullable(),
  product_type: z.string().max(255).nullable(),
  category: z.string().max(500).nullable(),
  tags: z.array(z.string().max(100)).max(100),
  images: z.array(z.object({ url: z.url({ protocol: /^https?$/ }), alt: z.string().optional() })).max(50), // hotlinked, never re-hosted
  options: z.array(z.object({ name: z.string().min(1), values: z.array(z.string()) })).max(10), // products.json emits the first 3
  variants: z.array(NormalizedVariantSchema).min(1).max(250), // ALWAYS >= 1 (synthesize "Default Title")
  source: z.enum(EXTRACTION_SOURCES),
  raw: z.unknown().optional(),                         // source payload -> products.raw (dropped if > 100 KB)
});
export type NormalizedProduct = z.infer<typeof NormalizedProductSchema>;

// ---------- indexed (DB/API shape; WS1 maps, WS3 serializes) ----------
export interface StoreRef {
  id: string;
  slug: string;
  name: string | null;
  domain: string;
  platform: Platform;
}

export interface IndexedVariant extends NormalizedVariant {
  id: string;          // uuid (MCP/REST id, checkout line_items[].variant_id)
  seq: number;         // numeric id (products.json variants[].id)
  product_id: string;  // uuid
  external_id: string; // always set once stored (db derives a key when the source had none)
  position: number;    // 1-based
}

export interface IndexedProduct extends Omit<NormalizedProduct, "variants" | "raw"> {
  id: string;                        // uuid, used by MCP/REST
  seq: number;                       // numeric id, used by products.json
  store: StoreRef;
  price_range: { min: Money; max: Money };
  available: boolean;                // any variant in_stock or preorder
  variants: IndexedVariant[];        // ordered by position
  checkout_methods: CheckoutConnectorId[]; // e.g. ["woo_store_api", "handoff"] or ["handoff"]
  updated_at: IsoDateTime;
}

/** "IndexedProduct-lite": search results and list views. */
export interface ProductSummary {
  id: string;
  seq: number;
  handle: string;
  title: string;
  brand: string | null;
  product_type: string | null;
  url: string;
  image_url: string | null;          // images[0].url
  price_range: { min: Money; max: Money };
  available: boolean;
  variants_count: number;
  store: StoreRef;
  checkout_methods: CheckoutConnectorId[];
  score?: number;                    // search relevance, present only on search results
}

/** Normalized search parameters (db.searchProducts). Defaults applied by the db helper. */
export interface SearchParams {
  query?: string | null;
  store_id?: string | null;
  min_minor?: number | null;
  max_minor?: number | null;
  available?: boolean | null;        // default true; null = any
  brands?: string[] | null;
  categories?: string[] | null;      // matches category or product_type, case-insensitive
  currency?: string | null;
  limit?: number;                    // default 10, clamped 1..50
  offset?: number;                   // default 0
}

export interface SearchResult {
  products: ProductSummary[];
  total_count: number;
  next_offset: number | null;        // null when no more pages
}
