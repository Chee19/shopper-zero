import type { AccessMethod, PaymentRailId, PublicMetrics } from "../lib/contracts";

export type UiMetrics = PublicMetrics & {
  median_seconds_to_ready: number | null;                                   // last 50 succeeded crawl_runs
  stores_by_best_method: Partial<Record<AccessMethod | "none", number>>;    // stores.best_method
  orders_by_rail: Partial<Record<PaymentRailId, number>>;                   // orders.rail
};
