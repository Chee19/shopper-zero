import { agentCheckoutFor } from "@/features/catalog/checkout-status";
import { CACHE, readRateLimit, ucpAgentProfile, ucpLinkHeader } from "@/features/catalog/http";
import { logHit } from "@/features/catalog/log";
import { scanInfo } from "@/features/catalog/scan-info";
import { getLatestCrawlRun, resolveStore } from "@/infrastructure/database";
import { AppError } from "@/shared/errors";
import { json, preflight, route } from "@/shared/http";

// GET /api/v1/stores (the list) and POST are WS2's (B1); this file serves one store.
export const GET = route("v1.store", async (req, ctx: RouteContext<"/api/v1/stores/[slug]">, { requestId }) => {
  const limited = readRateLimit(req, requestId);
  if (limited) return limited;
  const { slug } = await ctx.params;
  const ref = slug.trim();
  const store = await resolveStore(ref);
  if (!store) throw new AppError("not_found", `No store matches '${ref}'.`);
  if (store.opted_out) throw new AppError("forbidden", "Store opted out", { reason: "opted_out" });

  const [latestCrawlRun, scan] = await Promise.all([getLatestCrawlRun(store.id), scanInfo(store)]);
  logHit("rest", { tool: "get_store", storeId: store.id, req, agentProfile: ucpAgentProfile(req) });
  return json(
    { ...store, agent_checkout: agentCheckoutFor(store), latest_crawl_run: latestCrawlRun, scan },
    { requestId, headers: { "Cache-Control": CACHE.none, Link: ucpLinkHeader(store.urls.ucp) } },
  );
});

export const OPTIONS = preflight;
