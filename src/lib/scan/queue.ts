import "server-only";
import type { ScanMode, ScanReport, Store } from "@/lib/contracts";
import { ACCESS_METHODS } from "@/lib/contracts";
import { updateStore, upsertScan } from "@/lib/db";
import { emptyProbe } from "./probe";

// R11: shared by startScan and computeReadiness's no-scan fallback.
export async function queueScan(store: Store, mode: ScanMode): Promise<ScanReport> {
  const scan = await upsertScan({
    store_id: store.id, url: store.base_url, mode, status: "queued", platform: store.platform,
    best_method: "none", probes: ACCESS_METHODS.map((m) => emptyProbe(m)),
    score: 0, grade: "F", checks: [], after: null, recommendations: [],
  });
  await updateStore(store.id, { latest_scan_id: scan.id });
  return scan;
}
