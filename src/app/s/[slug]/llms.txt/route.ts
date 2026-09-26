import { agentCheckoutFor } from "@/lib/agent/checkout-status";
import { storeCache, ucpLinkHeader } from "@/lib/agent/http";
import { logHit } from "@/lib/agent/log";
import { scanInfo } from "@/lib/agent/scan-info";
import { agentStoreBySlug, textNotFound } from "@/lib/agent/stores";
import { listStoreProducts } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { renderStoreLlmsTxt, STORE_LLMS_PRODUCTS } from "@/lib/formats/llms";
import { preflight, route, text } from "@/lib/http";

export const GET = route("s.llms_txt", async (req, ctx: RouteContext<"/s/[slug]/llms.txt">, { requestId }) => {
  const { slug } = await ctx.params;
  const store = await agentStoreBySlug(slug);
  if (!store) return textNotFound();

  const [{ products }, scan] = await Promise.all([
    listStoreProducts(store.id, { limit: STORE_LLMS_PRODUCTS, page: 1 }),
    scanInfo(store),
  ]);
  const body = renderStoreLlmsTxt({ base: appUrl(), store, products, agentCheckout: agentCheckoutFor(store), scan });
  logHit("llms_txt", { tool: "store", storeId: store.id, req });
  return text(body, "text/plain; charset=utf-8", {
    headers: { "Cache-Control": storeCache(store), Link: ucpLinkHeader(store.urls.ucp), "Request-Id": requestId },
  });
});

export const OPTIONS = preflight;
