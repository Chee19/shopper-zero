import { storeCache, ucpLinkHeader } from "@/lib/agent/http";
import { logHit } from "@/lib/agent/log";
import { agentStoreBySlug } from "@/lib/agent/stores";
import { getProductByHandle } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { SHOPIFY_NOT_FOUND, toShopifyDetailProduct } from "@/lib/formats/shopify";
import { CORS_HEADERS, json, preflight, route } from "@/lib/http";

// Serves /s/{slug}/products/{handle}.json (Next has no partial-segment syntax, so the param keeps ".json").
// No suffix: a human clicked the link, so redirect to the merchant's product page. ".js" (Shopify AJAX) is stretch.
export const GET = route("s.product_json", async (req, ctx: RouteContext<"/s/[slug]/products/[handle]">, { requestId }) => {
  const { slug, handle: raw } = await ctx.params;
  const notFound = () => json(SHOPIFY_NOT_FOUND, { status: 404, requestId });
  if (raw.endsWith(".js")) return notFound();
  const isJson = raw.endsWith(".json");
  const handle = isJson ? raw.slice(0, -".json".length) : raw;
  if (!handle) return notFound();

  const store = await agentStoreBySlug(slug);
  if (!store) return notFound();
  const product = await getProductByHandle(store.id, handle);
  if (!product) return notFound();

  if (!isJson) {
    return new Response(null, { status: 302, headers: { ...CORS_HEADERS, Location: product.url, "Request-Id": requestId } });
  }
  logHit("products_json", { tool: "product", storeId: store.id, req });
  return json(
    { product: toShopifyDetailProduct(product, store, appUrl()) },
    { requestId, headers: { "Cache-Control": storeCache(store), Link: ucpLinkHeader(store.urls.ucp) } },
  );
});

export const OPTIONS = preflight;
