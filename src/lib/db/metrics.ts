/* eslint-disable @typescript-eslint/no-unused-vars -- stub parameters, removed with the T+60 bodies */
import "server-only";
import type { AgentSurface, PublicMetrics } from "@/lib/contracts";
import { AppError } from "@/lib/errors";

// TODO(WS1 T+60): insert into agent_requests; until then a no-op, because it must never throw.
/** Fire-and-forget. Never throws, never awaited on the hot path (use after()). */
export async function logAgentRequest(r: {
  surface: AgentSurface; tool?: string; store_id?: string | null; user_agent?: string | null;
  agent_profile?: string | null; // UCP-Agent profile (WS3); truncated to 2048 chars
}): Promise<void> {}

// TODO(WS1 T+60)
export async function getPublicMetrics(): Promise<PublicMetrics> {
  throw new AppError("not_implemented", "getPublicMetrics");
}

/** Per-store index quality (WS2 readiness): offers_complete_ratio = products with a live price + availability / products. */
export interface IndexStats { product_count: number; variant_count: number; offers_complete_ratio: number }
/** No argument (WS3 CR-1): indexed, non-opted-out stores and their products (llms.txt, agent card). */
export function getIndexStats(): Promise<{ stores: number; products: number }>;
/** With a store id (WS2 02 §15.3): that store's IndexStats. */
export function getIndexStats(storeId: string): Promise<IndexStats>;
// TODO(WS1 T+60)
export async function getIndexStats(storeId?: string): Promise<{ stores: number; products: number } | IndexStats> {
  throw new AppError("not_implemented", "getIndexStats");
}
