import "server-only";
import type {
  AccessMethod, AccessProbe, Capabilities, ReadinessCheck, ReadinessCheckId, ReadinessGrade,
  ReadinessReport, ScanReport, Store,
} from "@/contracts";
import { READINESS_WEIGHTS, gradeFor } from "@/contracts";
import { resolveCheckoutConnector } from "@/features/crawl/checkout-connector";
import type { IndexStats } from "@/infrastructure/database";
import { bestMethod } from "./probe";

export type MethodClass = "api_standard" | "api_platform" | "dom" | "computer_use" | "none";
export const BAND: Record<MethodClass, number> = { api_standard: 45, api_platform: 20, dom: 15, computer_use: 5, none: 0 };
export const FACTOR: Record<MethodClass, number> = { api_standard: 1.0, api_platform: 0.7, dom: 0.6, computer_use: 0.3, none: 0 };
// Sums to 35.
export const CAPABILITY_WEIGHTS: Record<keyof Capabilities, number> = {
  catalog: 7, product_detail: 5, price_availability: 8, variants: 4, cart: 6, checkout_reachable: 5,
};
export const CHECKS_SHARE = 0.20; // max 20 points

// 02 section 6.3: api signal ids whose capabilities count as "standard" (agent-discoverable) rather than platform-private.
export const STANDARD_SIGNAL_IDS = ["ucp_profile", "ucp_capabilities", "mcp_endpoint", "acp_feed", "products_json", "shopify_cart"];

export function methodClass(best: AccessProbe | null): MethodClass {
  if (!best) return "none";
  if (best.method === "dom") return "dom";
  if (best.method === "computer_use") return "computer_use";
  const standard = best.signals.some((s) => s.ok && STANDARD_SIGNAL_IDS.includes(s.id));
  return standard ? "api_standard" : "api_platform";
}

const clampScore = (s: number) => Math.min(100, Math.max(0, Math.round(s)));

function checksScoreOf(checks: ReadinessCheck[]): number {
  return checks.reduce((sum, c) => (c.pass ? sum + READINESS_WEIGHTS[c.id] : sum), 0);
}

function capabilityScore(caps: Capabilities, cls: MethodClass): number {
  const factor = FACTOR[cls];
  return (Object.keys(CAPABILITY_WEIGHTS) as (keyof Capabilities)[])
    .reduce((sum, cap) => (caps[cap] ? sum + CAPABILITY_WEIGHTS[cap] * factor : sum), 0);
}

export function scoreScan(input: { probes: AccessProbe[]; checks: ReadinessCheck[] }):
{ best_method: AccessMethod | "none"; method_class: MethodClass; score: number; grade: ReadinessGrade } {
  const best_method = bestMethod(input.probes);
  const best = best_method === "none" ? null : input.probes.find((p) => p.method === best_method) ?? null;
  const method_class = methodClass(best);
  const S = BAND[method_class]
    + (best ? capabilityScore(best.capabilities, method_class) : 0)
    + CHECKS_SHARE * checksScoreOf(input.checks);
  const score = clampScore(S);
  return { best_method, method_class, score, grade: gradeFor(score) };
}

export function projectAfter(input: { best_method: AccessMethod | "none"; store: Store; checks: ReadinessCheck[] }):
{ score: number; grade: ReadinessGrade } | null {
  if (input.best_method === "computer_use" || input.best_method === "none") return null;
  // Assumes indexing succeeds with complete offers (DECISIONS A); the actual value comes from afterScore.
  const { score, grade } = computeAfter(input.store, { product_count: 1, variant_count: 1, offers_complete_ratio: 1 });
  return { score, grade };
}

// 02 section 9's "after" checks: computed from DB state, no network call.
function afterChecks(store: Store, stats: IndexStats): ReadinessCheck[] {
  const connector = resolveCheckoutConnector(store);
  const hasProducts = stats.product_count > 0;
  const offersOk = stats.offers_complete_ratio >= 0.8;
  const completeCount = Math.round(stats.offers_complete_ratio * stats.product_count);
  const checkoutOk = connector !== "handoff";
  const rows: { id: ReadinessCheckId; label: string; pass: boolean; detail: string }[] = [
    { id: "products_json", label: "Machine-readable catalog", pass: hasProducts, detail: store.urls.products_json },
    { id: "well_known_ucp", label: "UCP profile", pass: hasProducts, detail: store.urls.ucp },
    { id: "mcp_endpoint", label: "MCP endpoint", pass: true, detail: store.urls.mcp },
    { id: "llms_txt", label: "llms.txt", pass: hasProducts, detail: store.urls.llms_txt },
    {
      id: "jsonld_product_coverage", label: "JSON-LD product coverage", pass: offersOk,
      detail: `${completeCount}/${stats.product_count} products with live price + availability`,
    },
    { id: "sitemap", label: "Product sitemap", pass: hasProducts, detail: `${stats.product_count} products indexed` },
    { id: "robots_allows_agents", label: "robots.txt allows agents", pass: true, detail: "Our robots.txt allows agents" },
    {
      id: "agent_checkout", label: "Agent checkout", pass: checkoutOk,
      detail: checkoutOk ? `Automated checkout via ${connector}` : "Assisted checkout: prefilled cart link",
    },
  ];
  return rows.map((r) => ({ ...r, weight: READINESS_WEIGHTS[r.id] }));
}

