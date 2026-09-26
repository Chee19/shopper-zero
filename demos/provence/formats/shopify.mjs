// Shopify-compatible products.json, per spec 03 §6.1 (list) and §6.2 (single).
//
// Key order is part of the contract, so every object literal below is written in the
// documented order and must stay that way — __tests__/conformance.test.mjs asserts it
// with a deep-equal on Object.keys().
//
// Deviation (design §9.1): the `_shoperzero` namespaced block is omitted. It carries our
// index's UUIDs and an api_url into the ShoperZero app; a merchant self-hosting its own
// agent surface should not emit those. No probe signal or readiness check reads it.

import { BRAND, CATEGORIES, PRODUCTS, productPath } from '../catalog.mjs';
import { inStock } from '../stock.mjs';
import { ORIGIN, STORE_EPOCH, productSeq, variantSeq, imageId, productImages, productTags } from '../config.mjs';
import { escapeHtml } from './text.mjs';
import { toMinor, fromMinor } from './money.mjs';

const categoryName = p => CATEGORIES.find(c => c.id === p.category)?.name ?? p.category;

/** Spec 03 §6.1, verbatim. Shopify's own semantics (VERIFIED there). */
export function parseShopifyPaging(sp) {
  const l = Number.parseInt(sp.get('limit') ?? '', 10);
  const limit = Number.isFinite(l) && l >= 1 ? Math.min(l, 250) : 30;
  const p = Number.parseInt(sp.get('page') ?? '', 10);
  const page = Number.isFinite(p) && p >= 1 ? p : 1;
  if (page * limit > 25000) return { error: 'Page * Limit exceeds the 25000 limit.' };
  return { limit, page };
}

const bodyHtml = p => `<p>${escapeHtml(p.description)}</p>`;

/** images[i] and featured_image in the LIST shape. Key order per §6.1's worked example. */
function listImage(p, img, i) {
  return {
    id: imageId(p, i),
    created_at: STORE_EPOCH,
    position: i + 1,
    updated_at: STORE_EPOCH,
    product_id: productSeq(p),
    variant_ids: [],
    src: img.url,
    width: null,
    height: null,
  };
}

function listVariant(p, v, i) {
  return {
    id: variantSeq(p, i),
    title: v.size,
    option1: v.size,
    option2: null,
    option3: null,
    sku: v.sku,
    requires_shipping: true,
    taxable: true,
    featured_image: null,
    available: inStock(v),
    price: fromMinor(toMinor(v.price)),
    grams: null,
    compare_at_price: null,
    position: i + 1,
    product_id: productSeq(p),
    created_at: STORE_EPOCH,
    updated_at: STORE_EPOCH,
  };
}

export function toShopifyListProduct(p) {
  return {
    id: productSeq(p),
    title: p.name,
    handle: p.id,
    body_html: bodyHtml(p),
    published_at: STORE_EPOCH,
    created_at: STORE_EPOCH,
    updated_at: STORE_EPOCH,
    vendor: BRAND.name,
    product_type: categoryName(p),
    tags: productTags(p),
    variants: p.variants.map((v, i) => listVariant(p, v, i)),
    images: productImages(p).map((img, i) => listImage(p, img, i)),
    // Every product has a real size, including the four single-variant ones, so Shopify's
    // [{ name: "Title", values: ["Default Title"] }] fallback is never emitted (design §6.2).
    options: [{ name: 'Size', position: 1, values: p.variants.map(v => v.size) }],
  };
}

/** images[i] in the DETAIL shape: different key order, and it carries `alt` (§6.2). */
function detailImage(p, img, i) {
  return {
    id: imageId(p, i),
    product_id: productSeq(p),
    position: i + 1,
    created_at: STORE_EPOCH,
    updated_at: STORE_EPOCH,
    alt: img.alt ?? null,
    width: null,
    height: null,
    src: img.url,
    variant_ids: [],
  };
}

function detailVariant(p, v, i) {
  return {
    id: variantSeq(p, i),
    product_id: productSeq(p),
    title: v.size,
    price: fromMinor(toMinor(v.price)),
    sku: v.sku,
    position: i + 1,
    inventory_policy: 'deny',
    compare_at_price: null,
    fulfillment_service: 'manual',
    inventory_management: null,
    option1: v.size,
    option2: null,
    option3: null,
    created_at: STORE_EPOCH,
    updated_at: STORE_EPOCH,
    taxable: true,
    barcode: null,
    grams: null,
    image_id: null,
    weight: null,
    weight_unit: 'kg',
    inventory_quantity: v.stock,
    old_inventory_quantity: v.stock,
    tax_code: null,
    requires_shipping: true,
    quantity_rule: { min: 1, max: null, increment: 1 },
    price_currency: BRAND.currency,
    compare_at_price_currency: '',
    quantity_price_breaks: [],
  };
}

export function toShopifyDetailProduct(p) {
  const images = productImages(p).map((img, i) => detailImage(p, img, i));
  return {
    id: productSeq(p),
    title: p.name,
    body_html: bodyHtml(p),
    vendor: BRAND.name,
    product_type: categoryName(p),
    created_at: STORE_EPOCH,
    handle: p.id,
    updated_at: STORE_EPOCH,
    published_at: STORE_EPOCH,
    template_suffix: null,
    published_scope: 'global',
    tags: productTags(p).join(', '),
    variants: p.variants.map((v, i) => detailVariant(p, v, i)),
    options: [{ name: 'Size', position: 1, values: p.variants.map(v => v.size) }],
    images,
    image: images[0] ?? null,
  };
}

/** Body of GET /products.json. Returns { error } when paging is out of range. */
export function productsJson(searchParams) {
  const paging = parseShopifyPaging(searchParams);
  if (paging.error) return paging;
  const start = (paging.page - 1) * paging.limit;
  return { products: PRODUCTS.slice(start, start + paging.limit).map(toShopifyListProduct) };
}

export const productUrl = p => ORIGIN + productPath(p);
