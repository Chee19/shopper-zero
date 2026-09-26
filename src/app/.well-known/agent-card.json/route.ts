import { CACHE, JSON_UTF8, ucpLinkHeader } from "@/features/catalog/http";
import { logHit } from "@/features/catalog/log";
import { appUrl } from "@/shared/env";
import { buildAgentCard } from "@/features/catalog/formats/agent-card";
import { json, preflight, route } from "@/shared/http";

export const GET = route("agent_card", async (req, _ctx: unknown, { requestId }) => {
  const base = appUrl();
  logHit("agent_card", { req });
  return json(buildAgentCard(base), {
    requestId,
    headers: { "Content-Type": JSON_UTF8, "Cache-Control": CACHE.static, Link: ucpLinkHeader(`${base}/.well-known/ucp`) },
  });
});

export const OPTIONS = preflight;
