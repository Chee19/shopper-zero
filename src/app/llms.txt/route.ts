import { agentCheckoutFor, checkoutLive } from "@/features/catalog/checkout-status";
import { CACHE, ucpLinkHeader } from "@/features/catalog/http";
import { logHit } from "@/features/catalog/log";
import { listIndexedStores } from "@/features/catalog/stores";
import { getIndexStats } from "@/infrastructure/database";
import { appUrl } from "@/shared/env";
import { renderRootLlmsTxt } from "@/features/catalog/formats/llms";
import { preflight, route, text } from "@/shared/http";

export const GET = route("llms_txt", async (req, _ctx: unknown, { requestId }) => {
  const base = appUrl();
  const [stats, stores] = await Promise.all([getIndexStats(), listIndexedStores(200)]);
  const body = renderRootLlmsTxt({
    base,
    stats,
    now: new Date().toISOString(),
    stores,
    checkoutLive: checkoutLive(),
    agentCheckout: agentCheckoutFor,
  });
  logHit("llms_txt", { tool: "root", req });
  return text(body, "text/plain; charset=utf-8", {
    headers: { "Cache-Control": CACHE.index, Link: ucpLinkHeader(`${base}/.well-known/ucp`), "Request-Id": requestId },
  });
});

export const OPTIONS = preflight;
