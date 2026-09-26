import type { Availability, IndexedProduct, Store } from "@/components/lib/contracts";
import { MOCK_STORES, RECORDED_AT } from "./stores";

type Seed = { title: string; price: number; brand?: string; type?: string; sizes?: string[]; soldOut?: boolean; currency?: string };

const SEEDS: Record<string, Seed[]> = {
  "shoperzero-demo": [
    { title: "Hoodie", price: 4200, type: "Hoodies", sizes: ["S", "M", "L"] },
    { title: "Hoodie with Logo", price: 4500, type: "Hoodies", sizes: ["S", "M", "L"] },
    { title: "Beanie", price: 1800, type: "Accessories" },
    { title: "Belt", price: 5500, type: "Accessories" },
    { title: "Cap", price: 1600, type: "Accessories" },
    { title: "Long Sleeve Tee", price: 2500, type: "Tshirts", sizes: ["S", "M", "L", "XL"] },
    { title: "Polo", price: 2000, type: "Tshirts", sizes: ["M", "L"], soldOut: true },
    { title: "Sunglasses", price: 9000, type: "Accessories" },
  ],
  "berlinpackaging-com": [
    { title: "16 oz Clear PET Plastic Bottle", price: 89, brand: "Berlin Packaging", type: "Bottles" },
    { title: "4 oz Amber Glass Boston Round", price: 112, brand: "Berlin Packaging", type: "Bottles" },
    { title: "8 oz Straight Sided Glass Jar", price: 145, brand: "Berlin Packaging", type: "Jars" },
    { title: "28-400 Black Ribbed Cap", price: 18, brand: "Berlin Packaging", type: "Closures" },
    { title: "1 Gallon HDPE Jug", price: 262, brand: "Berlin Packaging", type: "Jugs" },
    { title: "2 oz Tin with Screw Lid", price: 97, brand: "Berlin Packaging", type: "Tins" },
    { title: "Trigger Sprayer 28-400", price: 64, brand: "Berlin Packaging", type: "Dispensers" },
    { title: "32 oz Wide Mouth Mason Jar", price: 199, brand: "Berlin Packaging", type: "Jars", soldOut: true },
  ],
  "hester-demo-squarespace-com": [
    { title: "Linen Throw", price: 12800, brand: "Hester", type: "Home" },
    { title: "Stoneware Mug", price: 3400, brand: "Hester", type: "Kitchen" },
    { title: "Walnut Board", price: 8800, brand: "Hester", type: "Kitchen" },
    { title: "Wool Blanket", price: 21000, brand: "Hester", type: "Home" },
    { title: "Candle No. 3", price: 4200, brand: "Hester", type: "Home" },
    { title: "Ceramic Vase", price: 6600, brand: "Hester", type: "Home" },
    { title: "Tea Towel Set", price: 2800, brand: "Hester", type: "Kitchen" },
    { title: "Oak Stool", price: 36000, brand: "Hester", type: "Furniture", soldOut: true },
  ],
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const uuid = (a: number, b: number) =>
  `7c0ffee0-${String(a).padStart(4, "0")}-4000-8000-${String(b).padStart(12, "0")}`;

function product(store: Store, seed: Seed, i: number, storeIdx: number): IndexedProduct {
  const currency = seed.currency ?? "USD";
  const url = `${store.base_url}/product/${slugify(seed.title)}`;
  const availability: Availability = seed.soldOut ? "out_of_stock" : "in_stock";
  const productId = uuid(storeIdx, i * 100);
  const sizes = seed.sizes ?? ["Default Title"];
  const variants = sizes.map((size, v) => ({
    id: uuid(storeIdx, i * 100 + v + 1),
    seq: storeIdx * 1000 + i * 10 + v + 1,
    product_id: productId,
    external_id: `${storeIdx}${i}${v}`,
    position: v + 1,
    title: size,
    options: (seed.sizes ? { Size: size } : {}) as Record<string, string>,
    sku: null,
    gtin: null,
    image_url: null,
    inventory_quantity: null,
    offer: { price: { amount: seed.price, currency }, compare_at: null, availability, url, checked_at: RECORDED_AT },
  }));
  return {
    id: productId,
    seq: storeIdx * 100 + i + 1,
    store: { id: store.id, slug: store.slug, name: store.name, domain: store.domain, platform: store.platform },
    external_id: String(100 + i),
    url,
    handle: slugify(seed.title),
    title: seed.title,
    description_html: null,
    description_text: null,
    brand: seed.brand ?? store.name,
    product_type: seed.type ?? null,
    category: seed.type ?? null,
    tags: [],
    images: [],
    options: seed.sizes ? [{ name: "Size", values: seed.sizes }] : [],
    source: store.strategy?.tier ?? "jsonld",
    price_range: { min: { amount: seed.price, currency }, max: { amount: seed.price, currency } },
    available: !seed.soldOut,
    variants,
    checkout_methods: store.checkout_connector === "woo_store_api" ? ["woo_store_api", "handoff"] : ["handoff"],
    updated_at: RECORDED_AT,
  };
}

export function mockProducts(slug: string): IndexedProduct[] {
  const idx = MOCK_STORES.findIndex((s) => s.slug === slug);
  const store = MOCK_STORES[idx];
  const seeds = SEEDS[slug];
  if (!store || !seeds) return [];
  return seeds.map((seed, i) => product(store, seed, i, idx + 1));
}
