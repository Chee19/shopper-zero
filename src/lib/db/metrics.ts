import "server-only";
import type { AgentSurface, PublicMetrics } from "@/lib/contracts";
import { toAppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { db } from "./client";
import { errorMessage, isUuid, truncate } from "./util";

/** Fire-and-forget. Never throws, never awaited on the hot path (use after()). */
export async function logAgentRequest(r: {
  surface: AgentSurface; tool?: string; store_id?: string | null; user_agent?: string | null;
  agent_profile?: string | null; // UCP-Agent profile (WS3); truncated to 2048 chars
}): Promise<void> {
  try {
    const { error } = await db().from("agent_requests").insert({
      surface: r.surface,
      tool: truncate(r.tool, 200),
      store_id: r.store_id && isUuid(r.store_id) ? r.store_id : null,
      user_agent: truncate(r.user_agent, 300),
      agent_profile: truncate(r.agent_profile, 2048),
    });
    if (error) log.warn("metrics.agent_request.failed", { surface: r.surface, error: errorMessage(error) });
  } catch (e) {
    log.warn("metrics.agent_request.failed", { surface: r.surface, error: errorMessage(e) });
  }
}

export async function getPublicMetrics(): Promise<PublicMetrics> {
  const { data, error } = await db().rpc("get_public_metrics");
  if (error) throw toAppError(error);
  return data as unknown as PublicMetrics;
}

/** Per-store index quality (WS2 readiness): offers_complete_ratio = products with a live price + availability / products. */
export interface IndexStats { product_count: number; variant_count: number; offers_complete_ratio: number }
/** No argument (WS3 CR-1): indexed, non-opted-out stores and their products (llms.txt, agent card). */
export function getIndexStats(): Promise<{ stores: number; products: number }>;
/** With a store id (WS2 02 §15.3): that store's IndexStats. */
export function getIndexStats(storeId: string): Promise<IndexStats>;
export async function getIndexStats(storeId?: string): Promise<{ stores: number; products: number } | IndexStats> {
  if (storeId === undefined) return globalIndexStats();
  return storeIndexStats(storeId);
}

async function globalIndexStats(): Promise<{ stores: number; products: number }> {
  const PAGE = 1000;
  let stores = 0;
  let products = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("stores")
      .select("product_count")
      .eq("status", "indexed")
      .eq("opted_out", false)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw toAppError(error);
    const rows = data ?? [];
    stores += rows.length;
    products += rows.reduce((sum, s) => sum + (s.product_count ?? 0), 0);
    if (rows.length < PAGE) break;
  }
  return { stores, products };
}

async function storeIndexStats(storeId: string): Promise<IndexStats> {
  if (!isUuid(storeId)) return { product_count: 0, variant_count: 0, offers_complete_ratio: 0 };
  const [products, variants] = await Promise.all([
    db().from("products").select("id", { count: "exact", head: true }).eq("store_id", storeId),
    db().from("product_variants").select("id", { count: "exact", head: true }).eq("store_id", storeId),
  ]);
  if (products.error) throw toAppError(products.error);
  if (variants.error) throw toAppError(variants.error);
  const product_count = products.count ?? 0;
  const variant_count = variants.count ?? 0;
  if (product_count === 0) return { product_count, variant_count, offers_complete_ratio: 0 };

  // price_minor is NOT NULL, so a product is incomplete iff one of its variants has availability 'unknown'.
  const PAGE = 1000;
  const incomplete = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("product_variants")
      .select("product_id")
      .eq("store_id", storeId)
      .eq("availability", "unknown")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw toAppError(error);
    const rows = data ?? [];
    for (const v of rows) incomplete.add(v.product_id);
    if (rows.length < PAGE) break;
  }
  const complete = Math.max(product_count - incomplete.size, 0);
  return { product_count, variant_count, offers_complete_ratio: complete / product_count };
}
