import { CACHE, JSON_UTF8, ucpLinkHeader } from "@/lib/agent/http";
import { logHit } from "@/lib/agent/log";
import { appUrl } from "@/lib/env";
import { buildAgentCard } from "@/lib/formats/agent-card";
import { json, preflight, route } from "@/lib/http";

export const GET = route("agent_card", async (req, _ctx: unknown, { requestId }) => {
  const base = appUrl();
  logHit("agent_card", { req });
  return json(buildAgentCard(base), {
    requestId,
    headers: { "Content-Type": JSON_UTF8, "Cache-Control": CACHE.static, Link: ucpLinkHeader(`${base}/.well-known/ucp`) },
  });
});

export const OPTIONS = preflight;
