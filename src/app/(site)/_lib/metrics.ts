import "server-only";
import { connection } from "next/server";
import type { UiMetrics } from "@/components/metrics/types";
import { loadDb } from "./db";
import { UI_MOCK } from "./env";
import { MOCK_METRICS } from "./mock";

/** Never throws: any failure renders "Metrics unavailable" (spec 05 §7.6). */
export async function getUiMetrics(): Promise<UiMetrics | null> {
  await connection();
  if (UI_MOCK) return MOCK_METRICS;
  try {
    const db = await loadDb();
    if (!db) return null;
    const base = await db.getPublicMetrics();
    return {
      ...base,
      // WS1 folds the round-2 extras into PublicMetrics (optional fields, §12 R2-9).
      median_seconds_to_ready: base.median_seconds_to_agent_ready ?? null,
      stores_by_best_method: base.stores_by_best_method ?? {},
      orders_by_rail: base.orders_by_rail ?? {},
    };
  } catch {
    return null;
  }
}
