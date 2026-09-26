// src/lib/formats/shopify.ts  (WS3; pure)
// Shopify-compatible products.json / products/{handle}.json. Key order mirrors Shopify's live output
// (spec 03 §6.1–6.2); ShoperZero extras live under `_shoperzero`, always last.
import type { IndexedProduct, IndexedVariant, Store } from "@/lib/contracts";
import { PRODUCTS_JSON_DEFAULT_LIMIT, PRODUCTS_JSON_MAX_LIMIT } from "@/lib/contracts";
import { fromMinor } from "@/lib/money";
import { escapeHtml, isAvailable } from "./text";

type StoreLike = Pick<Store, "name" | "domain" | "slug" | "platform">;

export const SHOPIFY_NOT_FOUND = { errors: "Not Found" } as const;
export const SHOPIFY_PAGE_LIMIT_ERROR = "Page * Limit exceeds the 25000 limit.";

/** Shopify's exact paging semantics (VERIFIED against a live store). */
export function parseShopifyPaging(sp: URLSearchParams) {
  const l = Number.parseInt(sp.get("limit") ?? "", 10);
  const limit = Number.isFinite(l) && l >= 1 ? Math.min(l, PRODUCTS_JSON_MAX_LIMIT) : PRODUCTS_JSON_DEFAULT_LIMIT;
  const p = Number.parseInt(sp.get("page") ?? "", 10);
  const page = Number.isFinite(p) && p >= 1 ? p : 1;
  if (page * limit > 25000) return { error: SHOPIFY_PAGE_LIMIT_ERROR } as const;
  return { limit, page } as const;
}

const sortedVariants = (p: IndexedProduct) =>
  p.variants.map((v, i) => ({ v, position: v.position ?? i + 1 })).sort((a, b) => a.position - b.position);

/** products.json emits at most three options (Shopify's option1..option3). */
const shopifyOptionNames = (p: IndexedProduct) => p.options.slice(0, 3).map((o) => o.name);

function variantOptions(p: IndexedProduct, v: IndexedVariant): [string | null, string | null, string | null] {
  const names = shopifyOptionNames(p);
  if (names.length === 0) return ["Default Title", null, null];
  return [0, 1, 2].map((i) => (names[i] !== undefined ? (v.options[names[i]] ?? null) : null)) as [
    string | null,
    string | null,
    string | null,
  ];
}

const shopifyOptions = (p: IndexedProduct) =>
  p.options.length
    ? p.options.slice(0, 3).map((o, i) => ({ name: o.name, position: i + 1, values: o.values }))
    : [{ name: "Title", position: 1, values: ["Default Title"] }];

const bodyHtml = (p: IndexedProduct) =>
  p.description_html ?? (p.description_text ? `<p>${escapeHtml(p.description_text)}</p>` : "");

const imageId = (p: IndexedProduct, index: number) => p.seq * 1000 + (index + 1);

const variantIdsFor = (p: IndexedProduct, url: string) => p.variants.filter((v) => v.image_url === url).map((v) => v.seq);

function compareAt(v: IndexedVariant): string | null {
  const c = v.offer.compare_at;
  return c && c.amount > v.offer.price.amount ? fromMinor(c.amount, c.currency) : null;
}

const firstGtin = (p: IndexedProduct) => p.variants.find((v) => v.gtin)?.gtin ?? null;

function productExtras(p: IndexedProduct, store: StoreLike, base: string) {
  return {
    uuid: p.id,
    store_domain: store.domain,
    store_slug: store.slug,
    platform: store.platform,
    source_url: p.url,
    currency: p.price_range.min.currency,
    brand: p.brand,
    gtin: firstGtin(p),
    available: p.available,
    source: p.source,
    checkout_methods: p.checkout_methods,
    api_url: `${base}/api/v1/products/${p.id}`,
  };
}

// ---------------- list shape (/products.json) ----------------

function listImage(p: IndexedProduct, index: number, url: string) {
  return {
    id: imageId(p, index),
    created_at: p.updated_at,
    position: index + 1,
    updated_at: p.updated_at,
    product_id: p.seq,
    variant_ids: variantIdsFor(p, url),
    src: url,
    width: null,
    height: null,
  };
}

