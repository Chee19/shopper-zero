import type { ReadinessCheck, ReadinessGrade, ReadinessReport, Store, StoreUrls } from "@/components/lib/contracts";
import { MCP_PATH } from "@/lib/formats/ucp";

export const MOCK_APP_URL = "http://localhost:3000";
export const MOCK_WOO_URL = "https://demo-woo.example.com";
export const RECORDED_AT = "2026-09-26T09:20:00.000Z";

export function storeUrls(slug: string, base: string): StoreUrls {
  return {
    page: `${base}/stores/${slug}`,
    products_json: `${base}/s/${slug}/products.json`,
    llms_txt: `${base}/s/${slug}/llms.txt`,
    feed: `${base}/s/${slug}/feed.acp.jsonl`,
    ucp: `${base}/s/${slug}/.well-known/ucp`,
    mcp: `${base}${MCP_PATH}`,
  };
}

/** Rewrites fixture URLs onto the running app's origin. */
export function withAppUrl<T extends { slug: string; urls: StoreUrls }>(s: T, base: string): T {
  return { ...s, urls: storeUrls(s.slug, base) };
}

export const CHECKS = (pass: Partial<Record<ReadinessCheck["id"], string | true>>): ReadinessCheck[] => {
  const all: [ReadinessCheck["id"], string, number][] = [
    ["products_json", "products.json", 15],
    ["well_known_ucp", "/.well-known/ucp", 15],
    ["mcp_endpoint", "MCP endpoint", 15],
    ["llms_txt", "llms.txt", 10],
    ["jsonld_product_coverage", "Product JSON-LD", 15],
    ["sitemap", "Sitemap", 10],
    ["robots_allows_agents", "robots.txt allows agents", 10],
    ["agent_checkout", "Agent checkout", 10],
  ];
  return all.map(([id, label, weight]) => {
    const p = pass[id];
    return { id, label, weight, pass: p !== undefined, ...(typeof p === "string" ? { detail: p } : {}) };
  });
};

const ALL_PASS = CHECKS({
  products_json: true, well_known_ucp: true, mcp_endpoint: true, llms_txt: true,
  jsonld_product_coverage: true, sitemap: true, robots_allows_agents: true, agent_checkout: "Handoff with prefilled cart",
});

function report(score: number, grade: ReadinessGrade, checks: ReadinessCheck[], at = RECORDED_AT): ReadinessReport {
  return { score, grade, checks, computed_at: at };
}

type Seed = Partial<Store> & Pick<Store, "id" | "slug" | "domain" | "base_url" | "name" | "platform">;

function store(s: Seed): Store {
  return {
    currency: "USD",
    country: "US",
    status: "indexed",
    product_count: 0,
    strategy: null,
    checkout_connector: "handoff",
    readiness: {},
    claimed: false,
    claimed_at: null,
    opted_out: false,
    best_method: null,
    dom_recipe: null,
    latest_scan_id: null,
    last_crawled_at: RECORDED_AT,
    created_at: "2026-09-26T09:10:00.000Z",
    updated_at: RECORDED_AT,
    urls: storeUrls(s.slug, MOCK_APP_URL),
    ...s,
  };
}

export const STORE_IDS = {
  woo: "5b1f0c2e-0000-4000-8000-000000000001",
  berlin: "5b1f0c2e-0000-4000-8000-000000000002",
  hester: "5b1f0c2e-0000-4000-8000-000000000003",
  meridian: "5b1f0c2e-0000-4000-8000-000000000004",
  locked: "5b1f0c2e-0000-4000-8000-000000000005",
} as const;

export const MOCK_STORES: Store[] = [
  store({
    id: STORE_IDS.woo, slug: "shoperzero-demo", domain: "demo-woo.example.com", base_url: MOCK_WOO_URL,
    name: "ShoperZero Demo", platform: "woocommerce", checkout_connector: "woo_store_api", product_count: 24,
    strategy: { tier: "platform_api", adapter: "woocommerce" }, best_method: "api", latest_scan_id: "replay-api",
    readiness: {
      before: report(78, "B", CHECKS({ jsonld_product_coverage: true, sitemap: true, robots_allows_agents: true, agent_checkout: "WooCommerce Store API" })),
      after: report(96, "A", ALL_PASS),
    },
    claimed: true, claimed_at: "2026-09-26T08:55:00.000Z",
  }),
  store({
    id: STORE_IDS.berlin, slug: "berlinpackaging-com", domain: "berlinpackaging.com", base_url: "https://www.berlinpackaging.com",
    name: "Berlin Packaging", platform: "bigcommerce", product_count: 40,
    strategy: { tier: "jsonld" }, best_method: "dom", latest_scan_id: "replay-dom",
    dom_recipe: {
      product_card: "li.product", title: "h1.productView-title", price: ".price--main",
      add_to_cart: "#form-action-addToCart", cart_link: "a.navUser-action--cart", checkout_link: "a[href='/checkout']",
    },
    readiness: {
      before: report(48, "D", CHECKS({ jsonld_product_coverage: "3/3 sampled pages", sitemap: "1,204 product URLs", robots_allows_agents: true })),
      after: report(96, "A", ALL_PASS),
    },
  }),
  store({
    id: STORE_IDS.hester, slug: "hester-demo-squarespace-com", domain: "hester-demo.squarespace.com",
    base_url: "https://hester-demo.squarespace.com", name: "Hester", platform: "squarespace", product_count: 18,
    strategy: { tier: "platform_api", adapter: "squarespace" }, best_method: "api",
    readiness: {
      before: report(70, "C", CHECKS({ sitemap: true, robots_allows_agents: true, jsonld_product_coverage: true })),
      after: report(94, "A", ALL_PASS),
    },
    updated_at: "2026-09-26T09:02:00.000Z",
  }),
  store({
    id: STORE_IDS.meridian, slug: "meridian-athletic-example", domain: "meridian-athletic.example",
    base_url: "https://meridian-athletic.example", name: "Meridian Athletic", platform: "custom", status: "pending",
    best_method: "computer_use", latest_scan_id: "replay-cu", last_crawled_at: null,
    readiness: { before: report(22, "F", CHECKS({ robots_allows_agents: true })) },
    updated_at: "2026-09-26T08:40:00.000Z",
  }),
  store({
    id: STORE_IDS.locked, slug: "lockedshop-example", domain: "lockedshop.example", base_url: "https://lockedshop.example",
    name: "Locked Shop", platform: "unknown", status: "blocked", best_method: "none", latest_scan_id: "replay-none",
    last_crawled_at: null, readiness: { before: report(0, "F", CHECKS({})) },
    updated_at: "2026-09-26T08:30:00.000Z",
  }),
];

export function mockStoreBySlug(slug: string): Store | null {
  return MOCK_STORES.find((s) => s.slug === slug) ?? null;
}
