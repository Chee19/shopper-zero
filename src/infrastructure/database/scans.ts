import "server-only";
import type { ScanReport, ScanStatus } from "@/contracts";
import { AppError, toAppError } from "@/shared/errors";
import { db } from "@/infrastructure/database/client";
import { toScanReport } from "@/infrastructure/database/mappers";
import { SCAN_SELECT } from "@/infrastructure/database/selects";
import type { TablesInsert, TablesUpdate } from "@/infrastructure/database/types.gen";
import { asJson, errorMessage, isMalformed, isUuid, minutesAgo } from "@/infrastructure/database/util";

const ACTIVE = ["queued", "running"] as const;
const SCREENSHOT_BUCKET = "scan-screenshots";

/** Exact ScanReport contract (toScanReport). Malformed uuid → null. Includes opted-out stores' scans. */
export async function getScan(id: string): Promise<ScanReport | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db().from("scans").select(SCAN_SELECT).eq("id", id).maybeSingle();
  if (error) {
    if (isMalformed(error)) return null;
    throw toAppError(error);
  }
  return data ? toScanReport(data) : null;
}

/** ScanReport keys that are columns; id / created_at / updated_at in a patch are ignored. */
function scanColumns(patch: Partial<ScanReport>): TablesUpdate<"scans"> {
  const c: TablesUpdate<"scans"> = {};
  if (patch.store_id !== undefined) c.store_id = patch.store_id;
  if (patch.url !== undefined) c.url = patch.url;
  if (patch.mode !== undefined) c.mode = patch.mode;
  if (patch.status !== undefined) c.status = patch.status;
  if (patch.platform !== undefined) c.platform = patch.platform;
  if (patch.best_method !== undefined) c.best_method = patch.best_method;
  if (patch.probes !== undefined) c.probes = asJson(patch.probes);
  if (patch.score !== undefined) c.score = patch.score;
  if (patch.grade !== undefined) c.grade = patch.grade;
  if (patch.checks !== undefined) c.checks = asJson(patch.checks);
  if (patch.after !== undefined) c.after = asJson(patch.after);
  if (patch.recommendations !== undefined) c.recommendations = asJson(patch.recommendations);
  return c;
}

/**
 * With id: shallow-merge update of the given keys (probes / checks / recommendations are replaced whole).
 * With {store_id, url} and no id: insert (defaults: mode "cascade", status "queued", platform "unknown",
 * best_method "none", probes [], score 0, grade "F", checks [], after null, recommendations []).
 * Never touches stores: WS2 sets stores.best_method / dom_recipe / latest_scan_id via updateStore().
 */
export async function upsertScan(
  patch: Partial<ScanReport> & ({ id: string } | { store_id: string; url: string }),
): Promise<ScanReport> {
  const cols = scanColumns(patch);
  if (patch.id !== undefined) {
    if (Object.keys(cols).length === 0) {
      const scan = await getScan(patch.id);
      if (!scan) throw new AppError("not_found", "Scan not found", { id: patch.id });
      return scan;
    }
    const { data, error } = await db()
      .from("scans")
      .update(cols)
      .eq("id", patch.id)
      .select(SCAN_SELECT)
      .maybeSingle();
    if (error) throw toAppError(error);
    if (!data) throw new AppError("not_found", "Scan not found", { id: patch.id });
    return toScanReport(data);
  }
  if (!cols.store_id || !cols.url) {
    throw new AppError("validation_error", "upsertScan needs an id, or a store_id and a url");
  }
  // Omitted columns take their SQL defaults (the documented defaults above).
  const row = { ...cols, store_id: cols.store_id, url: cols.url } satisfies TablesInsert<"scans">;
  const { data, error } = await db().from("scans").insert(row).select(SCAN_SELECT).single();
  if (error) throw toAppError(error);
  return toScanReport(data);
}

/** queued → running, conditionally (update ... where status = 'queued'). null = someone else claimed it. */
export async function claimScan(id: string): Promise<ScanReport | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db()
    .from("scans")
    .update({ status: "running" })
    .eq("id", id)
    .eq("status", "queued")
    .select(SCAN_SELECT)
    .maybeSingle();
  if (error) throw toAppError(error);
  return data ? toScanReport(data) : null;
}

/** Most recent scan by created_at, optionally only with the given status. */
export async function getLatestScanForStore(storeId: string, opts?: { status?: ScanStatus }): Promise<ScanReport | null> {
  if (!isUuid(storeId)) return null;
  let q = db().from("scans").select(SCAN_SELECT).eq("store_id", storeId);
  if (opts?.status) q = q.eq("status", opts.status);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw toAppError(error);
  return data ? toScanReport(data) : null;
}

/** Latest queued/running scan created less than withinMin minutes ago, else null. */
export async function getActiveScanForStore(storeId: string, withinMin: number): Promise<ScanReport | null> {
  if (!isUuid(storeId)) return null;
  const { data, error } = await db()
    .from("scans")
    .select(SCAN_SELECT)
    .eq("store_id", storeId)
    .in("status", ACTIVE)
    .gt("created_at", minutesAgo(withinMin))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw toAppError(error);
  return data ? toScanReport(data) : null;
}

/** Number of queued/running scans created less than withinMin minutes ago (all stores). */
export async function countActiveScans(withinMin: number): Promise<number> {
  const { count, error } = await db()
    .from("scans")
    .select("id", { count: "exact", head: true })
    .in("status", ACTIVE)
    .gt("created_at", minutesAgo(withinMin));
  if (error) throw toAppError(error);
  return count ?? 0;
}

/** Marks the store's other queued/running scans "failed" (stale; 02 §6 step 9). Returns how many. */
export async function supersedeScans(storeId: string, exceptId: string): Promise<number> {
  if (!isUuid(storeId) || !isUuid(exceptId)) return 0;
  const { data, error } = await db()
    .from("scans")
    .update({ status: "failed" })
    .eq("store_id", storeId)
    .neq("id", exceptId)
    .in("status", ACTIVE)
    .select("id");
  if (error) throw toAppError(error);
  return data?.length ?? 0;
}

/** Uploads to the public bucket "scan-screenshots" at "{scanId}/{name}" (upsert) and returns the public URL. */
export async function uploadScanScreenshot(
  scanId: string, name: string, bytes: Uint8Array, contentType: string,
): Promise<string> {
  const path = `${scanId}/${name}`;
  const bucket = db().storage.from(SCREENSHOT_BUCKET);
  const { error } = await bucket.upload(path, bytes, { contentType, upsert: true, cacheControl: "31536000" });
  if (error) {
    throw new AppError("upstream_error", "Screenshot upload failed", { path, message: errorMessage(error) });
  }
  return bucket.getPublicUrl(path).data.publicUrl;
}
