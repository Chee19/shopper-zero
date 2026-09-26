import { profileCheckout } from "@/lib/agent/checkout-status";
import { CACHE, JSON_UTF8, ucpLinkHeader } from "@/lib/agent/http";
import { logHit } from "@/lib/agent/log";
import { appUrl } from "@/lib/env";
import { buildUcpProfile } from "@/lib/formats/ucp";
import { json, preflight, route } from "@/lib/http";

// Root UCP profile. Checkout is claimed only once CHECKOUT_TOOLS_LIVE is flipped (spec 03 §6.6).
export const GET = route("ucp.root", async (req, _ctx: unknown, { requestId }) => {
  const base = appUrl();
  logHit("ucp", { tool: "root", req });
  return json(buildUcpProfile({ base, checkout: profileCheckout(true) }), {
    requestId,
    headers: { "Content-Type": JSON_UTF8, "Cache-Control": CACHE.index, Link: ucpLinkHeader(`${base}/.well-known/ucp`) },
  });
});

export const OPTIONS = preflight;
