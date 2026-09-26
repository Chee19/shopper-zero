import "server-only";
import { after } from "next/server";
import type { RunScanFn, ScanReport, StartScanFn } from "@/contracts";
import { assertPublicHost } from "@/features/crawl/url";
import { staleAware } from "@/features/crawl/view";
import {
  countActiveScans, getActiveScanForStore, getScan, getStoreByDomain, supersedeScans, upsertStoreForUrl,
} from "@/infrastructure/database";
import { appUrl, flags, optionalEnv } from "@/shared/env";
import { AppError } from "@/shared/errors";
import { log } from "@/shared/log";
import { normalizeStoreUrl } from "@/shared/slug";
import { queueScan } from "./queue";
import { runScan as runScanWithOpts } from "./run";

// A queued or running scan older than this is dead (02 section 6.9 step 9).
const ACTIVE_WINDOW_MIN = 6;

// 02 section 7.3 steps 1-6. Must run inside a request scope because of after().
export const startScan: StartScanFn = async (rawUrl, opts) => {
  const allowPrivate = flags.allowPrivateStoreHosts();
  let normalized: { base_url: string; domain: string };
  try {
    normalized = normalizeStoreUrl(rawUrl, { allowPrivate });
  } catch {
    throw new AppError("validation_error", "Not a valid store URL", { reason: "invalid_url" });
  }
  await assertPublicHost(normalized.base_url, allowPrivate);
  // The store row is only inserted once the scan is accepted, so rejected requests leave nothing behind.
  const existing = await getStoreByDomain(normalized.domain);
  if (existing?.opted_out) throw optedOut();
  const active = existing && await getActiveScanForStore(existing.id, ACTIVE_WINDOW_MIN);
  if (existing && active) return { ...links(active.id, existing.id), reused: true };

  const maxConcurrent = Number(optionalEnv("SCAN_MAX_CONCURRENT") ?? 3) || 3;
  if ((await countActiveScans(ACTIVE_WINDOW_MIN)) >= maxConcurrent) {
    throw new AppError("rate_limited", "Too many scans running; retry in 30 s.");
  }
  const store = existing ?? (await upsertStoreForUrl(rawUrl)).store;
  if (store.opted_out) throw optedOut();

  const scan = await queueScan(store, opts?.mode ?? "cascade");
  // Any other queued or running scan for this store is past the active window, so it is dead.
  await supersedeScans(store.id, scan.id);
  after(() => runScanWithOpts(scan.id));
  log.info("scan.queued", { scan_id: scan.id, store_id: store.id, mode: scan.mode });
  return { ...links(scan.id, store.id), reused: false };
};

export const runScan: RunScanFn = (scanId) => runScanWithOpts(scanId);

const optedOut = () => new AppError("forbidden", "The merchant has opted out of ShoperZero.", { reason: "opted_out" });

// A queued/running scan whose worker died reads as failed with error "stale".
export async function getScanReport(scanId: string): Promise<(ScanReport & { error?: string | null }) | null> {
  const scan = await getScan(scanId);
  return scan && staleAware(scan);
}

function links(scanId: string, storeId: string) {
  return {
    scan_id: scanId, store_id: storeId,
    status_url: `${appUrl()}/api/v1/scans/${scanId}`,
    report_url: `${appUrl()}/scan/${scanId}`,
  };
}
