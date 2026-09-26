// The Demandware / SFRA controller surface.
//
// Product-Variation is load-bearing. Spec 02 §6.3's `sfcc_product_variation` probe signal
// needs `price.sales` and `available`; §5.5.4's adapter needs `product.productName` or it
// counts a miss, and 3 misses out of the first 5 throw AdapterError('unavailable'). The
// old response ({pid, price:{value,...}, available}) satisfied neither, so before-mode
// could not be scanned or indexed at all. This shape is what pins it to 41 → D.

import { BRAND, CATEGORIES, productById, variantBySku } from './catalog.mjs';
import { inStock, stockOf } from './stock.mjs';
import { ORIGIN, productImages } from './config.mjs';
import { money } from './formats/money.mjs';

/**
 * Spec 02 §5.5.4 takes the pid as the last path segment before `.html`, which for
 * /en-us/{slug}/{master}.html is the master id. We also accept the legacy
 * `{slug}-{master}` form so older links and public/*.js keep working, and a bare SKU.
 */
export function resolvePid(pid) {
  if (!pid) return null;
  if (variantBySku[pid]) return variantBySku[pid];
  const legacy = pid.match(/^([a-z0-9-]+?)-([0-9A-Z]+)$/);
  const slug = legacy?.[1];
  if (slug && productById[slug]) {
    const p = productById[slug];
    return { product: p, variant: p.variants.find(inStock) ?? p.variants[0] };
  }
  return null;
}

/** SFRA's Product-Variation payload, per spec 02 §5.5.4's mapping table. */
export function productVariation(hit) {
  const { product: p, variant: v } = hit;
  const images = productImages(p);
  return {
    product: {
      id: v.sku,
      masterId: p.master,
      productName: p.name,
      shortDescription: p.summary,
      longDescription: p.description,
      brand: BRAND.name,
      images: {
        large: images.map(i => ({ url: i.url, alt: i.alt })),
        small: images.map(i => ({ url: i.url, alt: i.alt })),
      },
      variationAttributes: [{
        id: 'size',
        displayName: 'Size',
        values: p.variants.map(x => ({
          value: x.sku,
          displayValue: x.size,
          selected: x.sku === v.sku,
          orderable: inStock(x),
        })),
      }],
      price: {
        sales: { value: v.price, currency: BRAND.currency, formatted: money(v.price) },
        list: null,
      },
      available: inStock(v),
      readyToOrder: true,
      // WS4's connector tracks live stock; the probe reads availability, but the demo UI
      // and the checkout both want the number.
      stock: stockOf(v),
    },
  };
}

export const categoryOf = p => CATEGORIES.find(c => c.id === p.category);
export const storeOrigin = ORIGIN;
