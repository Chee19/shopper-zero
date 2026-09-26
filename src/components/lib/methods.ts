import type { AccessMethod, AccessProbe, Capabilities, ProbeStatus, ScanReport } from "./contracts";
import type { Tone } from "./format";

export const METHOD_ORDER: AccessMethod[] = ["api", "dom", "computer_use"];

export const METHOD_META: Record<AccessMethod, { label: string; short: string; blurb: string; band: string }> = {
  api:          { label: "API", short: "API", band: "Best",
                  blurb: "A machine interface agents call directly: UCP, MCP, products.json, platform APIs." },
  dom:          { label: "Web scraping (DOM)", short: "DOM", band: "Middle",
                  blurb: "Reading the page structure (JSON-LD, HTML, accessibility tree) to know what to read and where to click." },
  computer_use: { label: "Computer use", short: "Computer use", band: "Lowest",
                  blurb: "Screenshots plus a vision model decide every click. Slow and expensive. We stop before payment." },
};

/** Display-only fallback when a probe's estimate is null (e.g. a skipped method). Always labeled "typical". */
export const TYPICAL_COST: Record<AccessMethod, { s: number; usd: number }> = {
  api: { s: 1, usd: 0 }, dom: { s: 8, usd: 0.01 }, computer_use: { s: 90, usd: 0.3 },
};

export const CU_MAX_STEPS = 15; // mirrors SCAN_CU_MAX_STEPS default; display only

export const CAPABILITY_LABELS: Record<keyof Capabilities, string> = {
  catalog: "Catalog", product_detail: "Details", price_availability: "Price & stock",
  variants: "Variants", cart: "Cart", checkout_reachable: "Checkout reachable",
};
export const CAPABILITY_KEYS = Object.keys(CAPABILITY_LABELS) as (keyof Capabilities)[];

export const METHOD_TONE: Record<AccessMethod | "none", Tone> = {
  api: "good", dom: "warn", computer_use: "serious", none: "bad",
};

export function methodLabel(m: AccessMethod | "none" | null | undefined): string {
  if (!m || m === "none") return "None";
  return METHOD_META[m].label;
}

export function probeFor(scan: Pick<ScanReport, "probes">, m: AccessMethod): AccessProbe {
  const found = Array.isArray(scan.probes) ? scan.probes.find((p) => p.method === m) : undefined;
  return found ?? pendingProbe(m);
}

export function pendingProbe(m: AccessMethod): AccessProbe {
  return {
    method: m, status: "pending", started_at: null, finished_at: null, duration_ms: null, signals: [],
    capabilities: { catalog: false, product_detail: false, price_availability: false, variants: false, cart: false, checkout_reachable: false },
    sample_products: 0, est_seconds_per_task: null, est_usd_per_task: null,
  };
}

/** Estimated seconds/USD per task: the probe's own numbers, else the typical value (flagged). */
export function costOf(p: AccessProbe): { s: number; usd: number; typical: boolean } {
  const t = TYPICAL_COST[p.method];
  const typical = p.est_seconds_per_task == null || p.est_usd_per_task == null;
  return { s: p.est_seconds_per_task ?? t.s, usd: p.est_usd_per_task ?? t.usd, typical };
}

export function capabilityCount(c: Capabilities | null | undefined): number {
  if (!c) return 0;
  return CAPABILITY_KEYS.filter((k) => c[k]).length;
}

export function anyPassed(scan: Pick<ScanReport, "probes">): boolean {
  return Array.isArray(scan.probes) && scan.probes.some((p) => p.status === "passed" || p.status === "partial");
}

export const STATUS_CHIP: Record<ProbeStatus, { label: string; tone: Tone }> = {
  pending: { label: "Waiting", tone: "muted" },
  running: { label: "Probing…", tone: "accent" },
  passed: { label: "Works", tone: "good" },
  partial: { label: "Partial", tone: "warn" },
  failed: { label: "Failed", tone: "bad" },
  skipped: { label: "Not needed", tone: "muted" },
  blocked: { label: "Blocked by bot protection", tone: "warn" },
};

export function statusChip(status: ProbeStatus, somethingPassed: boolean): { label: string; tone: Tone } {
  if (status === "skipped") return { label: somethingPassed ? "Not needed" : "Not tried", tone: "muted" };
  return STATUS_CHIP[status] ?? STATUS_CHIP.pending;
}

export const STRATEGY_LABELS: Record<string, string> = {
  platform_api: "Platform API",
  jsonld: "Sitemap + JSON-LD",
  microdata: "Microdata",
  opengraph: "OpenGraph",
  render: "Rendered pages",
  llm: "LLM extraction",
  dom_recipe: "DOM recipe",
};

export const PLATFORM_LABELS: Record<string, string> = {
  woocommerce: "WooCommerce", magento: "Magento", bigcommerce: "BigCommerce", squarespace: "Squarespace",
  sfcc: "Salesforce Commerce", prestashop: "PrestaShop", wix: "Wix", shopify: "Shopify", custom: "Custom", unknown: "Unknown",
};

export const CONNECTOR_LABELS: Record<string, string> = {
  woo_store_api: "WooCommerce Store API",
  magento_guest: "Magento guest cart",
  handoff: "Handoff",
  browser: "Browser",
};
