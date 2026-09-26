import assert from "node:assert/strict";
import { test } from "node:test";
import { acpPrice, currencyExponent, formatMoney, fromMinor, parsePrice, rescaleMinor, toMinor, toX402Price } from "./money";
import { handleFromUrl, normalizeStoreUrl, slugify, storeSlugFromDomain } from "./slug";
import {
  CompleteCheckoutInputSchema, CreateCheckoutInputSchema, NormalizedProductSchema,
  SearchCatalogInputSchema, STATE_TO_STATUS, ALLOWED_TRANSITIONS, CHECKOUT_STATES, MCP_TOOL_INPUTS,
} from "./contracts";
import { z } from "zod";

test("money", () => {
  assert.equal(currencyExponent("usd"), 2);
  assert.equal(currencyExponent("JPY"), 0);
  assert.equal(currencyExponent("KWD"), 3);
  assert.equal(currencyExponent("XXX_BAD"), 2);
  assert.equal(toMinor("25", "USD"), 2500);
  assert.equal(toMinor("25.5", "USD"), 2550);
  assert.equal(toMinor(19.99, "USD"), 1999);
  assert.equal(toMinor("1.005", "USD"), 101);
  assert.equal(toMinor("500", "JPY"), 500);
  assert.equal(toMinor("1.2345", "KWD"), 1235);
  assert.throws(() => toMinor("abc", "USD"));
  assert.equal(parsePrice("£1,299.00", "GBP"), 129900);
  assert.equal(parsePrice("1.299,00 €", "EUR"), 129900);
  assert.equal(parsePrice("25,50", "EUR"), 2550);
  assert.equal(parsePrice("1,299", "USD"), 129900);
  assert.equal(parsePrice(" $45 ", "USD"), 4500);
  assert.equal(parsePrice(19.99, "USD"), 1999);
  assert.equal(parsePrice("Call us", "USD"), null);
  assert.equal(parsePrice(null, "USD"), null);
  assert.equal(rescaleMinor("115", 0, "USD"), 11500);
  assert.equal(rescaleMinor("4500", 2, "USD"), 4500);
  assert.equal(rescaleMinor(4500, 2, "JPY"), 45);
  assert.equal(fromMinor(2500, "USD"), "25.00");
  assert.equal(fromMinor(5, "USD"), "0.05");
  assert.equal(fromMinor(500, "JPY"), "500");
  assert.equal(fromMinor(-150, "USD"), "-1.50");
  assert.equal(formatMoney({ amount: 4500, currency: "USD" }), "$45.00");
  assert.equal(acpPrice({ amount: 2500, currency: "USD" }), "25.00 USD");
  assert.equal(toX402Price({ amount: 4217, currency: "USD" }), "$42.17");
  assert.throws(() => toX402Price({ amount: 1, currency: "EUR" }));
});

test("slug", () => {
  assert.equal(slugify("Café Crème  Hoodie!"), "cafe-creme-hoodie");
  assert.equal(slugify("!!!"), "");
  assert.deepEqual(normalizeStoreUrl("www.bulk.com/uk"), { domain: "bulk.com/uk", base_url: "https://www.bulk.com/uk", slug: "bulk-com-uk" });
  assert.deepEqual(normalizeStoreUrl("https://Shop.Example.com/"), { domain: "shop.example.com", base_url: "https://shop.example.com", slug: "shop-example-com" });
  assert.deepEqual(normalizeStoreUrl("hester-demo.squarespace.com/shop/p/thing?x=1"), { domain: "hester-demo.squarespace.com", base_url: "https://hester-demo.squarespace.com", slug: "hester-demo-squarespace-com" });
  assert.throws(() => normalizeStoreUrl("http://localhost:8080"));
  assert.throws(() => normalizeStoreUrl("http://10.0.0.1"));
  assert.throws(() => normalizeStoreUrl("ftp://x.com"));
  assert.deepEqual(normalizeStoreUrl("http://localhost:8080", { allowPrivate: true }), { domain: "localhost:8080", base_url: "http://localhost:8080", slug: "localhost-8080" });
  assert.equal(storeSlugFromDomain("www.Shop.co.uk"), "shop-co-uk");
  assert.equal(handleFromUrl("https://x.com/product/classic-hoodie/"), "classic-hoodie");
  assert.equal(handleFromUrl("https://x.com/p/Blue-Shirt.html"), "blue-shirt");
  assert.equal(handleFromUrl("https://x.com/?p=123"), "p-123");
  assert.equal(handleFromUrl("https://x.com/index.php?route=product/product&product_id=42"), "product-id-42");
  assert.match(handleFromUrl("https://x.com/"), /^product-[0-9a-f]{8}$/);
  assert.equal(handleFromUrl("https://x.com/"), handleFromUrl("https://x.com/"));
});

test("contracts", () => {
  for (const s of CHECKOUT_STATES) {
    assert.ok(STATE_TO_STATUS[s]);
    for (const t of ALLOWED_TRANSITIONS[s]) assert.ok(CHECKOUT_STATES.includes(t));
  }
  const ok = CreateCheckoutInputSchema.safeParse({
    line_items: [{ variant_id: "33333333-3333-4333-8333-333333333301", quantity: 1 }],
    buyer: { email: "a@b.co" },
    fulfillment: { address: { name: "A", line1: "1 Main", city: "SF", postal_code: "94107", country: "us" } },
  });
  assert.ok(ok.success, JSON.stringify(ok.error?.issues));
  assert.equal(ok.data!.fulfillment!.address.country, "US");
  assert.equal(CreateCheckoutInputSchema.safeParse({ line_items: [] }).success, false);
  assert.ok(CompleteCheckoutInputSchema.safeParse({
    payment: { instruments: [{ handler_id: "app.shoperzero.stripe_spt", type: "card", credential: { type: "spt", token: "spt_123" } }] },
  }).success);
  assert.equal(CompleteCheckoutInputSchema.safeParse({
    payment: { instruments: [{ handler_id: "app.shoperzero.x402", type: "x402", credential: { type: "x402_receipt", tx_hash: "0x12" } }] },
  }).success, false);
  assert.ok(SearchCatalogInputSchema.safeParse({ catalog: { query: "hoodie", filters: { price: { max: 5000 } } }, meta: { "ucp-agent": { profile: "https://a/p.json" }, extra: 1 } }).success);
  assert.ok(SearchCatalogInputSchema.safeParse({ catalog: {} }).success);
  const np = NormalizedProductSchema.safeParse({
    external_id: null, url: "https://x.com/p/a", handle: "a", title: "A", description_html: null, description_text: null,
    brand: null, product_type: null, category: null, tags: [], images: [{ url: "https://x.com/a.jpg" }], options: [],
    variants: [{ external_id: null, title: "Default Title", options: {}, sku: null, gtin: null, image_url: null, inventory_quantity: null,
      offer: { price: { amount: 100, currency: "USD" }, compare_at: null, availability: "in_stock", url: null, checked_at: new Date().toISOString() } }],
    source: "jsonld",
  });
  assert.ok(np.success, JSON.stringify(np.error?.issues));
  // every MCP input schema converts to JSON Schema (what tools/list will expose)
  for (const [name, schema] of Object.entries(MCP_TOOL_INPUTS)) {
    const js = z.toJSONSchema(schema, { io: "input" }) as { type?: string };
    assert.equal(js.type, "object", name);
  }
});
