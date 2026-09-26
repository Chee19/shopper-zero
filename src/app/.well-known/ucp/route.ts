import { profileCheckout } from "@/features/catalog/checkout-status";
import { CACHE, JSON_UTF8, ucpLinkHeader } from "@/features/catalog/http";
import { logHit } from "@/features/catalog/log";
import { appUrl } from "@/shared/env";
import { buildUcpProfile } from "@/features/catalog/formats/ucp";
import { json, preflight, route } from "@/shared/http";

// Root UCP profile. Checkout is claimed only when checkoutLive() (tools live + a payment rail; spec 03 §6.6).
export const GET = route("ucp.root", async (req, _ctx: unknown, { requestId }) => {
  const base = appUrl();
  logHit("ucp", { tool: "root", req });
  return json(buildUcpProfile({ base, checkout: profileCheckout(true) }), {
    requestId,
    headers: { "Content-Type": JSON_UTF8, "Cache-Control": CACHE.index, Link: ucpLinkHeader(`${base}/.well-known/ucp`) },
  });
});

export const OPTIONS = preflight;
