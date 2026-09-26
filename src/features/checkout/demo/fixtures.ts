export const DEMO_VARIANT_ID = "10000000-0000-4000-8000-000000000001";
export const SOLD_OUT_VARIANT_ID = "10000000-0000-4000-8000-000000000002";
export const HANDOFF_VARIANT_ID = "10000000-0000-4000-8000-000000000003";
export const DEMO_STORE_ID = "20000000-0000-4000-8000-000000000001";
export const DEMO_PRODUCT_ID = "30000000-0000-4000-8000-000000000001";
export const SHIPPING_ID = "0:flat_rate:1";
export const DEMO_BUYER = { name: "Demo Shopper", email: "shopper@example.test" };
export const DEMO_ADDRESS = {
  name: "Demo Shopper", line1: "123 Demo Street", city: "San Francisco",
  region: "CA", postal_code: "94107", country: "US",
};
export const SCENARIOS = ["success", "declined", "requires_action", "out_of_stock", "price_changed", "order_failed", "capture_failed", "handoff"] as const;
export type Scenario = (typeof SCENARIOS)[number];
export interface ProductFixture {
  id: string; product_id: string; external_id: string; store_id: string;
  title: string; variant_title: string; price: number; stock: number;
  domain: string; url: string; allowlisted: boolean; image_url?: string;
}
export const PRODUCT_FIXTURES: ProductFixture[] = [
  { id: DEMO_VARIANT_ID, product_id: DEMO_PRODUCT_ID, external_id: "101", store_id: DEMO_STORE_ID,
    title: "Everyday Hoodie", variant_title: "Medium / Ink", price: 4400, stock: 100,
    domain: "woo.demo.invalid", url: "https://woo.demo.invalid/product/everyday-hoodie", allowlisted: true },
  { id: SOLD_OUT_VARIANT_ID, product_id: DEMO_PRODUCT_ID, external_id: "102", store_id: DEMO_STORE_ID,
    title: "Everyday Hoodie", variant_title: "Large / Ink (sold out)", price: 4400, stock: 0,
    domain: "woo.demo.invalid", url: "https://woo.demo.invalid/product/everyday-hoodie", allowlisted: true },
  { id: HANDOFF_VARIANT_ID, product_id: "30000000-0000-4000-8000-000000000002", external_id: "201",
    store_id: "20000000-0000-4000-8000-000000000002", title: "Partner Hoodie", variant_title: "Medium",
    price: 4400, stock: 100, domain: "merchant.example", url: "https://merchant.example/products/hoodie", allowlisted: false },
];
