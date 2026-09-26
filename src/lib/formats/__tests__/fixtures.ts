// Shared fixtures for WS3 format tests (not a test file itself).
import type { IndexedProduct, IndexedVariant, Store } from "@/lib/contracts";

export const BASE = "https://app.test";
const T = "2026-09-26T10:41:07.000Z";

export function variant(over: Partial<IndexedVariant> & { title: string; options: Record<string, string> }): IndexedVariant {
  return {
    id: `v-${over.title}`,
    seq: 3100,
    product_id: "p-1",
    external_id: "128",
    position: 1,
    sku: `HOOD-${over.title}`,
    gtin: null,
    image_url: null,
    inventory_quantity: 14,
    offer: {
      price: { amount: 4500, currency: "USD" },
      compare_at: { amount: 6000, currency: "USD" },
      availability: "in_stock",
      url: `https://demo-woo.example.com/product/hoodie/?attribute_pa_size=${over.title.toLowerCase()}`,
      checked_at: T,
    },
    ...over,
  };
}

export function product(over: Partial<IndexedProduct> = {}): IndexedProduct {
  const variants = over.variants ?? [
    variant({ id: "v-s", seq: 3101, position: 1, title: "S", options: { Size: "S" }, offer: { ...variant({ title: "S", options: {} }).offer, availability: "out_of_stock" } }),
    variant({ id: "v-m", seq: 3102, position: 2, title: "M", options: { Size: "M" }, gtin: "0012345678905" }),
    variant({ id: "v-l", seq: 3103, position: 3, title: "L", options: { Size: "L" }, image_url: "https://demo-woo.example.com/l.jpg" }),
  ];
  return {
    id: "p-1",
    seq: 1204,
    external_id: "120",
    url: "https://demo-woo.example.com/product/classic-pullover-hoodie/",
    handle: "classic-pullover-hoodie",
    title: "Classic Pullover Hoodie",
    description_html: "<p>Heavyweight &amp; warm hoodie.</p>",
    description_text: null,
    brand: "Northline",
    product_type: "Hoodies",
    category: null,
    tags: ["hoodie", "fleece"],
    images: [
      { url: "https://demo-woo.example.com/hoodie.jpg", alt: "Front" },
      { url: "https://demo-woo.example.com/l.jpg" },
    ],
    options: [{ name: "Size", values: ["S", "M", "L"] }],
    source: "platform_api",
    store: { id: "s-1", slug: "demo-woo-example-com", name: "Demo Woo", domain: "demo-woo.example.com", platform: "woocommerce" },
    price_range: { min: { amount: 4500, currency: "USD" }, max: { amount: 4500, currency: "USD" } },
    available: true,
    variants,
    checkout_methods: ["handoff"],
    updated_at: T,
    ...over,
  };
}

export function store(over: Partial<Store> = {}): Store {
  const slug = over.slug ?? "demo-woo-example-com";
  return {
    id: "s-1",
    slug,
    domain: "demo-woo.example.com",
    base_url: "https://demo-woo.example.com",
    name: "Demo Woo",
    platform: "woocommerce",
    currency: "USD",
    country: "US",
    status: "indexed",
    product_count: 1,
    strategy: null,
    checkout_connector: "handoff",
    readiness: {},
    claimed: false,
    claimed_at: null,
    opted_out: false,
    best_method: null,
    dom_recipe: null,
    latest_scan_id: null,
    last_crawled_at: T,
    created_at: T,
    updated_at: T,
    urls: {
      page: `${BASE}/stores/${slug}`,
      products_json: `${BASE}/s/${slug}/products.json`,
      llms_txt: `${BASE}/s/${slug}/llms.txt`,
      feed: `${BASE}/s/${slug}/feed.acp.jsonl`,
      ucp: `${BASE}/s/${slug}/.well-known/ucp`,
      mcp: `${BASE}/api/mcp`,
    },
    ...over,
  };
}
