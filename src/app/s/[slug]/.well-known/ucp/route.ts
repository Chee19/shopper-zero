import { agentCheckoutFor, profileCheckout } from "@/features/catalog/checkout-status";
import { JSON_UTF8, storeCache, ucpLinkHeader } from "@/features/catalog/http";
import { logHit } from "@/features/catalog/log";
import { scanInfo } from "@/features/catalog/scan-info";
import { agentStoreBySlug } from "@/features/catalog/stores";
import { appUrl } from "@/shared/env";
import { AppError } from "@/shared/errors";
import { buildUcpProfile } from "@/features/catalog/formats/ucp";
import { json, preflight, route } from "@/shared/http";

// Per-store UCP profile: the MCP endpoint is scoped with ?store={slug}; checkout is claimed per store.
export const GET = route("ucp.store", async (req, ctx: RouteContext<"/s/[slug]/.well-known/ucp">, { requestId }) => {
  const { slug } = await ctx.params;
  const store = await agentStoreBySlug(slug);
  if (!store) throw new AppError("not_found", `No indexed store with slug '${slug}'.`);

  const profile = buildUcpProfile({ base: appUrl(), store, checkout: profileCheckout(agentCheckoutFor(store)) });
  // Optional sibling key outside `ucp` (validators read `ucp`); only when a finished scan exists.
  const scan = await scanInfo(store);
  logHit("ucp", { tool: "store", storeId: store.id, req });
  return json(scan ? { ...profile, _shoperzero: { scan } } : profile, {
    requestId,
    headers: { "Content-Type": JSON_UTF8, "Cache-Control": storeCache(store), Link: ucpLinkHeader(store.urls.ucp) },
  });
});

export const OPTIONS = preflight;
