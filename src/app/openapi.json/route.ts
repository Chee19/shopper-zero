import { checkoutLive } from "@/features/catalog/checkout-status";
import { CACHE, JSON_UTF8, ucpLinkHeader } from "@/features/catalog/http";
import { logHit } from "@/features/catalog/log";
import { appUrl } from "@/shared/env";
import { buildOpenApi } from "@/features/catalog/formats/openapi";
import { json, preflight, route } from "@/shared/http";

export const GET = route("openapi", async (req, _ctx: unknown, { requestId }) => {
  const base = appUrl();
  logHit("openapi", { req });
  return json(buildOpenApi(base, { checkoutLive: checkoutLive() }), {
    requestId,
    headers: { "Content-Type": JSON_UTF8, "Cache-Control": CACHE.static, Link: ucpLinkHeader(`${base}/.well-known/ucp`) },
  });
});

export const OPTIONS = preflight;
