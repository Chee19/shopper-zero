// One ScanReport per best_method (spec 05 §9.2). Scores are illustrative; WS2 owns the real weights.
import type { AccessProbe, Capabilities, ProbeSignal, ScanReport } from "@/components/lib/contracts";
import { mockShot } from "./shots";
import { CHECKS, MOCK_WOO_URL, RECORDED_AT, STORE_IDS } from "./stores";

const NONE: Capabilities = { catalog: false, product_detail: false, price_availability: false, variants: false, cart: false, checkout_reachable: false };
const ALL: Capabilities = { catalog: true, product_detail: true, price_availability: true, variants: true, cart: true, checkout_reachable: true };

const t = (sec: number) => new Date(Date.parse(RECORDED_AT) + sec * 1000).toISOString();

function probe(p: Partial<AccessProbe> & Pick<AccessProbe, "method" | "status">): AccessProbe {
  return {
    started_at: null, finished_at: null, duration_ms: null, signals: [], capabilities: NONE,
    sample_products: 0, est_seconds_per_task: null, est_usd_per_task: null, ...p,
  };
}
const sig = (id: string, label: string, ok: boolean, detail?: string, url?: string): ProbeSignal => ({
  id, label, ok, ...(detail ? { detail } : {}), ...(url ? { url } : {}),
});

function scan(s: Partial<ScanReport> & Pick<ScanReport, "id" | "store_id" | "url" | "platform" | "best_method" | "probes" | "score" | "grade">): ScanReport {
  return {
    mode: "cascade", status: "done", checks: [], after: null, recommendations: [],
    created_at: t(0), updated_at: t(30), ...s,
  };
}

// ---------- replay-api: WooCommerce demo store ----------
export const SCAN_API: ScanReport = scan({
  id: "replay-api", store_id: STORE_IDS.woo, url: MOCK_WOO_URL, platform: "woocommerce", best_method: "api",
  score: 78, grade: "B", after: { score: 96, grade: "A" },
  probes: [
    probe({
      method: "api", status: "passed", started_at: t(1), finished_at: t(3.4), duration_ms: 2400,
      signals: [
        sig("woo_store_api", "Woo Store API 200 · 24 products", true, "wp-json/wc/store/v1/products", `${MOCK_WOO_URL}/wp-json/wc/store/v1/products`),
        sig("woo_cart", "Store API cart endpoint", true, "wc/store/v1/cart"),
        sig("products_json", "products.json 404", false, "Not a Shopify store"),
        sig("well_known_ucp", "/.well-known/ucp 404", false),
        sig("mcp", "MCP none", false, "No MCP discovery document"),
      ],
      capabilities: ALL, sample_products: 24, est_seconds_per_task: 1, est_usd_per_task: 0,
      endpoints: [`${MOCK_WOO_URL}/wp-json/wc/store/v1/products`, `${MOCK_WOO_URL}/wp-json/wc/store/v1/cart`],
    }),
    probe({ method: "dom", status: "skipped", est_seconds_per_task: 8, est_usd_per_task: 0.01 }),
    probe({ method: "computer_use", status: "skipped" }),
  ],
  checks: CHECKS({ jsonld_product_coverage: "8/8 sampled pages", sitemap: true, robots_allows_agents: true, agent_checkout: "WooCommerce Store API" }),
  recommendations: [
    "Publish a UCP profile at /.well-known/ucp",
    "Expose an MCP endpoint for catalog search and checkout",
    "Serve llms.txt with agent instructions",
  ],
});

