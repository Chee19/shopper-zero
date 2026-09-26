// src/lib/agent/search.ts  (WS3): catalogSearch(), shared by the search_catalog tool and GET /api/v1/search.
import "server-only";
import type { z } from "zod";
import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  type SearchCatalogInputSchema,
  type Store,
} from "@/contracts";
import { getProductsByIds, resolveStore, searchProducts } from "@/infrastructure/database";
import { appUrl } from "@/shared/env";
import { AppError } from "@/shared/errors";
import { plainInline } from "@/features/catalog/formats/text";
import { CAP_SEARCH, toUcpProduct, ucpEnvelope, type UcpMessage } from "@/features/catalog/formats/ucp";
import { decodeCursor, encodeCursor, MAX_OFFSET } from "@/features/catalog/cursor";

type ToolCatalog = z.output<typeof SearchCatalogInputSchema>["catalog"];
/** The search_catalog `catalog` input; REST may also pass filters.available = null ("any"). */
export type CatalogSearchInput = Omit<ToolCatalog, "filters"> & {
  filters?: Omit<NonNullable<ToolCatalog["filters"]>, "available"> & { available?: boolean | null };
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Resolve a store ref for agents: unknown and opted-out stores are both not_found (never revealed). */
export async function resolveAgentStore(ref: string): Promise<Store> {
  const store = await resolveStore(ref);
  if (!store || store.opted_out) throw new AppError("not_found", `No indexed store matches '${ref}'. Call list_stores.`);
  return store;
}

export async function catalogSearch(catalog: CatalogSearchInput, opts: { defaultStore?: string | null } = {}) {
  const ref = catalog.store ?? opts.defaultStore ?? null;
  const store = ref ? await resolveAgentStore(ref) : null;

  const limit = clamp(catalog.pagination?.limit ?? SEARCH_DEFAULT_LIMIT, 1, SEARCH_MAX_LIMIT);
  const offset = decodeCursor(catalog.pagination?.cursor);

  const f = catalog.filters;
  const price = f?.price;
  if (price?.min != null && price?.max != null && price.min > price.max) {
    throw new AppError("validation_error", "filters.price.min must be less than or equal to filters.price.max.", {
      min: price.min,
      max: price.max,
    });
  }
  const hasPriceFilter = price?.min != null || price?.max != null;

  const result = await searchProducts({
    query: catalog.query || null,
    store_id: store?.id ?? null,
    min_minor: price?.min ?? null,
    max_minor: price?.max ?? null,
    available: f?.available === undefined ? true : f.available,
    brands: f?.brands?.length ? f.brands : null,
    categories: f?.categories?.length ? f.categories : null,
    currency: hasPriceFilter && catalog.context?.currency ? catalog.context.currency : null,
    limit,
    offset,
  });

  const scores = new Map(result.products.map((p) => [p.id, p.score]));
  const full = await getProductsByIds(result.products.map((p) => p.id));
  const base = appUrl();
  const products = full.map((p) => toUcpProduct(p, "summary", { base, score: scores.get(p.id) }));

  const next = result.next_offset != null && result.next_offset <= MAX_OFFSET ? result.next_offset : null;
  const messages: UcpMessage[] = [];
  if (products.length === 0 && catalog.query) {
    messages.push({
      type: "info",
      code: "no_results",
      content: "No matches. Try fewer keywords, remove filters, or ask to scan/index a store that is missing.",
    });
  }

  const body = {
    ucp: ucpEnvelope([CAP_SEARCH]),
    products,
    pagination: { cursor: next != null ? encodeCursor(next) : null, has_next_page: next != null, total_count: result.total_count },
    messages,
  };
  return { body, store };
}

export function searchSummary(body: Awaited<ReturnType<typeof catalogSearch>>["body"], catalog: CatalogSearchInput, store: Store | null) {
  const where = store ? ` in ${plainInline(store.name ?? "", 80) || plainInline(store.domain, 80)}` : "";
  const query = plainInline(catalog.query ?? "", 80);
  const q = query ? ` for "${query}"` : "";
  const more = body.pagination.has_next_page ? ", more available" : "";
  return `Found ${body.pagination.total_count} products${where}${q}; showing ${body.products.length}${more}.`;
}
