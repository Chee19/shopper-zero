import "server-only";
import type {
  Availability, IndexedProduct, IndexedVariant, NormalizedProduct, Offer, ProductSummary, ResolvedLine, SearchParams,
  SearchResult, Store,
} from "@/lib/contracts";
import { LOOKUP_MAX_IDS, PRODUCTS_JSON_MAX_LIMIT, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT } from "@/lib/contracts";
import { AppError, toAppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { fromMinor } from "@/lib/money";
import { db } from "./client";
import {
  toIndexedProduct, toIndexedVariant, toProductSummary, type ProductRow, type ProductSummaryRow, type VariantRow,
} from "./mappers";
import { PRODUCT_SELECT, PRODUCT_SUMMARY_SELECT } from "./selects";
import { getStoreById } from "./stores";
import { buildUpsertRow, dedupeHandles, type ProductUpsertRow } from "./upsert-row";
import { asJson, clampInt, errorMessage, isMalformed, isUuid } from "./util";

const UPSERT_CHUNK = 25;
const FIND_DEFAULT_LIMIT = 50;
const STALE_POSITION = 1000; // upsert_product_batch moves variants missing from a crawl to position + 1000
const SLUG_SEQ_RE = /^([a-z0-9-]+):(\d+)$/;
const SEQ_RE = /^\d+$/;

const isAvailable = (a: Availability) => a === "in_stock" || a === "preorder";
const unique = <T>(xs: T[]): T[] => [...new Set(xs)];
const toSeq = (s: string): number | null => {
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
};

/** Full product read: PRODUCT_SELECT + the opted-out filter every public product read carries. */
const productQuery = () => db().from("products").select(PRODUCT_SELECT).eq("stores.opted_out", false);
const summaryQuery = () => db().from("products").select(PRODUCT_SUMMARY_SELECT).eq("stores.opted_out", false);

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
  const skipped: { url: string; reason: string }[] = [];
  const failed: { url: string; error: string }[] = [];
  const product_ids: string[] = [];
  let upserted = 0;
  let unchanged = 0;

  const rows: ProductUpsertRow[] = [];
  for (const p of products) {
    const built = buildUpsertRow(p);
    if (built.ok) rows.push(built.row);
    else skipped.push({ url: built.url, reason: built.reason });
  }
  const deduped = dedupeHandles(rows);

  for (let i = 0; i < deduped.length; i += UPSERT_CHUNK) {
    const chunk = deduped.slice(i, i + UPSERT_CHUNK);
    try {
      const { data, error } = await db().rpc("upsert_product_batch", {
        p_store_id: storeId,
        p_products: asJson(chunk),
        ...(opts?.seenAt ? { p_seen_at: opts.seenAt } : {}),
      });
      if (error) throw error;
      const results = data ?? [];
      chunk.forEach((row, j) => {
        const r = results[j];
        if (r?.product_id && (r.status === "upserted" || r.status === "unchanged")) {
          upserted++;
          if (r.status === "unchanged") unchanged++;
          product_ids.push(r.product_id);
        } else {
          failed.push({ url: row.url, error: r?.error ?? "no_result" });
        }
      });
    } catch (e) {
      const msg = errorMessage(e);
      log.warn("db.upsert_product_batch.failed", { store_id: storeId, products: chunk.length, error: msg });
      for (const row of chunk) failed.push({ url: row.url, error: msg });
    }
  }
  return { upserted, unchanged, product_ids, skipped, failed };
}

async function fetchProductWhere(
  filter: (q: ReturnType<typeof productQuery>) => ReturnType<typeof productQuery>,
): Promise<IndexedProduct | null> {
  const { data, error } = await filter(productQuery()).maybeSingle();
  if (error) {
    if (isMalformed(error)) return null;
    throw toAppError(error);
  }
  return data ? toIndexedProduct(data as unknown as ProductRow) : null;
}

