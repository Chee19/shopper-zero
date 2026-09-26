// llms.txt, following spec 03 §6.5's per-store template.
//
// Deviation (design §9.2): §6.5's template is written for ShoperZero hosting the index on
// a store's behalf, so it says "maintained by ShoperZero" and links {base}/s/{slug}/... .
// Here the merchant hosts its own surface. Headings and their order are kept verbatim;
// URLs point at this store's origin; the "maintained by", "Store page" and "All ShoperZero
// stores" lines are dropped.

import { BRAND, SHIPPING, PRODUCTS } from '../catalog.mjs';
import { inStock } from '../stock.mjs';
import { ORIGIN } from '../config.mjs';
import { toMinor, formatMoney } from './money.mjs';

const priceLine = p => {
  const prices = p.variants.map(v => v.price);
  const min = formatMoney(toMinor(Math.min(...prices)));
  const max = formatMoney(toMinor(Math.max(...prices)));
  const range = min === max ? min : `${min}–${max}`;
  return `${range} · ${p.variants.some(inStock) ? 'in stock' : 'out of stock'}`;
};

export function llmsTxt() {
  const first = PRODUCTS[0];
  return `# ${BRAND.name}

> Agent-readable index of ${ORIGIN}, a Salesforce Commerce Cloud store. ${PRODUCTS.length} products, prices in ${BRAND.currency}.

Source store: ${ORIGIN}
Index status: indexed
Checkout: Guest checkout is open to agents at ${ORIGIN}/en-us/checkout. No account is required and no bot wall is applied.

## For AI agents

- MCP endpoint (Streamable HTTP, no auth): \`${ORIGIN}/api/mcp\`. Tools: \`search_catalog\`, \`lookup_catalog\`, \`get_product\`.
- UCP profile: \`GET ${ORIGIN}/.well-known/ucp\`
- Product sitemap: \`GET ${ORIGIN}/sitemap_index.xml\`

### Typical agent flow

1. \`search_catalog\` to find a product.
2. \`get_product\` to confirm the live price and stock.
3. Add to bag: \`POST ${ORIGIN}/on/demandware.store/${BRAND.siteId}/${BRAND.locale}/Cart-AddProduct\` with \`pid\` and \`quantity\`.
4. Finish at \`${ORIGIN}/en-us/checkout\` only after the buyer explicitly approves the total.

Prices are integers in ISO 4217 minor units: {"amount": 2500, "currency": "USD"} is $25.00.

## Catalog data

- [products.json](${ORIGIN}/products.json): Shopify-compatible product list (\`?limit=\` up to 250, \`?page=\`)
- [Product JSON](${ORIGIN}/products/${first.id}.json): one product in Shopify's shape; replace the handle
- [ACP product feed](${ORIGIN}/feed.acp.jsonl): one JSON line per variant (OpenAI/ACP feed format)

## Products

${PRODUCTS.map(p => `- [${p.name}](${ORIGIN}/products/${p.id}.json): ${priceLine(p)}`).join('\n')}

## Optional

- [Merchant site](${ORIGIN}/en-us/)
- Shipping: free standard over $${SHIPPING.freeThreshold}, otherwise ${formatMoney(toMinor(SHIPPING.standard))} (${SHIPPING.standardDays}); express ${formatMoney(toMinor(SHIPPING.express))} (${SHIPPING.expressDays})
- Returns: free within ${SHIPPING.returnDays} days of delivery
`;
}
