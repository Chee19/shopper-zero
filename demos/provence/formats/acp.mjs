// ACP / OpenAI product feed, per spec 03 §6.3.
//
// One JSON object per line, one line per VARIANT, \n-terminated, UTF-8.
// The hard rule: never emit null, "" or "null" — omit the key entirely.
//
// group_id / listing_has_variations / variant_dict, and the " - {size}" title suffix, are
// conditional on the product having more than one variant. Four of the ten products here
// have exactly one (design §3.3), so those keys are genuinely absent on 4 of the 18 lines.

import { BRAND, CATEGORIES, PRODUCTS, productPath } from '../catalog.mjs';
import { inStock } from '../stock.mjs';
import { ORIGIN, productImages } from '../config.mjs';
import { plainDescription, truncate } from './text.mjs';
import { toMinor, acpPrice } from './money.mjs';

export const ACP_VERSION = '2026-04-17';

const categoryName = p => CATEGORIES.find(c => c.id === p.category)?.name ?? p.category;

/** Drop keys whose value is unknown, rather than emitting a null or empty string. */
const compact = o => Object.fromEntries(
  Object.entries(o).filter(([, v]) =>
    v !== undefined && v !== null && v !== '' && v !== 'null' &&
    !(Array.isArray(v) && v.length === 0)));

function acpRow(p, v) {
  const multi = p.variants.length > 1;
  const images = productImages(p);
  return compact({
    item_id: v.sku,
    title: truncate(multi ? `${p.name} - ${v.size}` : p.name, 150),
    description: truncate(plainDescription(p) || p.name, 5000),
    url: `${ORIGIN}${productPath(p)}?pid=${v.sku}`,
    brand: BRAND.name,
    seller_name: BRAND.name,
    image_url: images[0]?.url,
    price: acpPrice(toMinor(v.price)),
    availability: inStock(v) ? 'in_stock' : 'out_of_stock',
    group_id: multi ? p.master : undefined,
    listing_has_variations: multi ? true : undefined,
    variant_dict: multi ? { Size: v.size } : undefined,
    product_category: categoryName(p),
    additional_image_urls: images.slice(1, 10).map(x => x.url),
    size: v.size,
    seller_url: ORIGIN,
    is_eligible_search: true,
    is_eligible_checkout: false,
  });
}

/** The whole feed body. Rows missing a url or an image are skipped, per §6.3. */
export function acpFeed() {
  const lines = [];
  let skipped = 0;
  for (const p of PRODUCTS) {
    for (const v of p.variants) {
      const row = acpRow(p, v);
      if (!row.url || !row.image_url) { skipped++; continue; }
      lines.push(JSON.stringify(row));
    }
  }
  if (skipped) console.warn(`acp feed: skipped ${skipped} row(s) missing url or image`);
  return lines.join('\n') + '\n';
}
