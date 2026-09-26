import { agentCheckoutFor } from "@/features/catalog/checkout-status";
import { storeCache, ucpLinkHeader } from "@/features/catalog/http";
import { logHit } from "@/features/catalog/log";
import { scanInfo } from "@/features/catalog/scan-info";
import { agentStoreBySlug, textNotFound } from "@/features/catalog/stores";
import { listStoreProducts } from "@/infrastructure/database";
import { appUrl } from "@/shared/env";
import { renderStoreLlmsTxt, STORE_LLMS_PRODUCTS } from "@/features/catalog/formats/llms";
import { preflight, route, text } from "@/shared/http";

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
