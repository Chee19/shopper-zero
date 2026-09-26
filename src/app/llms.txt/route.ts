import { agentCheckoutFor, checkoutLive } from "@/lib/agent/checkout-status";
import { CACHE, ucpLinkHeader } from "@/lib/agent/http";
import { logHit } from "@/lib/agent/log";
import { listIndexedStores } from "@/lib/agent/stores";
import { getIndexStats } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { renderRootLlmsTxt } from "@/lib/formats/llms";
import { preflight, route, text } from "@/lib/http";

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
