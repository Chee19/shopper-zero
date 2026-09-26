import { z } from "zod";
import { route, json, parseJsonBody, parseSearchParams, preflight, errorResponse } from "@/shared/http";
import { listStores } from "@/infrastructure/database";
import { startStoreCrawl } from "@/features/crawl";
import { PLATFORMS } from "@/contracts";
import { isAppError } from "@/shared/errors";

export const maxDuration = 300; // startStoreCrawl schedules the crawl with after()
export const OPTIONS = preflight;

const ListQuery = z.object({
  query: z.string().trim().max(200).optional(),
  platform: z.enum(PLATFORMS).optional(),
  has_checkout: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const GET = route("stores.list", async (req, _ctx, { requestId }) => {
  const q = parseSearchParams(req, ListQuery);
  return json({ stores: await listStores(q) }, { requestId }); // same body as MCP list_stores (WS3)
});

const IndexBody = z.union([
  z.object({
    url: z.string().trim().min(3).max(2048),
    max_products: z.number().int().min(1).max(500).optional(),
    force: z.boolean().optional(),
  }).strict(),
  z.object({
    store_id: z.uuid(),
    max_products: z.number().int().min(1).max(500).optional(),
    force: z.boolean().optional(),
  }).strict(),
]);

export const POST = route("stores.index", async (req, _ctx, { requestId }) => {
  const body = await parseJsonBody(req, IndexBody);
  try {
    const r = await startStoreCrawl("url" in body ? body.url : "", {
      storeId: "store_id" in body ? body.store_id : undefined,
      maxProducts: body.max_products,
      force: body.force,
    });
    const out = { store: r.store, crawl_run_id: r.crawl_run.id, status: r.crawl_run.status, reused: r.reused, cached: r.cached };
    return json(out, {
      status: r.cached ? 200 : 202,
      requestId,
      headers: { Location: `/api/v1/crawl-runs/${r.crawl_run.id}` },
    });
  } catch (err) {
    // route()'s errorResponse has no headers option; rate_limited needs Retry-After added here.
    if (isAppError(err) && err.code === "rate_limited") {
      const res = errorResponse(err, requestId);
      res.headers.set("Retry-After", "30");
      return res;
    }
    throw err;
  }
});
