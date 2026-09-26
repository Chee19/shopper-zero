import { profileCheckout } from "@/lib/agent/checkout-status";
import { CACHE, ucpLinkHeader } from "@/lib/agent/http";
import { logHit } from "@/lib/agent/log";
import { appUrl } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { buildUcpProfile, OLDER_UCP_VERSIONS } from "@/lib/formats/ucp";
import { json, preflight, route } from "@/lib/http";

// Older supported UCP versions (UCP_SUPPORTED_VERSIONS minus the current one). Same shapes, version substituted.
export const GET = route("ucp.version", async (req, ctx: RouteContext<"/.well-known/ucp/[version]">, { requestId }) => {
  const { version } = await ctx.params;
  if (!OLDER_UCP_VERSIONS.includes(version)) throw new AppError("not_found", `UCP version '${version}' is not served.`);
  const base = appUrl();
  logHit("ucp", { tool: "version", req });
  return json(buildUcpProfile({ base, version, checkout: profileCheckout(true) }), {
    requestId,
    headers: { "Cache-Control": CACHE.index, Link: ucpLinkHeader(`${base}/.well-known/ucp/${version}`, version) },
  });
});

export const OPTIONS = preflight;
