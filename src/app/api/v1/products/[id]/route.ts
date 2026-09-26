import { z } from "zod";
import { CACHE, readRateLimit, ucpAgentProfile } from "@/lib/agent/http";
import { logHit } from "@/lib/agent/log";
import { productDetail } from "@/lib/agent/product";
import { json, parseSearchParams, preflight, route } from "@/lib/http";

const selectedPair = z
  .string()
  .max(200)
  .transform((s, ctx) => {
    const i = s.indexOf(":");
    const name = i > 0 ? s.slice(0, i).trim() : "";
    const label = i > 0 ? s.slice(i + 1).trim() : "";
    if (!name || !label) {
      ctx.addIssue({ code: "custom", message: 'selected must be "Name:Label", e.g. Size:M' });
      return z.NEVER;
    }
    return { name, label };
  });

const QuerySchema = z.object({
  verify: z.enum(["1", "true", "0", "false"]).optional(),
  format: z.enum(["ucp", "indexed"]).optional(),
  selected: z
    .union([selectedPair, z.array(selectedPair)])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]))
    .pipe(z.array(z.object({ name: z.string(), label: z.string() })).max(3).optional()),
});

export const GET = route("v1.product", async (req, ctx: RouteContext<"/api/v1/products/[id]">, { requestId }) => {
  const limited = readRateLimit(req, requestId);
  if (limited) return limited;
  const { id } = await ctx.params;
  const q = parseSearchParams(req, QuerySchema);
  const verify = q.verify === "1" || q.verify === "true";
  const detail = await productDetail(id.trim(), { verify, selected: q.selected });
  logHit("rest", {
    tool: "get_product",
    storeId: detail.indexed.store.id,
    req,
    agentProfile: ucpAgentProfile(req),
  });
  // B7: UCP shape by default; raw IndexedProduct with ?format=indexed.
  const body =
    q.format === "indexed"
      ? { product: detail.indexed, ...(detail.verification ? { verification: detail.verification } : {}) }
      : detail.body;
  return json(body, { requestId, headers: { "Cache-Control": verify ? CACHE.none : CACHE.short } });
});

export const OPTIONS = preflight;
