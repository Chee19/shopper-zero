/* eslint-disable @typescript-eslint/no-unused-vars -- stub parameters, removed with the T+60 bodies */
import "server-only";
import type { ScanReport, ScanStatus } from "@/lib/contracts";
import { AppError } from "@/lib/errors";

// TODO(WS1 T+60)
/** Exact ScanReport contract (toScanReport). Malformed uuid → null. Includes opted-out stores' scans. */
export async function getScan(id: string): Promise<ScanReport | null> {
  throw new AppError("not_implemented", "getScan");
}

// TODO(WS1 T+60)
/**
 * With id: shallow-merge update of the given keys (probes / checks / recommendations are replaced whole).
 * With {store_id, url} and no id: insert (defaults: mode "cascade", status "queued", platform "unknown",
 * best_method "none", probes [], score 0, grade "F", checks [], after null, recommendations []).
 * Never touches stores: WS2 sets stores.best_method / dom_recipe / latest_scan_id via updateStore().
 */
export async function upsertScan(
  patch: Partial<ScanReport> & ({ id: string } | { store_id: string; url: string }),
): Promise<ScanReport> {
  throw new AppError("not_implemented", "upsertScan");
}

// TODO(WS1 T+60)
/** queued → running, conditionally (update ... where status = 'queued'). null = someone else claimed it. */
export async function claimScan(id: string): Promise<ScanReport | null> {
  throw new AppError("not_implemented", "claimScan");
}

// TODO(WS1 T+60)
/** Most recent scan by created_at, optionally only with the given status. */
export async function getLatestScanForStore(storeId: string, opts?: { status?: ScanStatus }): Promise<ScanReport | null> {
  throw new AppError("not_implemented", "getLatestScanForStore");
}

// TODO(WS1 T+60)
/** Latest queued/running scan created less than withinMin minutes ago, else null. */
export async function getActiveScanForStore(storeId: string, withinMin: number): Promise<ScanReport | null> {
  throw new AppError("not_implemented", "getActiveScanForStore");
}

// TODO(WS1 T+60)
/** Number of queued/running scans created less than withinMin minutes ago (all stores). */
export async function countActiveScans(withinMin: number): Promise<number> {
  throw new AppError("not_implemented", "countActiveScans");
}

// TODO(WS1 T+60)
/** Marks the store's other queued/running scans "failed" (stale; 02 §6 step 9). Returns how many. */
export async function supersedeScans(storeId: string, exceptId: string): Promise<number> {
  throw new AppError("not_implemented", "supersedeScans");
}

// TODO(WS1 T+60)
/** Uploads to the public bucket "scan-screenshots" at "{scanId}/{name}" (upsert) and returns the public URL. */
export async function uploadScanScreenshot(
  scanId: string, name: string, bytes: Uint8Array, contentType: string,
): Promise<string> {
  throw new AppError("not_implemented", "uploadScanScreenshot");
}