function computeAfter(store: Store, stats: IndexStats): { checks: ReadinessCheck[]; score: number; grade: ReadinessGrade } {
  const checks = afterChecks(store, stats);
  const checkoutOk = resolveCheckoutConnector(store) !== "handoff";
  const caps: Capabilities = {
    catalog: true, product_detail: true, price_availability: true, variants: true,
    cart: checkoutOk, checkout_reachable: true,
  };
  const S = BAND.api_standard + capabilityScore(caps, "api_standard") + CHECKS_SHARE * checksScoreOf(checks);
  const score = clampScore(S);
  return { checks, score, grade: gradeFor(score) };
}

export function afterScore(store: Store, stats: IndexStats): { score: number; grade: ReadinessGrade } {
  const { score, grade } = computeAfter(store, stats);
  return { score, grade };
}

export function afterReadiness(store: Store, stats: IndexStats): ReadinessReport {
  const { checks, score, grade } = computeAfter(store, stats);
  return { score, grade, checks, computed_at: new Date().toISOString() };
}

// R11: identical output to computeReadiness(store, "before") right after a done scan, avoiding a readiness/scan-run import cycle.
export function beforeReadiness(scan: ScanReport): ReadinessReport {
  return { score: scan.score, grade: scan.grade, checks: scan.checks, computed_at: scan.updated_at };
}

const signalOk = (probes: AccessProbe[], id: string) => probes.some((p) => p.signals.some((s) => s.id === id && s.ok));

export function recommendations(r: Pick<ScanReport, "probes" | "checks" | "best_method" | "after">, store: Store): string[] {
  const check = (id: ReadinessCheckId) => r.checks.find((c) => c.id === id);
  const failed = (id: ReadinessCheckId) => check(id)?.pass === false;
  const best = r.best_method === "none" ? null : r.probes.find((p) => p.method === r.best_method) ?? null;

  const out: string[] = [];
  if (r.best_method === "none" && r.probes.some((p) => p.status === "blocked")) {
    out.push("Your site blocks automated agents (bot protection or robots.txt). AI assistants can't shop here; allowlist verified agents or publish a feed.");
  }
  if (r.best_method === "computer_use" && best) {
    const s = best.est_seconds_per_task ?? 0;
    const usd = (best.est_usd_per_task ?? 0).toFixed(2);
    out.push(`Agents can only use your store by looking at screenshots: about ${s} s and $${usd} per task, versus about 1 s and $0.00 with an API. Add structured product data and an agent endpoint.`);
  }
  if (failed("well_known_ucp")) {
    out.push(`Publish a UCP profile at /.well-known/ucp so agents can discover your catalog and checkout. ShoperZero hosts one for you at ${store.urls.ucp}.`);
  }
  if (failed("products_json") && !signalOk(r.probes, "acp_feed")) {
    out.push(`Expose a machine-readable catalog (products.json or an ACP feed). ShoperZero serves ${store.urls.products_json}.`);
  }
  if (failed("jsonld_product_coverage")) {
    out.push("Add schema.org Product + Offer JSON-LD (price, priceCurrency, availability) to every product page.");
  }
  const robots = check("robots_allows_agents");
  if (robots && !robots.pass) {
    out.push(`robots.txt blocks ${robots.detail ?? "some agents"}; allow them if you want AI assistants to recommend and buy your products.`);
  }
  if (best && !best.capabilities.cart) {
    out.push("Agents can't add to cart without a browser. Enable a headless cart API (e.g. WooCommerce Store API) or let ShoperZero hand off with a prefilled cart link.");
  }
  if (failed("mcp_endpoint")) {
    out.push(`Offer an MCP endpoint; ShoperZero provides one at ${store.urls.mcp}.`);
  }
  if (failed("llms_txt")) {
    out.push("Add /llms.txt describing how agents should shop your store.");
  }
  if (failed("sitemap")) {
    out.push("Publish a product sitemap listed in robots.txt.");
  }

  const result = out.slice(0, r.after ? 5 : 6);
  if (r.after) result.push(`Make it agent-ready: ShoperZero indexes your catalog and serves UCP/MCP endpoints (projected grade ${r.after.grade}).`);
  return result;
}
