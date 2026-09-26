import { storeCache, ucpLinkHeader } from "@/features/catalog/http";
import { logHit } from "@/features/catalog/log";
import { agentStoreBySlug } from "@/features/catalog/stores";
import { listStoreProducts } from "@/infrastructure/database";
import { appUrl } from "@/shared/env";
import { parseShopifyPaging, SHOPIFY_NOT_FOUND, toShopifyListProduct } from "@/features/catalog/formats/shopify";
import { json, preflight, route } from "@/shared/http";

// Shopify-compatible list. Errors use Shopify's own bodies, not our envelope (spec 03 §2.7).
export const GET = route("s.products_json", async (req, ctx: RouteContext<"/s/[slug]/products.json">, { requestId }) => {
  const { slug } = await ctx.params;
  const store = await agentStoreBySlug(slug);
  if (!store) return json(SHOPIFY_NOT_FOUND, { status: 404, requestId });

  const paging = parseShopifyPaging(new URL(req.url).searchParams);
  if ("error" in paging) return json({ errors: paging.error }, { status: 400, requestId });

  const { products } = await listStoreProducts(store.id, { limit: paging.limit, page: paging.page });
  const base = appUrl();
  logHit("products_json", { tool: "list", storeId: store.id, req });
  return json(
    { products: products.map((p) => toShopifyListProduct(p, store, base)) },
    { requestId, headers: { "Cache-Control": storeCache(store), Link: ucpLinkHeader(store.urls.ucp) } },
  );
});

export const OPTIONS = preflight;
