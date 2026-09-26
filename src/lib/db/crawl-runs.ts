/* eslint-disable @typescript-eslint/no-unused-vars -- stub parameters, removed with the T+60 bodies */
import "server-only";
import type { CrawlLogEntry, CrawlRun } from "@/lib/contracts";
import { AppError } from "@/lib/errors";

// TODO(WS1 T+60)
export async function createCrawlRun(storeId: string): Promise<CrawlRun> {
  throw new AppError("not_implemented", "createCrawlRun");
}

// TODO(WS1 T+60)
export async function getCrawlRun(id: string): Promise<CrawlRun | null> {
  throw new AppError("not_implemented", "getCrawlRun");
}

// TODO(WS1 T+60)
export async function getLatestCrawlRun(storeId: string): Promise<CrawlRun | null> {
  throw new AppError("not_implemented", "getLatestCrawlRun");
}

export interface CrawlRunPatch {
  status?: CrawlRun["status"]; strategy?: string | null; products_found?: number;
  pages_fetched?: number; pages_failed?: number; error?: string | null;
  started_at?: string | null; finished_at?: string | null;
}

// TODO(WS1 T+60)
export async function updateCrawlRun(id: string, patch: CrawlRunPatch): Promise<CrawlRun> {
  throw new AppError("not_implemented", "updateCrawlRun");
}

// TODO(WS1 T+60)
/** queued → running, conditionally (update ... where status = 'queued'); sets started_at. null = already claimed. */
export async function claimCrawlRun(id: string): Promise<CrawlRun | null> {
  throw new AppError("not_implemented", "claimCrawlRun");
}

// TODO(WS1 T+60)
/** Latest queued/running run for the store created less than withinMin minutes ago, else null. */
export async function getActiveCrawlRun(storeId: string, withinMin: number): Promise<CrawlRun | null> {
  throw new AppError("not_implemented", "getActiveCrawlRun");
}

// TODO(WS1 T+60)
/** Number of queued/running runs created less than withinMin minutes ago (all stores). */
export async function countActiveCrawlRuns(withinMin: number): Promise<number> {
  throw new AppError("not_implemented", "countActiveCrawlRuns");
}

// TODO(WS1 T+60)
/** Appends entries (at defaults to now), keeps the last 50 (WS5 CCR-1). Single writer per run assumed. */
export async function appendCrawlLog(
  id: string,
  entries: Array<Omit<CrawlLogEntry, "at"> & { at?: string }>,
): Promise<void> {
  throw new AppError("not_implemented", "appendCrawlLog");
}