// ---------- replay-dom: Berlin Packaging (the demo fixture) ----------
export const SCAN_DOM: ScanReport = scan({
  id: "replay-dom", store_id: STORE_IDS.berlin, url: "https://www.berlinpackaging.com", platform: "bigcommerce", best_method: "dom",
  score: 48, grade: "D", after: { score: 96, grade: "A" },
  probes: [
    probe({
      method: "api", status: "failed", started_at: t(1), finished_at: t(4), duration_ms: 3000,
      signals: [
        sig("products_json", "/products.json 404", false, "Not a Shopify store", "https://www.berlinpackaging.com/products.json"),
        sig("well_known_ucp", "/.well-known/ucp 404", false),
        sig("mcp", "MCP discovery none", false),
        sig("platform_api", "No platform API", false, "BigCommerce storefront API needs a merchant token"),
      ],
      est_seconds_per_task: 1, est_usd_per_task: 0,
    }),
    probe({
      method: "dom", status: "passed", started_at: t(4.2), finished_at: t(12.6), duration_ms: 8400,
      signals: [
        sig("robots", "robots.txt allows agents", true),
        sig("sitemap", "sitemap: 1,204 product URLs", true, "/xmlsitemap.php?type=products", "https://www.berlinpackaging.com/xmlsitemap.php"),
        sig("jsonld", "JSON-LD Product on 3/3 samples", true, "Offer with price and availability"),
        sig("add_to_cart", "Add-to-cart located", true, "#form-action-addToCart"),
        sig("variant_picker", "Variant picker not found", false, "Sizes are separate products"),
      ],
      capabilities: { catalog: true, product_detail: true, price_availability: true, variants: false, cart: true, checkout_reachable: false },
      sample_products: 3, est_seconds_per_task: 8, est_usd_per_task: 0.01,
      recipe: {
        product_card: "li.product",
        title: "h1.productView-title",
        price: ".price--main",
        add_to_cart: "#form-action-addToCart",
        cart_link: "a.navUser-action--cart",
        checkout_link: "a[href='/checkout']",
        notes: "Checkout link found; not followed past the cart.",
        verified_at: t(12),
      },
    }),
    probe({ method: "computer_use", status: "skipped", est_seconds_per_task: 90, est_usd_per_task: 0.3 }),
  ],
  checks: CHECKS({ jsonld_product_coverage: "3/3 sampled pages", sitemap: "1,204 product URLs", robots_allows_agents: true }),
  recommendations: [
    "Publish a UCP profile at /.well-known/ucp",
    "Expose an MCP endpoint for catalog search",
    "Add variant data to Product JSON-LD",
  ],
});

// ---------- replay-cu: JS-only store, reachable by computer use only ----------
const CU_STEPS: { action: string; reasoning: string; title: string; lines: string[]; highlight?: string }[] = [
  { action: 'goto("/")', reasoning: "Homepage", title: "Run further.", lines: ["New season", "Trail Runner", "Road Pro"], highlight: "Shop" },
  { action: 'click("Shop")', reasoning: "Main nav leads to the catalog", title: "Shop all", lines: ["Trail Runner  $128", "Road Pro  $140", "Court Classic  $95"], highlight: "Trail Runner" },
  { action: 'click("Trail Runner")', reasoning: "First product card", title: "Trail Runner", lines: ["Loading price…", "Size", "Color: Slate"] },
  { action: "read price $128.00", reasoning: "Price appears after JavaScript renders", title: "Trail Runner", lines: ["$128.00", "Size", "Color: Slate"], highlight: "$128.00" },
  { action: 'select("Size 9")', reasoning: "Variant picker is a dropdown", title: "Trail Runner", lines: ["$128.00", "Size: 9", "Color: Slate"], highlight: "Size 9" },
  { action: 'click("Add to cart")', reasoning: "Button below the price", title: "Trail Runner", lines: ["$128.00", "Size: 9", "Added to cart"], highlight: "Add to cart" },
  { action: 'click("Cart")', reasoning: "Cart icon in the header", title: "Your cart", lines: ["Trail Runner · 9", "Subtotal $128.00"], highlight: "Cart (1)" },
  { action: 'click("Checkout")', reasoning: "Primary button in the cart", title: "Your cart", lines: ["Trail Runner · 9", "Subtotal $128.00"], highlight: "Checkout" },
  { action: "stop", reasoning: "Checkout page reached: stopping before payment", title: "Checkout", lines: ["Contact", "Shipping address", "Payment (not entered)"], highlight: "Stop before payment" },
];
const CU_SHOTS = CU_STEPS.map((s) => mockShot(s.title, s.lines, s.highlight));

