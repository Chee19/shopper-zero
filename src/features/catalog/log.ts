// src/lib/agent/log.ts  (WS3)
import "server-only";
import { after } from "next/server";
import type { AgentSurface } from "@/contracts";
import { logAgentRequest } from "@/infrastructure/database";

export interface HitInfo {
  tool?: string;
  storeId?: string | null;
  req?: Request | null;
  agentProfile?: string | null;
}

/** One agent_requests row, written after the response. Never affects the response. */
export function logHit(surface: AgentSurface, o: HitInfo = {}) {
  const row = {
    surface,
    tool: o.tool,
    store_id: o.storeId ?? null,
    user_agent: o.req?.headers.get("user-agent") ?? null,
    agent_profile: o.agentProfile ?? null,
  };
  const run = () => logAgentRequest(row);
  try {
    after(run);
  } catch {
    void run(); // after() throws outside a request scope
  }
}
