import { CHECKOUT_TOOLS_LIVE } from "@/lib/agent/checkout-status";
import { CACHE, ucpLinkHeader } from "@/lib/agent/http";
import { logHit } from "@/lib/agent/log";
import { appUrl } from "@/lib/env";
import { buildOpenApi } from "@/lib/formats/openapi";
import { json, preflight, route } from "@/lib/http";

export const GET = route("openapi", async (req, _ctx: unknown, { requestId }) => {
  const base = appUrl();
  logHit("openapi", { req });
  return json(buildOpenApi(base, { checkoutLive: CHECKOUT_TOOLS_LIVE }), {
    requestId,
    headers: { "Cache-Control": CACHE.static, Link: ucpLinkHeader(`${base}/.well-known/ucp`) },
  });
});

export const OPTIONS = preflight;
