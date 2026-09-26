// One place to ask "is this variant in stock, and how many?".
//
// after-mode keeps live stock in orders.mjs's persistent store, so a sold-out item stays
// sold out across restarts. The serializers (products.json, the ACP feed, JSON-LD, UCP)
// must report that live number, not catalog.mjs's static one, or the agent surface would
// advertise stock the checkout then refuses.
//
// server.mjs calls setStockSource() once the persistent store is open; until then, and in
// before-mode, this falls back to the catalogue.

import { inStock as catalogInStock } from './catalog.mjs';

let source = null;

/** @param {{ stock: (sku: string) => number } | null} persistent */
export function setStockSource(persistent) {
  source = persistent;
}

export function stockOf(variant) {
  return source ? source.stock(variant.sku) : variant.stock;
}

export function inStock(variant) {
  return source ? source.stock(variant.sku) > 0 : catalogInStock(variant);
}