/** id = product uuid | variant uuid (returns the parent) | "{store_slug}:{product_seq}". */
export async function getProduct(id: string): Promise<IndexedProduct | null> {
  const ref = id.trim();
  if (isUuid(ref)) {
    const product = await fetchProductWhere((q) => q.eq("id", ref));
    if (product) return product;
    const { data, error } = await db().from("product_variants").select("product_id").eq("id", ref).maybeSingle();
    if (error) throw toAppError(error);
    return data ? fetchProductWhere((q) => q.eq("id", data.product_id)) : null;
  }
  const m = SLUG_SEQ_RE.exec(ref);
  if (m) {
    const seq = toSeq(m[2]);
    return seq === null ? null : fetchProductWhere((q) => q.eq("stores.slug", m[1]).eq("seq", seq));
  }
  if (SEQ_RE.test(ref)) {
    const seq = toSeq(ref);
    return seq === null ? null : fetchProductWhere((q) => q.eq("seq", seq));
  }
  return null;
}

export async function getProductByHandle(storeId: string, handle: string): Promise<IndexedProduct | null> {
  if (!isUuid(storeId)) return null;
  return fetchProductWhere((q) => q.eq("store_id", storeId).eq("handle", handle));
}

/** Preserves input order; missing ids are skipped. */
export async function getProductsByIds(ids: string[]): Promise<IndexedProduct[]> {
  const wanted = unique(ids.filter(isUuid));
  if (wanted.length === 0) return [];
  const { data, error } = await productQuery().in("id", wanted);
  if (error) throw toAppError(error);
  const byId = new Map((data as unknown as ProductRow[]).map((r) => [r.id, r]));
  return wanted.flatMap((id) => {
    const r = byId.get(id);
    return r ? [toIndexedProduct(r)] : [];
  });
}

/** Parent product ids of the given variants (by uuid or by seq). */
async function parentIdsOfVariants(column: "id" | "seq", values: string[] | number[]): Promise<string[]> {
  if (values.length === 0) return [];
  const { data, error } = await db().from("product_variants").select("product_id").in(column, values);
  if (error) throw toAppError(error);
  return unique((data ?? []).map((v) => v.product_id));
}

const intersect = (a: string[] | undefined, b: string[]): string[] => (a === undefined ? b : a.filter((x) => b.includes(x)));

/** WS3 CR-1: one hydrator for every lookup. All given keys are ANDed; each array is an IN list. Excludes opted-out stores. */
export async function findProducts(where: {
  ids?: string[]; variantIds?: string[]; seqs?: number[]; variantSeqs?: number[];
  storeId?: string; handles?: string[]; limit?: number;
}): Promise<IndexedProduct[]> {
  const limit = clampInt(where.limit, 1, PRODUCTS_JSON_MAX_LIMIT, FIND_DEFAULT_LIMIT);
  if (where.storeId !== undefined && !isUuid(where.storeId)) return [];

  // Resolve every id-shaped key to one AND-ed list of product ids. An empty IN list matches nothing.
  let ids: string[] | undefined;
  if (where.ids) ids = unique(where.ids.filter(isUuid));
  if (where.variantIds) ids = intersect(ids, await parentIdsOfVariants("id", unique(where.variantIds.filter(isUuid))));
  if (where.variantSeqs) {
    const seqs = unique(where.variantSeqs.filter(Number.isSafeInteger));
    ids = intersect(ids, await parentIdsOfVariants("seq", seqs));
  }
  if (ids?.length === 0 || where.seqs?.length === 0 || where.handles?.length === 0) return [];

  let q = productQuery();
  if (ids) q = q.in("id", ids);
  if (where.seqs) q = q.in("seq", unique(where.seqs));
  if (where.storeId) q = q.eq("store_id", where.storeId);
  if (where.handles) q = q.in("handle", unique(where.handles));
  const { data, error } = await q.order("seq", { ascending: true }).limit(limit);
  if (error) throw toAppError(error);
  return (data as unknown as ProductRow[]).map(toIndexedProduct);
}

export async function lookupProducts(refs: string[]): Promise<{ products: IndexedProduct[]; not_found: string[] }> {
  if (refs.length > LOOKUP_MAX_IDS) {
    throw new AppError("validation_error", `At most ${LOOKUP_MAX_IDS} ids per lookup`, { max: LOOKUP_MAX_IDS });
  }
  const resolved = await Promise.all(refs.map((ref) => getProduct(ref)));
  const products: IndexedProduct[] = [];
  const seen = new Set<string>();
  const not_found: string[] = [];
  resolved.forEach((p, i) => {
    if (!p) {
      not_found.push(refs[i]);
    } else if (!seen.has(p.id)) {
      seen.add(p.id);
      products.push(p);
    }
  });
  return { products, not_found };
}

