// src/lib/mcp/tools/catalog-descriptions.ts  (WS3): tool descriptions, verbatim from spec 03 §4.
const PRICES =
  'Prices are integers in the currency\'s ISO 4217 minor units, paired with a currency code: {"amount": 2500, "currency": "USD"} is $25.00. Convert to major units before quoting a price (divide by 100 for USD, EUR and GBP; JPY is already in whole units).';

export const DESCRIPTIONS = {
  search_catalog: `Search products across every store indexed by ShoperZero: WooCommerce, Magento, BigCommerce, Squarespace, Salesforce Commerce Cloud and custom stores that are not on Shopify. Use this for any shopping or product-discovery request.
The query takes keywords only (e.g. "black hoodie"). Put price limits in filters.price (minor units: $50 = 5000), not in the query. With no query and no filters, it browses recently updated products. Set catalog.store to a store slug or domain (from list_stores) to search a single store.
Results are paginated. Pass pagination.cursor from the previous response to get more.
Each product includes up to 10 variants (call get_product for all), the merchant's product URL, and its store in _shoperzero.store.
Index data can be hours old. Call get_product with verify: true before quoting a final price.
Response conforms to the UCP catalog search capability (dev.ucp.shopping.catalog.search).
${PRICES}`,

  lookup_catalog: `Look up several products or variants by identifier in one call (maximum 10 ids).
Accepts product ids and variant ids returned by search_catalog or get_product, or "{store_slug}:{product_seq}" ids from a store's products.json.
A variant id returns its parent product containing only the matched variant(s), each tagged inputs: [{id, match: "exact"}]. A product id returns the product with its featured variant tagged match: "featured". Results are grouped by product. Ids that match nothing are listed in not_found.
${PRICES}`,

  get_product: `Get complete detail for one product: full description, every option and variant with price, list price, availability, SKU/GTIN and image, the merchant URL, and which checkout methods the store supports.
Accepts a product id or variant id from search_catalog or lookup_catalog, or a "{store_slug}:{product_seq}" id. A variant id selects that variant.
Set verify: true to re-check the live price and stock on the merchant's site before quoting a price or starting checkout. It is slower (up to about 8 s) and falls back to indexed data with a warning if the store cannot be reached.
${PRICES}`,

  list_stores: `List the stores ShoperZero has indexed, with platform, product count, currency, crawl status, readiness grades (grade_before = the store on its own, grade_after = through ShoperZero), and checkout method (checkout_connector "woo_store_api" = headless agent checkout; "handoff" = the buyer finishes on the merchant's site). Each store has links to its products.json, llms.txt, product feed and UCP profile in urls.
Use it to see which stores exist, to pick a store slug for search_catalog, or to answer "which stores can you buy from?". If the store the buyer wants is missing, use scan_store / index_store.
${PRICES}`,
} as const;
