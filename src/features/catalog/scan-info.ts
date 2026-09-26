// src/lib/agent/scan-info.ts  (WS3)
import "server-only";
import type { AccessMethod, ReadinessGrade, Store } from "@/contracts";
import { getLatestScanForStore } from "@/infrastructure/database";
import { appUrl } from "@/shared/env";

export interface ScanInfo {
  grade: ReadinessGrade;
  best_method: AccessMethod | "none";
  report_url: string;
  scanned_at: string;
}

/** Latest finished scan for a store, or null. Never throws: discovery files must not fail because of scans. */
export async function scanInfo(store: Pick<Store, "id">): Promise<ScanInfo | null> {
  try {
    const s = await getLatestScanForStore(store.id, { status: "done" });
    if (!s || s.status !== "done") return null;
    return { grade: s.grade, best_method: s.best_method, report_url: `${appUrl()}/scan/${s.id}`, scanned_at: s.updated_at };
  } catch {
    return null;
  }
}