/**
 * products.json paging (default): ordered by seq asc; page is 1-based; limit 1..250.
 * WS5 CCR-7: offset may replace page, and order "recent" = available desc, updated_at desc (store grid).
 */
export async function listStoreProducts(
  storeId: string,
  opts: { limit: number; page?: number; offset?: number; order?: "seq" | "recent" },
): Promise<{ products: IndexedProduct[]; total: number }> {
  if (!isUuid(storeId)) return { products: [], total: 0 };
  const limit = clampInt(opts.limit, 1, PRODUCTS_JSON_MAX_LIMIT, PRODUCTS_JSON_MAX_LIMIT);
  const start = opts.offset !== undefined
    ? clampInt(opts.offset, 0, Number.MAX_SAFE_INTEGER, 0)
    : (clampInt(opts.page, 1, Number.MAX_SAFE_INTEGER, 1) - 1) * limit;
  let q = db()
    .from("products")
    .select(PRODUCT_SELECT, { count: "exact" })
    .eq("stores.opted_out", false)
    .eq("store_id", storeId);
  q = opts.order === "recent"
    ? q.order("available", { ascending: false }).order("updated_at", { ascending: false }).order("seq")
    : q.order("seq", { ascending: true });
  const { data, error, count } = await q.range(start, start + limit - 1);
  if (error) {
    // PostgREST answers 416 / PGRST103 when the offset is past the end, without a usable count.
    if (error.code === "PGRST103") return { products: [], total: count ?? (await countStoreProducts(storeId)) };
    throw toAppError(error);
  }
  const products = (data as unknown as ProductRow[]).map(toIndexedProduct);
  return { products, total: count ?? (await countStoreProducts(storeId)) };
}

/** Same filter as listStoreProducts, count only (head request, no rows). */
async function countStoreProducts(storeId: string): Promise<number> {
  const { count, error } = await db()
    .from("products")
    .select("id, stores!inner(opted_out)", { count: "exact", head: true })
    .eq("stores.opted_out", false)
    .eq("store_id", storeId);
  if (error) throw toAppError(error);
  return count ?? 0;
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
  type SearchRow = { id: string; score: number; total_count: number };
  const { data, error } = await db().rpc("search_products", args as never); // generated arg types reject null
  if (error) throw toAppError(error);
  const rows = (data ?? []) as SearchRow[];
  const summaries = await getProductSummaries(rows.map((r) => r.id));
  const scoreById = new Map(rows.map((r) => [r.id, r.score]));
  const products = summaries.map((s) => ({ ...s, score: scoreById.get(s.id) }));
  let total = rows[0]?.total_count ?? 0;
  if (rows.length === 0 && offset > 0) {
    // Past the end: total_count rides on the rows, so ask again from the start for the total only.
    const { data: first, error: e2 } = await db().rpc("search_products", { ...args, match_count: 1, match_offset: 0 } as never);
    if (e2) throw toAppError(e2);
    total = ((first ?? []) as SearchRow[])[0]?.total_count ?? 0;
  }
  const next = offset + rows.length;
  return { products, total_count: total, next_offset: next < total ? next : null };
}

export async function getProductSummaries(ids: string[]): Promise<ProductSummary[]> {
  const wanted = unique(ids.filter(isUuid));
  if (wanted.length === 0) return [];
  const { data, error } = await summaryQuery().in("id", wanted);
  if (error) throw toAppError(error);
  const byId = new Map((data as unknown as ProductSummaryRow[]).map((r) => [r.id, r]));
  return wanted.flatMap((id) => {
    const r = byId.get(id);
    return r ? [toProductSummary(r)] : [];
  });
}

type CheckoutVariantRow = VariantRow & {
  products: { id: string; title: string; url: string; handle: string; external_id: string | null; store_id: string };
};

