/* eslint-disable @typescript-eslint/no-unused-vars -- stub parameters, removed with the T+60 bodies */
import "server-only";
import type {
  IndexedProduct, IndexedVariant, NormalizedProduct, Offer, ProductSummary, ResolvedLine, SearchParams, SearchResult,
  Store,
} from "@/lib/contracts";
import { SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT } from "@/lib/contracts";
import { AppError, toAppError } from "@/lib/errors";
import { db } from "./client";

// TODO(WS1 T+60)
/**
 * WS2 CCR-1 semantics (B12). Never throws for a bad product or a failed chunk:
 * - invalid input → skipped[] (zod / mixed currency);
 * - DB failure for a product (e.g. handle collision with a different product, 23505) → failed[]; WS2 retries with a hashed handle;
 * - variants missing from the new payload are NOT deleted: they get available=false, availability='out_of_stock' and sort last;
 * - an unchanged content_hash skips the write but still bumps last_seen_at (= opts.seenAt ?? now()); counted in unchanged.
 * upserted counts written + unchanged products; product_ids lists both.
 */
export async function upsertStoreProducts(
  storeId: string,
  products: NormalizedProduct[],
  opts?: { seenAt?: string },
): Promise<{
  upserted: number;
  unchanged: number;
  product_ids: string[];
  skipped: { url: string; reason: string }[];
  failed: { url: string; error: string }[];
}> {
  throw new AppError("not_implemented", "upsertStoreProducts");
}

// TODO(WS1 T+60)
/** id = product uuid | variant uuid (returns the parent) | "{store_slug}:{product_seq}". */
export async function getProduct(id: string): Promise<IndexedProduct | null> {
  throw new AppError("not_implemented", "getProduct");
}

// TODO(WS1 T+60)
export async function getProductByHandle(storeId: string, handle: string): Promise<IndexedProduct | null> {
  throw new AppError("not_implemented", "getProductByHandle");
}

// TODO(WS1 T+60)
/** Preserves input order; missing ids are skipped. */
export async function getProductsByIds(ids: string[]): Promise<IndexedProduct[]> {
  throw new AppError("not_implemented", "getProductsByIds");
}

// TODO(WS1 T+60)
/** WS3 CR-1: one hydrator for every lookup. All given keys are ANDed; each array is an IN list. Excludes opted-out stores. */
export async function findProducts(where: {
  ids?: string[]; variantIds?: string[]; seqs?: number[]; variantSeqs?: number[];
  storeId?: string; handles?: string[]; limit?: number;
}): Promise<IndexedProduct[]> {
  throw new AppError("not_implemented", "findProducts");
}

// TODO(WS1 T+60)
export async function lookupProducts(refs: string[]): Promise<{ products: IndexedProduct[]; not_found: string[] }> {
  throw new AppError("not_implemented", "lookupProducts");
}

// TODO(WS1 T+60)
/**
 * products.json paging (default): ordered by seq asc; page is 1-based; limit 1..250.
 * WS5 CCR-7: offset may replace page, and order "recent" = available desc, updated_at desc (store grid).
 */
export async function listStoreProducts(
  storeId: string,
  opts: { limit: number; page?: number; offset?: number; order?: "seq" | "recent" },
): Promise<{ products: IndexedProduct[]; total: number }> {
  throw new AppError("not_implemented", "listStoreProducts");
}

export async function searchProducts(params: SearchParams): Promise<SearchResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? SEARCH_DEFAULT_LIMIT), 1), SEARCH_MAX_LIMIT);
  const offset = Math.max(Math.trunc(params.offset ?? 0), 0);
  const available = params.available === undefined ? true : params.available; // null = any
  const args = {
    query_text: params.query?.trim() || undefined,
    match_count: limit,
    match_offset: offset,
    p_store_id: params.store_id ?? undefined,
    p_min_minor: params.min_minor ?? undefined,
    p_max_minor: params.max_minor ?? undefined,
    p_available: available, // true | false | null. null MUST be sent explicitly (SQL default is true)
    p_brands: params.brands?.length ? params.brands : undefined,
    p_categories: params.categories?.length ? params.categories : undefined,
    p_currency: params.currency?.toUpperCase() ?? undefined,
  };
  const { data, error } = await db().rpc("search_products", args as never); // generated arg types reject null
  if (error) throw toAppError(error);
  const rows = (data ?? []) as { id: string; score: number; total_count: number }[];
  const summaries = await getProductSummaries(rows.map((r) => r.id));
  const scoreById = new Map(rows.map((r) => [r.id, r.score]));
  const products = summaries.map((s) => ({ ...s, score: scoreById.get(s.id) }));
  const total = rows[0]?.total_count ?? 0;
  const next = offset + rows.length;
  return { products, total_count: total, next_offset: next < total ? next : null };
}

// TODO(WS1 T+60)
export async function getProductSummaries(ids: string[]): Promise<ProductSummary[]> {
  throw new AppError("not_implemented", "getProductSummaries");
}

// TODO(WS1 T+60)
/** For checkout: resolves variant uuids; throws AppError not_found listing unknown ids. */
export async function getVariantsForCheckout(
  lines: { variant_id: string; quantity: number }[],
): Promise<{ store_id: string; lines: ResolvedLine[] }[]> {
  throw new AppError("not_implemented", "getVariantsForCheckout");
}

// TODO(WS1 T+60)
/** For verifyOffer (WS2): the variant, its product and its store (opted-out stores included), or null. */
export async function getVariantForVerify(variantId: string): Promise<{
  variant: IndexedVariant;
  product: { id: string; url: string; external_id: string | null; handle: string };
  store: Store;
} | null> {
  throw new AppError("not_implemented", "getVariantForVerify");
}

// TODO(WS1 T+60)
/** Persists a live re-check (verifyOffer) and recomputes the parent's price range/availability. */
export async function updateVariantOffer(variantId: string, offer: Offer): Promise<void> {
  throw new AppError("not_implemented", "updateVariantOffer");
}
