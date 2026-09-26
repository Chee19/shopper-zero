import "server-only";
import { after } from "next/server";
import type { RunScanFn, ScanReport, StartScanFn } from "@/lib/contracts";
import { assertPublicHost } from "@/lib/crawl/url";
import { countActiveScans, getActiveScanForStore, getScan, supersedeScans, upsertStoreForUrl } from "@/lib/db";
import { appUrl, flags, optionalEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { normalizeStoreUrl } from "@/lib/slug";
import { queueScan } from "./queue";
import { runScan as runScanWithOpts } from "./run";

// A queued or running scan older than this is dead (02 section 6.9 step 9).
const ACTIVE_WINDOW_MIN = 6;

// 02 section 7.3 steps 1-6. Must run inside a request scope because of after().
export const startScan: StartScanFn = async (rawUrl, opts) => {
  const allowPrivate = flags.allowPrivateStoreHosts();
  let baseUrl: string;
  try {
    baseUrl = normalizeStoreUrl(rawUrl, { allowPrivate }).base_url;
  } catch {
    throw new AppError("validation_error", "Not a valid store URL", { reason: "invalid_url" });
  }
  await assertPublicHost(baseUrl, allowPrivate);
  const { store } = await upsertStoreForUrl(rawUrl);
  if (store.opted_out) {
    throw new AppError("forbidden", "The merchant has opted out of ShoperZero.", { reason: "opted_out" });
  }

  const active = await getActiveScanForStore(store.id, ACTIVE_WINDOW_MIN);
  if (active) return { ...links(active.id, store.id), reused: true };

  const maxConcurrent = Number(optionalEnv("SCAN_MAX_CONCURRENT") ?? 3) || 3;
  if ((await countActiveScans(ACTIVE_WINDOW_MIN)) >= maxConcurrent) {
    throw new AppError("rate_limited", "Too many scans running; retry in 30 s.");
  }

  const scan = await queueScan(store, opts?.mode ?? "cascade");
  // Any other queued or running scan for this store is past the active window, so it is dead.
  await supersedeScans(store.id, scan.id);
  after(() => runScanWithOpts(scan.id));
  log.info("scan.queued", { scan_id: scan.id, store_id: store.id, mode: scan.mode });
  return { ...links(scan.id, store.id), reused: false };
};

export const runScan: RunScanFn = (scanId) => runScanWithOpts(scanId);

export function getScanReport(scanId: string): Promise<ScanReport | null> {
  return getScan(scanId);
}

function links(scanId: string, storeId: string) {
  return {
    scan_id: scanId, store_id: storeId,
    status_url: `${appUrl()}/api/v1/scans/${scanId}`,
    report_url: `${appUrl()}/scan/${scanId}`,
  };
}
