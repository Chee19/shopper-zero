// src/lib/agent/stores.ts  (WS3): store lookups for agent-facing file routes.
import "server-only";
import { LIST_STORES_MAX_LIMIT, type Store, type StoreSummary } from "@/contracts";
import { getStoreBySlug, listStores } from "@/infrastructure/database";
import { text } from "@/shared/http";

/** /s/{slug}/*: opted-out stores are invisible to agents (404). */
export async function agentStoreBySlug(slug: string): Promise<Store | null> {
  const store = await getStoreBySlug(slug);
  return store && !store.opted_out ? store : null;
}

/** Plain-text 404 for text routes (llms.txt). */
export const textNotFound = () => text("Not found", "text/plain; charset=utf-8", { status: 404 });

/** Indexed, non-opted-out stores, paged through listStores (which caps each page). */
export async function listIndexedStores(max: number): Promise<StoreSummary[]> {
  const out: StoreSummary[] = [];
  for (let offset = 0; out.length < max; offset += LIST_STORES_MAX_LIMIT) {
    const page = await listStores({ status: "indexed", limit: LIST_STORES_MAX_LIMIT, offset });
    out.push(...page);
    if (page.length < LIST_STORES_MAX_LIMIT) break;
  }
  return out.slice(0, max);
}
