import { profileCheckout } from "@/features/catalog/checkout-status";
import { CACHE, JSON_UTF8, ucpLinkHeader } from "@/features/catalog/http";
import { logHit } from "@/features/catalog/log";
import { appUrl } from "@/shared/env";
import { AppError } from "@/shared/errors";
import { buildUcpProfile, OLDER_UCP_VERSIONS } from "@/features/catalog/formats/ucp";
import { json, preflight, route } from "@/shared/http";

// Older supported UCP versions (UCP_SUPPORTED_VERSIONS minus the current one). Same shapes, version substituted.
export const GET = route("ucp.version", async (req, ctx: RouteContext<"/.well-known/ucp/[version]">, { requestId }) => {
  const { version } = await ctx.params;
  if (!OLDER_UCP_VERSIONS.includes(version)) throw new AppError("not_found", `UCP version '${version}' is not served.`);
  const base = appUrl();
  logHit("ucp", { tool: "version", req });
  return json(buildUcpProfile({ base, version, checkout: profileCheckout(true) }), {
    requestId,
    headers: { "Content-Type": JSON_UTF8, "Cache-Control": CACHE.index, Link: ucpLinkHeader(`${base}/.well-known/ucp/${version}`, version) },
  });
});

export const OPTIONS = preflight;