function featuredImage(p: IndexedProduct, v: IndexedVariant) {
  if (!v.image_url) return null;
  const idx = p.images.findIndex((img) => img.url === v.image_url);
  if (idx >= 0) return listImage(p, idx, v.image_url);
  // Variant image not in the product gallery: synthesize the next position.
  return { ...listImage(p, p.images.length, v.image_url), variant_ids: [v.seq] };
}

export function toShopifyListProduct(p: IndexedProduct, store: StoreLike, base: string) {
  return {
    id: p.seq,
    title: p.title,
    handle: p.handle,
    body_html: bodyHtml(p),
    published_at: p.updated_at,
    created_at: p.updated_at,
    updated_at: p.updated_at,
    vendor: p.brand ?? store.name ?? store.domain,
    product_type: p.product_type ?? "",
    tags: p.tags,
    variants: sortedVariants(p).map(({ v, position }) => {
      const [option1, option2, option3] = variantOptions(p, v);
      return {
        id: v.seq,
        title: v.title,
        option1,
        option2,
        option3,
        sku: v.sku,
        requires_shipping: true,
        taxable: true,
        featured_image: featuredImage(p, v),
        available: isAvailable(v),
        price: fromMinor(v.offer.price.amount, v.offer.price.currency),
        grams: null,
        compare_at_price: compareAt(v),
        position,
        product_id: p.seq,
        created_at: p.updated_at,
        updated_at: v.offer.checked_at,
        _shoperzero: {
          uuid: v.id,
          currency: v.offer.price.currency,
          gtin: v.gtin,
          url: v.offer.url ?? p.url,
          inventory_quantity: v.inventory_quantity,
        },
      };
    }),
    images: p.images.map((img, i) => listImage(p, i, img.url)),
    options: shopifyOptions(p),
    _shoperzero: productExtras(p, store, base),
  };
}

// ---------------- detail shape (/products/{handle}.json) ----------------

function detailImage(p: IndexedProduct, index: number, img: { url: string; alt?: string }) {
  return {
    id: imageId(p, index),
    product_id: p.seq,
    position: index + 1,
    created_at: p.updated_at,
    updated_at: p.updated_at,
    alt: img.alt ?? null,
    width: null,
    height: null,
    src: img.url,
    variant_ids: variantIdsFor(p, img.url),
  };
}

export function toShopifyDetailProduct(p: IndexedProduct, store: StoreLike, base: string) {
  const images = p.images.map((img, i) => detailImage(p, i, img));
  return {
    id: p.seq,
    title: p.title,
    body_html: bodyHtml(p),
    vendor: p.brand ?? store.name ?? store.domain,
    product_type: p.product_type ?? "",
    created_at: p.updated_at,
    handle: p.handle,
    updated_at: p.updated_at,
    published_at: p.updated_at,
    template_suffix: null,
    published_scope: "global",
    tags: p.tags.join(", "),
    variants: sortedVariants(p).map(({ v, position }) => {
      const [option1, option2, option3] = variantOptions(p, v);
      const currency = v.offer.price.currency;
      const cmp = compareAt(v);
      const imgIdx = v.image_url ? p.images.findIndex((img) => img.url === v.image_url) : -1;
      return {
        id: v.seq,
        product_id: p.seq,
        title: v.title,
        price: fromMinor(v.offer.price.amount, currency),
        sku: v.sku,
        position,
        inventory_policy: "deny",
        compare_at_price: cmp,
        fulfillment_service: "manual",
        inventory_management: null,
        option1,
        option2,
        option3,
        created_at: p.updated_at,
        updated_at: v.offer.checked_at,
        taxable: true,
        barcode: v.gtin ?? null,
        grams: null,
        image_id: imgIdx >= 0 ? imageId(p, imgIdx) : null,
        weight: null,
        weight_unit: "kg",
        inventory_quantity: v.inventory_quantity ?? 0,
        old_inventory_quantity: v.inventory_quantity ?? 0,
        tax_code: null,
        requires_shipping: true,
        quantity_rule: { min: 1, max: null, increment: 1 },
        price_currency: currency,
        compare_at_price_currency: cmp ? (v.offer.compare_at?.currency ?? currency) : "",
        quantity_price_breaks: [],
        _shoperzero: { uuid: v.id, available: isAvailable(v), url: v.offer.url ?? p.url },
      };
    }),
    options: shopifyOptions(p),
    images,
    image: images[0] ?? null,
    _shoperzero: productExtras(p, store, base),
  };
}
