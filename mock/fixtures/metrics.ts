import type { UiMetrics } from "@/components/metrics/types";

export const MOCK_METRICS: UiMetrics = {
  stores_total: 9,
  stores_indexed: 7,
  products: 1042,
  variants: 3318,
  agent_requests: 412,
  agent_requests_24h: 128,
  checkouts: 5,
  orders: 3,
  gmv_minor: { USD: 14100 },
  median_seconds_to_ready: 38,
  stores_by_best_method: { api: 4, dom: 3, computer_use: 1, none: 1 },
  orders_by_rail: { stripe_spt: 2, x402: 1 },
};
