import "server-only";
import type { CrawlLogEntry, CrawlRun } from "@/contracts";
import { AppError, toAppError } from "@/shared/errors";
import { db } from "@/infrastructure/database/client";
import { toCrawlRun } from "@/infrastructure/database/mappers";
import { CRAWL_RUN_SELECT } from "@/infrastructure/database/selects";
import type { TablesUpdate } from "@/infrastructure/database/types.gen";
import { asJson, isMalformed, isUuid, minutesAgo, pickDefined } from "@/infrastructure/database/util";

const CRAWL_LOG_MAX = 50;
const ACTIVE = ["queued", "running"] as const;

export async function createCrawlRun(storeId: string): Promise<CrawlRun> {
  const { data, error } = await db()
    .from("crawl_runs")
    .insert({ store_id: storeId, status: "queued" })
    .select(CRAWL_RUN_SELECT)
    .single();
  if (error) throw toAppError(error);
  return toCrawlRun(data);
}

export async function getCrawlRun(id: string): Promise<CrawlRun | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db().from("crawl_runs").select(CRAWL_RUN_SELECT).eq("id", id).maybeSingle();
  if (error) {
    if (isMalformed(error)) return null;
    throw toAppError(error);
  }
  return data ? toCrawlRun(data) : null;
}

export async function getLatestCrawlRun(storeId: string): Promise<CrawlRun | null> {
  if (!isUuid(storeId)) return null;
  const { data, error } = await db()
    .from("crawl_runs")
    .select(CRAWL_RUN_SELECT)
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw toAppError(error);
  return data ? toCrawlRun(data) : null;
}

export interface CrawlRunPatch {
  status?: CrawlRun["status"]; strategy?: string | null; products_found?: number;
  pages_fetched?: number; pages_failed?: number; error?: string | null;
  started_at?: string | null; finished_at?: string | null;
}

const CRAWL_RUN_PATCH_KEYS = [
  "status", "strategy", "products_found", "pages_fetched", "pages_failed", "error", "started_at", "finished_at",
] as const satisfies readonly (keyof CrawlRunPatch)[];

export async function updateCrawlRun(id: string, patch: CrawlRunPatch): Promise<CrawlRun> {
  const u: TablesUpdate<"crawl_runs"> = pickDefined(patch, CRAWL_RUN_PATCH_KEYS);
  if (Object.keys(u).length === 0) {
    const run = await getCrawlRun(id);
    if (!run) throw new AppError("not_found", "Crawl run not found", { id });
    return run;
  }
  const { data, error } = await db().from("crawl_runs").update(u).eq("id", id).select(CRAWL_RUN_SELECT).maybeSingle();
  if (error) throw toAppError(error);
  if (!data) throw new AppError("not_found", "Crawl run not found", { id });
  return toCrawlRun(data);
}

/** queued → running, conditionally (update ... where status = 'queued'); sets started_at. null = already claimed. */
export async function claimCrawlRun(id: string): Promise<CrawlRun | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db()
    .from("crawl_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "queued")
    .select(CRAWL_RUN_SELECT)
    .maybeSingle();
  if (error) throw toAppError(error);
  return data ? toCrawlRun(data) : null;
}

/** Latest queued/running run for the store created less than withinMin minutes ago, else null. */
export async function getActiveCrawlRun(storeId: string, withinMin: number): Promise<CrawlRun | null> {
  if (!isUuid(storeId)) return null;
  const { data, error } = await db()
    .from("crawl_runs")
    .select(CRAWL_RUN_SELECT)
    .eq("store_id", storeId)
    .in("status", ACTIVE)
    .gt("created_at", minutesAgo(withinMin))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw toAppError(error);
  return data ? toCrawlRun(data) : null;
}

/** Number of queued/running runs created less than withinMin minutes ago (all stores). */
export async function countActiveCrawlRuns(withinMin: number): Promise<number> {
  const { count, error } = await db()
    .from("crawl_runs")
    .select("id", { count: "exact", head: true })
    .in("status", ACTIVE)
    .gt("created_at", minutesAgo(withinMin));
  if (error) throw toAppError(error);
  return count ?? 0;
}

/** Appends entries (at defaults to now), keeps the last 50 (WS5 CCR-1). Single writer per run assumed. */
export async function appendCrawlLog(
  id: string,
  entries: Array<Omit<CrawlLogEntry, "at"> & { at?: string }>,
): Promise<void> {
  if (entries.length === 0) return;
  const { data, error } = await db().from("crawl_runs").select("log").eq("id", id).maybeSingle();
  if (error) throw toAppError(error);
  if (!data) throw new AppError("not_found", "Crawl run not found", { id });
  const now = new Date().toISOString();
  const current = (Array.isArray(data.log) ? data.log : []) as unknown as CrawlLogEntry[];
  const added: CrawlLogEntry[] = entries.map((e) => ({ ...e, at: e.at ?? now }));
  const log = [...current, ...added].slice(-CRAWL_LOG_MAX);
  const { error: upErr } = await db().from("crawl_runs").update({ log: asJson(log) }).eq("id", id);
  if (upErr) throw toAppError(upErr);
}
