import { agentCheckoutFor, profileCheckout } from "@/lib/agent/checkout-status";
import { JSON_UTF8, storeCache, ucpLinkHeader } from "@/lib/agent/http";
import { logHit } from "@/lib/agent/log";
import { scanInfo } from "@/lib/agent/scan-info";
import { agentStoreBySlug } from "@/lib/agent/stores";
import { appUrl } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { buildUcpProfile } from "@/lib/formats/ucp";
import { json, preflight, route } from "@/lib/http";

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
