import { storeCache, ucpLinkHeader } from "@/lib/agent/http";
import { logHit } from "@/lib/agent/log";
import { agentStoreBySlug } from "@/lib/agent/stores";
import { getProductByHandle } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { SHOPIFY_NOT_FOUND, toShopifyDetailProduct } from "@/lib/formats/shopify";
import { json, preflight, route } from "@/lib/http";

// Serves /s/{slug}/products/{handle}.json (Next has no partial-segment syntax, so the param keeps ".json").
// Without the ".json" suffix it is 404 (00 §4.12, which takes precedence over 03 §6.2's 302 to the PDP).
// ".js" (Shopify AJAX shape) is stretch.
export const GET = route("s.product_json", async (req, ctx: RouteContext<"/s/[slug]/products/[handle]">, { requestId }) => {
  const { slug, handle: raw } = await ctx.params;
  const notFound = () => json(SHOPIFY_NOT_FOUND, { status: 404, requestId });
  if (!raw.endsWith(".json")) return notFound();
  const handle = raw.slice(0, -".json".length);
  if (!handle) return notFound();

  const store = await agentStoreBySlug(slug);
  if (!store) return notFound();
  const product = await getProductByHandle(store.id, handle);
  if (!product) return notFound();

  logHit("products_json", { tool: "product", storeId: store.id, req });
  return json(
    { product: toShopifyDetailProduct(product, store, appUrl()) },
    { requestId, headers: { "Cache-Control": storeCache(store), Link: ucpLinkHeader(store.urls.ucp) } },
  );
});

export const OPTIONS = preflight;
