import "server-only";
import type { ComputeReadinessFn } from "@/contracts";
import { getIndexStats, getLatestScanForStore } from "@/infrastructure/database";
import { AppError } from "@/shared/errors";
import { queueScan } from "@/features/scan/queue";
import { runScan } from "@/features/scan/run";
import { afterReadiness, beforeReadiness } from "@/features/scan/score";

// R8: no finished scan yet, run one synchronously (api-only, capped) instead of leaving readiness empty.
export const computeReadiness: ComputeReadinessFn = async (store, phase) => {
  if (phase === "after") {
    const stats = await getIndexStats(store.id);
    return afterReadiness(store, stats);
  }

  const scan = await getLatestScanForStore(store.id, { status: "done" });
  if (scan) return beforeReadiness(scan);

  if (store.opted_out) {
    throw new AppError("forbidden", "Store is opted out of scanning");
  }

  const queued = await queueScan(store, "cascade");
  const result = await runScan(queued.id, { methods: ["api"], budgetMs: 45_000 });
  return beforeReadiness(result);
};