export const SCAN_CU: ScanReport = scan({
  id: "replay-cu", store_id: STORE_IDS.meridian, url: "https://meridian-athletic.example", platform: "custom", best_method: "computer_use",
  score: 22, grade: "F", after: null, updated_at: t(120),
  probes: [
    probe({
      method: "api", status: "failed", started_at: t(1), finished_at: t(3.5), duration_ms: 2500,
      signals: [
        sig("products_json", "/products.json 404", false),
        sig("well_known_ucp", "/.well-known/ucp 404", false),
        sig("mcp", "MCP discovery none", false),
        sig("platform_api", "No platform API", false, "Custom storefront"),
      ],
      est_seconds_per_task: 1, est_usd_per_task: 0,
    }),
    probe({
      method: "dom", status: "failed", started_at: t(3.6), finished_at: t(11), duration_ms: 7400,
      signals: [
        sig("robots", "robots.txt allows agents", true),
        sig("sitemap", "No product sitemap", false),
        sig("js_price", "Price rendered by JavaScript only", false, "Empty <span class=price> in the HTML"),
        sig("jsonld", "No JSON-LD Offer", false),
      ],
      est_seconds_per_task: 8, est_usd_per_task: 0.01,
    }),
    probe({
      method: "computer_use", status: "passed", started_at: t(11.2), finished_at: t(105), duration_ms: 93800,
      signals: [
        sig("browser", "Browser session started", true, "1280×800"),
        sig("product", "Product page reached", true, "Trail Runner"),
        sig("price", "Price read from screenshot", true, "$128.00"),
        sig("cart", "Added to cart", true),
        sig("checkout", "Checkout page reached", true, "Stopped before payment"),
      ],
      capabilities: ALL, sample_products: 1, est_seconds_per_task: 94, est_usd_per_task: 0.31,
      screenshots: CU_SHOTS,
      steps: CU_STEPS.map((s, i) => ({ i: i + 1, action: s.action, reasoning: s.reasoning, screenshot: CU_SHOTS[i] })),
    }),
  ],
  checks: CHECKS({ robots_allows_agents: true }),
  recommendations: [
    "Add Product JSON-LD with Offer (price and availability) to product pages",
    "Render prices in the HTML, not only with JavaScript",
    "Claim the store to connect a feed",
  ],
});

// ---------- replay-none: bot protection everywhere ----------
const blocked = (method: AccessProbe["method"], at: number): AccessProbe =>
  probe({
    method, status: "blocked", started_at: t(at), finished_at: t(at + 1.5), duration_ms: 1500,
    signals: [sig("challenge", "Bot challenge (403) on homepage", false, "cf-mitigated: challenge")],
    error: { code: "upstream_blocked", message: "Bot challenge (403) on homepage" },
    est_seconds_per_task: method === "api" ? 1 : method === "dom" ? 8 : 90,
    est_usd_per_task: method === "api" ? 0 : method === "dom" ? 0.01 : 0.3,
  });

export const SCAN_NONE: ScanReport = scan({
  id: "replay-none", store_id: STORE_IDS.locked, url: "https://lockedshop.example", platform: "unknown", best_method: "none",
  score: 0, grade: "F", after: null, updated_at: t(8),
  probes: [blocked("api", 1), blocked("dom", 3), blocked("computer_use", 5)],
  checks: CHECKS({}),
  recommendations: ["Allow verified agents (Web Bot Auth) or claim the store."],
});

export const MOCK_SCANS: Record<string, ScanReport> = {
  "replay-api": SCAN_API,
  "replay-dom": SCAN_DOM,
  "replay-cu": SCAN_CU,
  "replay-none": SCAN_NONE,
};
