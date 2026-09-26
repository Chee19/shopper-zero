import { z } from "zod";
import { CACHE, readRateLimit, ucpAgentProfile } from "@/lib/agent/http";
import { logHit } from "@/lib/agent/log";
import { catalogSearch, type CatalogSearchInput } from "@/lib/agent/search";
import { json, parseSearchParams, preflight, route } from "@/lib/http";

/** Repeatable or comma-separated list param. */
const list = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) =>
    v === undefined
      ? undefined
      : (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean),
  )
  .pipe(z.array(z.string().max(100)).max(20).optional());

const QuerySchema = z.object({
  q: z.string().trim().max(500).optional(),
  store: z.string().trim().max(255).optional(),
  min: z.coerce.number().int().min(0).optional(),
  max: z.coerce.number().int().min(0).optional(),
  available: z.enum(["true", "false", "any"]).optional(),
  brand: list,
  category: list,
  currency: z.string().length(3).toUpperCase().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().max(200).optional(),
});

/** Maps query params onto the search_catalog `catalog` input (spec 03 §7.1). */
function toCatalog(q: z.output<typeof QuerySchema>): CatalogSearchInput {
  const price = q.min !== undefined || q.max !== undefined ? { min: q.min, max: q.max } : undefined;
  const available = q.available === undefined ? undefined : q.available === "any" ? null : q.available === "true";
  return {
    query: q.q || undefined,
    store: q.store || undefined,
    filters: { price, available, brands: q.brand, categories: q.category },
    context: q.currency ? { currency: q.currency } : undefined,
    pagination: { limit: q.limit, cursor: q.cursor },
  };
}

export const GET = route("v1.search", async (req, _ctx: unknown, { requestId }) => {
  const limited = readRateLimit(req, requestId);
  if (limited) return limited;
  const q = parseSearchParams(req, QuerySchema);
  const { body, store } = await catalogSearch(toCatalog(q));
  logHit("rest", { tool: "search_catalog", storeId: store?.id ?? null, req, agentProfile: ucpAgentProfile(req) });
  return json(body, { requestId, headers: { "Cache-Control": CACHE.short } });
});

export const OPTIONS = preflight;