/** For checkout: resolves variant uuids; throws AppError not_found listing unknown ids. */
export async function getVariantsForCheckout(
  lines: { variant_id: string; quantity: number }[],
): Promise<{ store_id: string; lines: ResolvedLine[] }[]> {
  const ids = unique(lines.map((l) => l.variant_id));
  const valid = ids.filter(isUuid);
  let rows: CheckoutVariantRow[] = [];
  if (valid.length > 0) {
    const { data, error } = await db()
      .from("product_variants")
      .select("*, products!inner(id, title, url, handle, external_id, store_id, stores!inner(opted_out))")
      .in("id", valid)
      .eq("products.stores.opted_out", false);
    if (error) throw toAppError(error);
    rows = data as unknown as CheckoutVariantRow[];
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new AppError("not_found", "Unknown variant(s)", { missing });

  const groups = new Map<string, ResolvedLine[]>();
  for (const line of lines) {
    const v = byId.get(line.variant_id)!;
    const { id, title, url, handle, external_id, store_id } = v.products;
    const group = groups.get(store_id) ?? [];
    group.push({ variant: toIndexedVariant(v), product: { id, title, url, handle, external_id }, quantity: line.quantity });
    groups.set(store_id, group);
  }
  return [...groups].map(([store_id, resolved]) => ({ store_id, lines: resolved }));
}

type VerifyVariantRow = VariantRow & {
  products: { id: string; url: string; external_id: string | null; handle: string; store_id: string };
};

/** For verifyOffer (WS2): the variant, its product and its store (opted-out stores included), or null. */
export async function getVariantForVerify(variantId: string): Promise<{
  variant: IndexedVariant;
  product: { id: string; url: string; external_id: string | null; handle: string };
  store: Store;
} | null> {
  if (!isUuid(variantId)) return null;
  const { data, error } = await db()
    .from("product_variants")
    .select("*, products!inner(id, url, external_id, handle, store_id)")
    .eq("id", variantId)
    .maybeSingle();
  if (error) {
    if (isMalformed(error)) return null;
    throw toAppError(error);
  }
  if (!data) return null;
  const row = data as unknown as VerifyVariantRow;
  const store = await getStoreById(row.products.store_id);
  if (!store) return null;
  const { id, url, external_id, handle } = row.products;
  return { variant: toIndexedVariant(row), product: { id, url, external_id, handle }, store };
}

/** Persists a live re-check (verifyOffer) and recomputes the parent's price range/availability. */
export async function updateVariantOffer(variantId: string, offer: Offer): Promise<void> {
  const { data: updated, error } = await db()
    .from("product_variants")
    .update({
      price_minor: offer.price.amount,
      compare_at_minor: offer.compare_at?.amount ?? null,
      currency: offer.price.currency,
      availability: offer.availability,
      available: isAvailable(offer.availability),
      checked_at: offer.checked_at,
      ...(offer.url ? { url: offer.url } : {}),
    })
    .eq("id", variantId)
    .select("product_id")
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!updated) throw new AppError("not_found", "Variant not found", { id: variantId });

  const { data: siblings, error: sibErr } = await db()
    .from("product_variants")
    .select("price_minor, currency, availability, available, position")
    .eq("product_id", updated.product_id);
  if (sibErr) throw toAppError(sibErr);
  const all = siblings ?? [];
  if (all.length === 0) return;
  // Variants a later crawl no longer saw (position >= 1000) do not set the price range, as in the upsert.
  const current = all.filter((v) => v.position < STALE_POSITION);
  const basis = current.length > 0 ? current : all;
  const prices = basis.map((v) => v.price_minor);
  const min = Math.min(...prices);
  const avs = basis.map((v) => v.availability);
  const availability: Availability = avs.includes("in_stock") ? "in_stock"
    : avs.includes("preorder") ? "preorder"
    : avs.every((a) => a === "out_of_stock") ? "out_of_stock" : "unknown";
  const { error: upErr } = await db()
    .from("products")
    .update({
      price_min_minor: min,
      price_max_minor: Math.max(...prices),
      available: all.some((v) => v.available),
      price: Number(fromMinor(min, basis[0].currency)), // legacy columns, kept in sync like the upsert does
      availability,
    })
    .eq("id", updated.product_id);
  if (upErr) throw toAppError(upErr);
}
