// UCP profile (spec 03 §6.6) and UCP product shape (§6.4).
//
// The profile is what lifts this store from the `api_platform` band (20) to
// `api_standard` (45) in spec 02 §6.8's score: it is a *discoverable* machine interface,
// where the Demandware controllers are a private one an agent has to already know about.

import { BRAND, CATEGORIES, productPath } from '../catalog.mjs';
import { inStock } from '../stock.mjs';
import { ORIGIN, STORE_EPOCH, productSeq, variantSeq, productImages, productTags } from '../config.mjs';
import { plainDescription, truncate } from './text.mjs';
import { toMinor } from './money.mjs';

export const UCP_VERSION = '2026-08-25';

const spec = (v, p) => `https://ucp.dev/${v}/${p}`;
const cap = (v, path, schema, extra = {}) =>
  [{ version: v, spec: spec(v, path), schema: spec(v, `schemas/shopping/${schema}`), ...extra }];

/**
 * Spec 03 §6.6. Top-level `ucp` only — no sibling keys; Shopify's live profile has none
 * and strict validators rejecting extras is UNVERIFIED.
 */
export function buildUcpProfile({ base = ORIGIN, version = UCP_VERSION } = {}) {
  return {
    ucp: {
      version,
      supported_versions: {},
      services: {
        'dev.ucp.shopping': [{
          version,
          spec: spec(version, 'specification/overview/'),
          transport: 'mcp',
          endpoint: `${base}/api/mcp`,
          schema: spec(version, 'services/shopping/mcp.openrpc.json'),
        }],
      },
      capabilities: {
        'dev.ucp.shopping.catalog.search': cap(version, 'specification/shopping/catalog/', 'catalog_search.json'),
        'dev.ucp.shopping.catalog.lookup': cap(version, 'specification/shopping/catalog/', 'catalog_lookup.json'),
        'dev.ucp.shopping.cart': cap(version, 'specification/shopping/cart/', 'cart.json'),
        'dev.ucp.shopping.checkout': cap(version, 'specification/shopping/checkout/', 'checkout.json'),
        'dev.ucp.shopping.fulfillment': cap(version, 'specification/shopping/extensions/fulfillment/', 'fulfillment.json',
          { extends: ['dev.ucp.shopping.checkout'] }),
        'dev.ucp.shopping.order': cap(version, 'specification/shopping/order/', 'order.json'),
      },
      // Design §9.3: this store never takes a payment, so declaring a handler id that no
      // rail implements would be worse than an empty map. §6.6 permits an empty required
      // member, and the `agent_checkout` readiness check only needs `.checkout` declared.
      payment_handlers: {},
    },
  };
}

const categoryName = p => CATEGORIES.find(c => c.id === p.category)?.name ?? p.category;

function toUcpVariant(p, v, i) {
  const out = {
    id: String(variantSeq(p, i)),
    sku: v.sku,
    title: v.size,
    price: toMinor(v.price),
    availability: { available: inStock(v) },
    options: [{ name: 'Size', label: v.size }],
    media: [],
    url: `${ORIGIN}${productPath(p)}?pid=${v.sku}`,
    checkout_url: `${ORIGIN}${productPath(p)}?pid=${v.sku}`,
  };
  return out;
}

/** Spec 03 §6.4, minus the `_shoperzero` block (design §9.1). */
export function toUcpProduct(p, mode = 'summary') {
  const full = mode === 'full';
  const prices = p.variants.map(v => v.price);
  const images = productImages(p);
  const text = plainDescription(p);
  return {
    id: String(productSeq(p)),
    handle: p.id,
    title: p.name,
    description: full ? { plain: truncate(text, 5000) } : { plain: truncate(text, 280) },
    url: `${ORIGIN}${productPath(p)}`,
    categories: [{ value: categoryName(p), taxonomy: 'merchant' }],
    price_range: { min: toMinor(Math.min(...prices)), max: toMinor(Math.max(...prices)) },
    media: (full ? images : images.slice(0, 3)).map(i => ({ type: 'image', url: i.url, alt: i.alt ?? p.name })),
    options: [{ name: 'Size', values: p.variants.map(v => ({ label: v.size })) }],
    variants: (full ? p.variants : p.variants.slice(0, 10)).map((v, i) => toUcpVariant(p, v, i)),
    tags: productTags(p),
    updated_at: STORE_EPOCH,
    brand: BRAND.name,
  };
}
