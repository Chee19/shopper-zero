import "server-only";
import type { CrawlRun, StoreStatus } from "@/contracts";
import { getCrawlRun, getStoreById } from "@/infrastructure/database";

// A queued/running row not written for this long has lost its worker (crawl and scan budgets are under 5 min).
export const STALE_AFTER_MS = 6 * 60_000;

export function isStale(row: { status: string; updated_at: string }, now = Date.now()): boolean {
  return (row.status === "queued" || row.status === "running") && now - Date.parse(row.updated_at) > STALE_AFTER_MS;
}

// Readers report a dead run as failed; the row itself is left for the next writer.
export function staleAware<T extends { status: string; updated_at: string }>(row: T, now = Date.now()): T & { error?: string | null } {
  return isStale(row, now) ? { ...row, status: "failed" as const, error: "stale" } : row;
}

export type CrawlRunView = CrawlRun & { done: boolean; store: { slug: string; status: StoreStatus } | null };

// Superset of CrawlRun (contracts/mcp.ts GetCrawlStatusOutput): the HTTP route and get_crawl_status both return it.
export async function getCrawlRunView(id: string): Promise<CrawlRunView | null> {
  const row = await getCrawlRun(id);
  if (!row) return null;
  const run = staleAware(row);
  const store = await getStoreById(run.store_id);
  return {
    ...run,
    finished_at: run.finished_at ?? (run.error === "stale" ? run.updated_at : null),
    done: run.status === "succeeded" || run.status === "failed",
    store: store ? { slug: store.slug, status: store.status } : null,
  };
}
