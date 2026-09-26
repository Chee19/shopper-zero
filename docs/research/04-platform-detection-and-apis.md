# 04: Platform detection and public catalog/cart APIs (non-Shopify)

Researched 2026-09-26. **LIVE-OK** means we ran a read-only GET with curl against a real store today and it returned what's described. **DOCS** means it comes from primary docs or source code and we didn't run it live. **UNVERIFIED** means it's from memory or community sources, so confirm before relying on it. No POSTs were sent to live stores.

---

## TL;DR

- **WooCommerce is the easy win and the biggest target.** It runs about 33% of all stores ([StoreLeads via GravityKit](https://www.gravitykit.com/ecommerce-platform-market-share-2026/)). `GET /wp-json/wc/store/v1/products?per_page=100&page=N` is public, unauthenticated JSON and paginates through `X-WP-Total`/`X-WP-TotalPages` headers. `GET /wp-json/wc/store/v1/cart` hands you a `Cart-Token` header (a JWT), so an agent can add items and run checkout with no browser. **LIVE-OK.**
- **Adobe Commerce / Magento 2**: `GET /graphql?query={products(search:"",pageSize:N,currentPage:P){...}}` is public and enumerates the catalog (LIVE-OK on bulk.com). REST `/rest/V1/products` returns **401** to anonymous callers (LIVE-OK). Guest checkout runs fully over GraphQL mutations. Some stores put a WAF in front of `/graphql` (we got a 403 on lampenwelt.de).
- **Salesforce Commerce Cloud (SFRA)**: `GET /on/demandware.store/Sites-{Site}-Site/{locale}/Product-Variation?pid={pid}` returns clean product JSON with price and availability (LIVE-OK on camelbak.com). For discovery, crawl the sitemap and call that endpoint for each product.
- **BigCommerce**: no public catalog JSON without a storefront token. What does work unauthenticated (LIVE-OK): `/xmlsitemap.php?type=products&page=N`, JSON-LD on every product page, `/rss.php?action=newproducts&type=rss`, and `GET /api/storefront/carts`. You can spot it instantly from the `x-bc-store-id` response header.
- **Squarespace**: append `?format=json` to any shop or product URL. You get full items with variants, SKU, `priceMoney` and `qtyInStock` (LIVE-OK). Pagination uses `?offset=` with `pagination.nextPageOffset`.
- **Wix, Shopware 6, Ecwid, OpenCart and PrestaShop have no reliable unauthenticated catalog JSON.** Use the **universal fallback**: sitemap, then product-page JSON-LD `Product`/`Offer`, then an optional LLM extraction. This is what makes "any store" work.
- **Shopify baseline**: `/products.json?limit=250&page=N` still works (LIVE-OK). Shopify stores now also publish `/.well-known/ucp` (UCP `2026-08-25`) pointing at an MCP endpoint `/api/ucp/mcp` (LIVE-OK). **Our index should emit the same UCP-style manifest for non-Shopify stores.** WooCommerce has no `/.well-known/ucp` by default (404 LIVE-OK).
- **The biggest practical risk is bot protection.** Roughly 30% of the stores we probed returned 403/"Just a moment" (Cloudflare, DataDome, Akamai). For the demo, pick known-good stores (see the list below) and send a browser User-Agent.

---

## Market share (context for prioritizing)

These come from StoreLeads/BuiltWith numbers aggregated in 2026 articles. Methodologies differ, so treat them as directional.

| Platform | Stores / share | Trend | Source |
|---|---|---|---|
| WooCommerce | ~4.53M stores, ~33% | -6.8% YoY | [GravityKit](https://www.gravitykit.com/ecommerce-platform-market-share-2026/), [RedStag](https://redstagfulfillment.com/what-is-woocommerces-market-share/) |
| Shopify | ~2.66M, ~20% (leads top tier and the US at ~30%) | +11.7% | same, plus [MobiLoud US](https://www.mobiloud.com/blog/ecommerce-platform-market-share-usa) |
| Wix Stores | ~1.00M, 7.4% (US ~23%) | +8.4% | same |
| Squarespace Commerce | ~356k, 2.6% (US ~16%) | +2.0% | same |
| Square Online | ~277k, 2.0% | n/a | same |
| Magento/Adobe Commerce | ~7-8% of the "ecommerce CMS" segment, skews mid-market/enterprise | -19% | [Coalition](https://coalitiontechnologies.com/blog/2026-ecommerce-cms-market-share-usage-stats) |
| PrestaShop | EU-heavy (FR/ES/IT/PL) | -16.1% | GravityKit |
| BigCommerce | ~41k, 0.3%, but larger stores | n/a | GravityKit |
| SFCC, Shopware, OpenCart, Ecwid | niche by count. SFCC holds big enterprise GMV, Shopware is DACH | n/a | n/a |

Observation from probing about 80 stores: **many well-known brands have migrated to Shopify** (skullcandy, burrow, speedo, mous, frankgreen, plantura, mymuesli…). By store count, the non-Shopify long tail is overwhelmingly WooCommerce, Wix and Squarespace.

---

## Master table

| Platform | Share | Detection (strongest signals) | Catalog endpoint (unauthenticated) | Cart / checkout primitive | Auth needed | Confidence |
|---|---|---|---|---|---|---|
| **WooCommerce** | ~33% | `/wp-json/` lists `wc/store/v1` namespace; `wp-content/plugins/woocommerce/` in HTML; `woocommerce-*` body classes; cookies `woocommerce_*`, `wp_woocommerce_session_*` | `GET /wp-json/wc/store/v1/products?per_page=100&page=N` (headers `X-WP-Total`, `X-WP-TotalPages`, `Link`) | `GET /wc/store/v1/cart` gives `Cart-Token`; `POST /cart/add-item`; `POST /checkout` | None (Cart-Token or Nonce for writes) | **High, LIVE-OK** |
| **Magento 2 / Adobe Commerce** | ~7% | `x-magento-init`, `Magento_*` module paths, `/static/version{digits}/frontend/{Vendor}/{theme}/`, `mage/cookies`, cookies `form_key`, `mage-cache-sessid`, `private_content_version`, `PHPSESSID`. Headless EDS variant: `/scripts/aem.js`, `@dropins/storefront-*` | `GET /graphql?query={products(search:"",pageSize:50,currentPage:P){total_count page_info{total_pages} items{...}}}`; `categoryList` | GraphQL `createGuestCart`, `addProductsToCart`, …, `placeOrder`; REST `POST /rest/V1/guest-carts` | None for GraphQL. REST catalog = 401 | **High, LIVE-OK (GQL); DOCS (cart)** |
| **SFCC (SFRA)** | enterprise | `/on/demandware.store/Sites-{X}-Site/`, `/on/demandware.static/`, cookies `dwsid`, `dwanonymous_*`, `dwac_*`, `__cq_*`, `sid` | sitemap (`/sitemap_index.xml`), then `GET …/Product-Variation?pid={pid}&quantity=1` (JSON) | `POST …/Cart-AddProduct` (form `pid`, `quantity`), JSON response; checkout needs `csrf_token` | None (session cookie) | **Med-High, LIVE-OK (catalog)** |
| **BigCommerce** | 0.3% (bigger GMV) | Header **`x-bc-store-id`**, `x-bc-*`; cookies `SHOP_SESSION_TOKEN`, `SF-CSRF-TOKEN`, `fornax_anonymousId`, `athena_short_visit_id`; `cdn11.bigcommerce.com/s-{hash}`; `stencil` | `/xmlsitemap.php?type=products&page=N` + product JSON-LD; `/rss.php?action=newproducts&type=rss` (`isc:price`, `isc:productid`); GraphQL `/graphql` **needs Bearer storefront token** | `GET/POST /api/storefront/carts` (cookie session); link `/cart.php?action=add&product_id={id}&qty=1`; hosted `/checkout` | None for cart (same-origin session); GraphQL needs token | **Med-High, LIVE-OK (sitemap, RSS, cart GET)** |
| **Squarespace** | 2.6% (US 16%) | `Static.SQUARESPACE_CONTEXT`, `static1.squarespace.com`, `assets.squarespace.com`; cookie `crumb`; `?format=json` works | `GET /{shop-collection}?format=json` (items + variants); `GET /{shop}/p/{slug}?format=json` | Cart via `/api/commerce/shopping-cart/entries?crumb=…` (UNVERIFIED); otherwise hosted checkout | None | **High (catalog LIVE-OK); Low (cart)** |
| **Wix Stores** | 7.4% (US 23%) | Header `x-wix-request-id`, `server: Pepyaka`; `static.parastorage.com`, `static.wixstatic.com`; meta generator `Wix.com Website Builder` | `/sitemap.xml` then `store-products-sitemap.xml` then `/product-page/{slug}` JSON-LD. Official Catalog API needs owner OAuth (Wix Headless) | No public cart API without a Headless client ID. Deep-link to product page | Owner-issued for APIs | **Medium (sitemap/JSON-LD); UNVERIFIED internals** |
| **PrestaShop 1.7/8/9** | EU | JS global `var prestashop = {...}` containing `static_token`, `urls.base_url`; cookie `PrestaShop-{md5}`; `/modules/ps_*` and `/themes/classic/` paths | Category/search URL + `?from-xhr` with `Accept: application/json` and `X-Requested-With: XMLHttpRequest` returns JSON (`products[]`, `pagination`, `rendered_products`) | `POST /index.php?controller=cart` form `add=1&action=update&id_product&id_product_attribute&qty&token={static_token}&ajax=1`; hosted checkout | Webservice `/api/*` needs `ws_key` (skip) | **Medium (DOCS/source); live test inconclusive** |
| **Shopware 6** | DACH | `/bundles/storefront/`, `/theme/{hash}/`, `data-*-plugin` attributes, `window.router` / `window.salesChannelId`, cookies `session-*`, `sw-*`; headless: `sw-access-key`, `sw-context-token` headers | Store API `POST /store-api/product` needs header `sw-access-key` (sales-channel key, "public but not published"). Fallback: `/sitemap.xml` + microdata/JSON-LD | Storefront `POST /checkout/line-item/add` (`lineItems[{id}][id|type|quantity]`); Store API `POST /store-api/checkout/cart/line-item` with `sw-context-token` | `sw-access-key` (sometimes leaks in headless JS bundles) | **Medium (DOCS)** |
| **OpenCart 3/4** | small | `index.php?route=common/home`, `route=product/product&product_id=`; `catalog/view/theme/`; cookie `OCSESSID` | No JSON catalog. `route=product/category&path=`, `route=product/search&search=` (HTML) + microdata; Google Base feed extension often disabled | `POST index.php?route=checkout/cart/add` (3.x) / `route=checkout/cart.add` (4.x), form `product_id`, `quantity`, JSON response | None | **Medium (DOCS/UNVERIFIED on 4.x separator)** |
| **Ecwid / Lightspeed E-Series** | small (widget on many sites) | `app.ecwid.com/script.js?{storeId}`, `Ecwid.*` JS, `ecwid-` classes | REST `https://app.ecwid.com/api/v3/{storeId}/products?token=public_…` needs a **public token** issued by the owner/app (UNVERIFIED if scrapeable). Fallback: JSON-LD/sitemap on Instant Site | Hosted Ecwid cart (JS); REST order creation needs a secret token | Public token | **Low-Med (UNVERIFIED)** |
| **Shopify (baseline)** | ~20% | `cdn.shopify.com`, `Shopify.theme`, header `x-shopid`/`x-shopify-stage`, cookies `_shopify_y`, `cart` | `GET /products.json?limit=250&page=N`; `/products/{handle}.js`; `/collections/all/products.json` | `/cart/add.js`, `/cart.js`, permalink `/cart/{variantId}:{qty}`; **UCP manifest `/.well-known/ucp` gives MCP at `/api/ucp/mcp`** | None | **High, LIVE-OK** |

---

## Details per platform

### WooCommerce (Store API): LIVE-OK

Test store: `https://porterandyork.com` (69 products). Docs: [Store API](https://developer.woocommerce.com/docs/apis/store-api/), [Cart](https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/cart/), [Cart Tokens](https://developer.woocommerce.com/docs/apis/store-api/cart-tokens/), [Checkout](https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/checkout/), [Placing an order tutorial](https://developer.woocommerce.com/2023/09/20/tutorial-placing-an-order-using-the-store-api/).

**Detection**: `GET /wp-json/` returns JSON whose `namespaces` includes `"wc/store/v1"`. This is the most reliable check and doubles as a capability probe. The live store also exposed `wp-abilities/v1` and `mcp`, which means the WordPress MCP adapter is installed; its endpoints need auth.

**Catalog**:
```
GET /wp-json/wc/store/v1/products?per_page=100&page=1
  → headers: X-WP-Total: 69, X-WP-TotalPages: 69 (for per_page=1), Link: <...page=2>; rel="next"
  → per-item keys: id, name, slug, parent, type, variation, permalink, sku, short_description,
    description, on_sale, prices{price,regular_price,sale_price,price_range,currency_code,
    currency_minor_unit,...}, images[], categories[], tags[], brands[], attributes[],
    variations[], has_options, is_purchasable, is_in_stock, stock_availability,
    add_to_cart{url,minimum,maximum,multiple_of}, extensions
GET /wp-json/wc/store/v1/products/{id}
GET /wp-json/wc/store/v1/products/categories | /attributes | /tags
Filters: search, category, tag, orderby, order, on_sale, min_price, max_price, stock_status[], type, include[]
```
- `per_page` max is 100.
- Prices are **strings in minor units**. Divide by `10^currency_minor_unit`; porterandyork uses minor_unit 0, so "115" means $115.
- Names contain HTML entities (`&#8211;`), so decode them.
- No documented rate limit. The Store API has optional rate limiting, off by default.

**Cart and checkout** (all headless):
```
GET  /wp-json/wc/store/v1/cart          → response headers: Cart-Token: eyJ... (JWT, ~48h), Nonce: xxxx
POST /wp-json/wc/store/v1/cart/add-item   headers: Cart-Token: <jwt>   body: {"id": 123, "quantity": 1}  (variation: {"id": varId, "variation":[{"attribute":"pa_size","value":"L"}]})
POST /wp-json/wc/store/v1/cart/update-customer   {billing_address, shipping_address}
POST /wp-json/wc/store/v1/cart/select-shipping-rate {package_id, rate_id}
GET  /wp-json/wc/store/v1/checkout       → draft order
POST /wp-json/wc/store/v1/checkout        headers: Cart-Token
     {"billing_address":{...,"email":...},"shipping_address":{...},"payment_method":"cheque"|"bacs"|"cod"|"stripe", "payment_data":[{"key":"...","value":"..."}]}
  → {"order_id":146,"status":"on-hold","order_key":"wc_order_…","payment_result":{"payment_status":"success","redirect_url":"…/order-received/146/?key=…"}}
```
- With a Cart-Token you don't need a Nonce ([docs](https://developer.woocommerce.com/docs/apis/store-api/cart-tokens/)).
- **Payment gotcha**: card gateways (WooPayments/Stripe) expect a client-side-created PaymentMethod in `payment_data`, e.g. `wc-stripe-payment-method` (UNVERIFIED key names per gateway).
- **Hackathon path**: place the order with an offline method if the store enables one (`bacs`/`cheque`/`cod`), or create a pending order and send the human to the pay-for-order URL (`/checkout/order-pay/{id}/?pay_for_order=true&key={order_key}`, a standard Woo URL). Alternatively, pay via our own rail (x402/Stripe SPT) and treat the store as fulfillment.

**Agentic ecosystem**: WooCommerce 10.9 (June 2026) ships a native MCP developer preview over the WP Abilities API ([digitalapplied](https://www.digitalapplied.com/blog/woocommerce-10-9-mcp-agent-ready-wordpress-store-guide), [Woo roadmap](https://developer.woocommerce.com/2025/10/03/ai-agentic-commerce-in-woocommerce/)). Store owners need to set it up and authenticate it; it isn't public. A third-party plugin adds UCP/ACP endpoints ([wordpress.org](https://wordpress.org/plugins/ucp-acp-agent-for-woocommerce/)). Most Woo stores have neither, so our crawler adds value here.

### Magento 2 / Adobe Commerce: LIVE-OK (GraphQL)

Test stores: `https://www.bulk.com/uk/graphql` (Adobe Commerce behind an AEM Edge Delivery storefront) and `https://www.lampenwelt.de` (Luma-style, `/graphql` WAF-blocked with a 403).

**Detection**: HTML has `x-magento-init` scripts, `Magento_Checkout`/`Magento_Ui` paths, `static/version1790320451`, `mage/cookies`. Probe `GET /graphql?query={storeConfig{store_code base_currency_code base_url}}`, which returned `{"data":{"storeConfig":{"store_code":"bulkpowders_store","base_currency_code":"GBP",...}}}`. `GET /rest/V1/directory/currency` returns 200 anonymously; `/rest/V1/products` returns 401 `Magento_Catalog::products`.

**Catalog** (GET works, so it's cacheable):
```graphql
{ products(search:"", pageSize:50, currentPage:1) {
    total_count page_info{ total_pages current_page }
    items { __typename sku name url_key url_suffix stock_status
      description{html} image{url} media_gallery{url}
      price_range{ minimum_price{ final_price{value currency} regular_price{value currency} } }
      ... on ConfigurableProduct { configurable_options{attribute_code values{uid label}}
                                   variants{ attributes{code label uid} product{ sku stock_status } } } } } }
{ categoryList { uid name product_count children { uid name product_count } } }
```
- `search:""` returned `total_count:250`. Filtering by `category_uid:{in:[...]}` also works.
- Filter fields vary per store: `sku`/`price` were not filterable on bulk.com. Introspect `ProductAttributeFilterInput` first.
- Default `pageSize` max is typically 300 and depth/complexity limits apply (DOCS).

**Guest cart/checkout (GraphQL)** ([Adobe docs](https://developer.adobe.com/commerce/webapi/graphql/tutorials/checkout/)):
`createGuestCart` (2.4.7+; older versions use `createEmptyCart`), then `addProductsToCart(cartId, cartItems:[{sku, quantity, selected_options:[uid]}])`, `setGuestEmailOnCart`, `setShippingAddressesOnCart`, `setBillingAddressOnCart`, `setShippingMethodsOnCart`, `setPaymentMethodOnCart({code:"checkmo"})`, `placeOrder`. Read `available_payment_methods` on the cart. Card gateways such as Braintree/Adyen/Stripe need gateway tokens. REST equivalent: `POST /rest/V1/guest-carts`, then `/guest-carts/{id}/items`, then `/estimate-shipping-methods`, `/shipping-information`, `/payment-information`.

**Gotcha**: Adobe Commerce storefronts on Edge Delivery Services (`/scripts/aem.js`, `@dropins/storefront-*`) don't carry Luma fingerprints. Detect them by `/graphql` + `storeConfig` succeeding.

### Salesforce Commerce Cloud (SFRA): LIVE-OK (catalog)

Test: `https://www.camelbak.com`, site id `Sites-CamelbakUS-Site/en_US`, extracted from HTML.

**Detection**: `/on/demandware.store/Sites-{id}-Site/{locale}/{Controller-Action}` URLs in HTML; `/on/demandware.static/`; cookies `dwsid`, `dwanonymous_*`, `dwac_*`, `__cq_dnt`, `sid`.

**Catalog**: discover products from `robots.txt` → `sitemap_index.xml`, and product ids from `data-pid` attributes or product URLs.
- `GET {base}/Product-Variation?pid=CB-2705501000&quantity=1` returns 200 `application/json` with `{product:{id, productName, productType:"variant", available:true, readyToOrder:true, price:{sales:{value:99,currency:"USD"}}, images, variationAttributes, ...}}`. Very clean.
- `Search-UpdateGrid?cgid=root&start=0&sz=N` and `SearchServices-GetSuggestions?q=` return HTML fragments.

**Cart**: `POST {base}/Cart-AddProduct` with form `pid`, `quantity` (SFRA standard) returns cart JSON. Checkout steps (`CheckoutShippingServices-SubmitShipping`, `CheckoutServices-SubmitPayment`, `CheckoutServices-PlaceOrder`) need `csrf_token` and gateway tokens. We did not POST live.

PWA Kit / Composable storefronts use SCAPI (`https://{shortCode}.api.commercecloud.salesforce.com/...`) with SLAS guest tokens. The client_id is public in the bundle (UNVERIFIED approach).

### BigCommerce: LIVE-OK (partial)

Test: `https://www.berlinpackaging.com` (store id 10112711).

**Detection**: response header **`x-bc-store-id: 10112711`**, `x-bc-is-ha`. Cookies `SHOP_SESSION_TOKEN`, `SF-CSRF-TOKEN`, `XSRF-TOKEN`, `fornax_anonymousId`, `athena_short_visit_id`, `Shopper-Pref`. HTML references `cdn11.bigcommerce.com` and `stencil`.

**Catalog**:
- `GET /xmlsitemap.php` returns a sitemap index (`type=pages|products|categories|brands|news`).
- `GET /xmlsitemap.php?type=products&page=1` returns product URLs.
- Each product page has JSON-LD `Product` + `Offer`.
- `GET /rss.php?action=newproducts&type=rss` returns 10 items with `isc:productid`, `isc:price`, `isc:image`, `isc:description`. Other actions `featuredproducts`/`popularproducts` are UNVERIFIED.
- The GraphQL Storefront API `POST /graphql` needs `Authorization: Bearer <storefront token>`. Some Stencil themes embed the token in page context; berlinpackaging did not. [BC GraphQL docs](https://developer.bigcommerce.com/docs/storefront/graphql)

**Cart** ([Storefront Cart API](https://developer.bigcommerce.com/docs/rest-storefront/carts)):
- `GET /api/storefront/carts` returns `[]` with status 200, LIVE-OK.
- `POST /api/storefront/carts` with `{"lineItems":[{"productId":123,"quantity":1}]}` uses the session cookie (DOCS).
- `/api/storefront/checkouts/{id}/billing-address` and `/consignments` exist (DOCS).
- Payment happens on the hosted `/checkout`.
- Add-to-cart link: `/cart.php?action=add&product_id={id}&qty=1`.

BigCommerce partnered with Stripe on the Agentic Commerce Suite / ACP ([BC IR](https://investors.bigcommerce.com/news-releases/news-release-details/bigcommerce-partners-stripe-support-new-agentic-commerce-suite)).

### Squarespace: LIVE-OK (catalog)

Test: `https://hester-demo.squarespace.com/shop?format=json`.

- **Detection**: `Static.SQUARESPACE_CONTEXT`, `static1.squarespace.com`, the `crumb` cookie, and the fact that `?format=json` returns JSON with a `website` key.
- **Catalog**: top-level keys are `website, websiteSettings, collection, items, pagination?, shoppingCart, nestedCategories...`.
  - Items carry `id, title, urlId, fullUrl, body(HTML), excerpt, assetUrl, tags, categoryIds, priceMoney, salePriceMoney, onSale, productType, variants[]`.
  - Variants carry `{id, sku, priceMoney{currency,value}, salePriceMoney, onSale, unlimited, qtyInStock, attributes, optionValues}`.
  - Paginate with `?format=json&offset={pagination.nextPageOffset}` while `pagination.nextPage` is true.
  - Product detail: `{fullUrl}?format=json`.
- **Discovery**: find shop collections via `/sitemap.xml` or `website`/`collection` metadata.
- **Cart**: UNVERIFIED. The internal `POST /api/commerce/shopping-cart/entries?crumb={crumb}` with `{itemId, sku, quantity}` exists but is undocumented. For the hackathon, deep-link to the product page. Squarespace appears in Stripe's Agentic Commerce Suite partner list ([Stripe](https://stripe.com/newsroom/news/agentic-commerce-suite)).

### Wix Stores (UNVERIFIED internals)

- **Detection**: `x-wix-request-id` header, `server: Pepyaka`, `static.parastorage.com`, `static.wixstatic.com`, meta generator `Wix.com Website Builder`.
- **Catalog**: the sitemap index includes a stores sitemap (`/store-products-sitemap.xml`) per [Wix help](https://support.wix.com/en/article/understanding-your-sites-sitemap-file). Product pages `/product-page/{slug}` carry JSON-LD Product (UNVERIFIED live). The official [Catalog V1/V3 APIs](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/introduction) need an owner-created Headless OAuth client (visitor tokens). Internal `/_api/...` endpoints (instance tokens via `/_api/v1/access-tokens`) exist but are fragile; skip them.
- **Cart**: none publicly. Deep-link instead. Wix supports ACP via Stripe.

### PrestaShop 1.7 / 8 / 9 (DOCS; live test inconclusive)

- **Detection**: inline `var prestashop = {...}` containing `"static_token":"…"`, `"token":"…"`, `"urls":{"base_url":…,"pages":{"cart":…,"search":…}}`. Confirmed live on laguiole-attitude.com. Also the `PrestaShop-{hash}` cookie and `/themes/classic/`, `/modules/ps_shoppingcart/` paths.
- **Catalog**: listing controllers (category/search/manufacturer) return JSON when requested via AJAX: send `?from-xhr` or `Accept: application/json` + `X-Requested-With: XMLHttpRequest`. The JSON includes `rendered_products` (HTML), `pagination`, and in core `products[]` with `id_product, name, price_amount, url, add_to_cart_url, quantity, reference` ([devdocs listing](https://devdocs.prestashop-project.org/8/themes/reference/templates/listing/), [ProductListingFrontController.php](https://github.com/PrestaShop/PrestaShop/blob/develop/classes/controller/ProductListingFrontController.php)). Our live test store returned HTML/404 (custom routing), so treat this as best-effort and fall back to sitemap (`/1_index_sitemap.xml` from the gsitemap module, often present) plus JSON-LD. The Webservice `/api/products` needs `ws_key`; skip.
- **Cart**: `POST /index.php?controller=cart` with `add=1&action=update&ajax=1&id_product=X&id_product_attribute=Y&qty=1&token={static_token}` returns JSON (DOCS/UNVERIFIED live). Checkout is multi-step HTML; hand off to a human.

### Shopware 6 (DOCS)

- **Store API** is public by design but needs the `sw-access-key` header (a per-sales-channel key from admin) ([Store API auth](https://shopware.stoplight.io/docs/store-api/ZG9jOjEwODA3NjQx-authentication-and-authorisation)). If you have it:
  - `POST /store-api/product` with `{"limit":100,"page":1}`
  - `POST /store-api/search?search=…`
  - `POST /store-api/checkout/cart/line-item` (`sw-context-token` header)
  - `POST /store-api/checkout/order`

  Headless (Shopware Frontends/PWA) sites ship this key in client JS (UNVERIFIED how often). Twig storefronts don't.
- **Storefront (no key)**: `/sitemap.xml` plus product pages (microdata/JSON-LD) and `/suggest?search=`. Cart: `POST /checkout/line-item/add` with `lineItems[{id}][id]={id}&lineItems[{id}][type]=product&lineItems[{id}][quantity]=1&redirectTo=frontend.cart.offcanvas`. There is no CSRF token since 6.5 (UNVERIFIED).

### OpenCart (DOCS/UNVERIFIED)

- **Detection**: `index.php?route=` links, `catalog/view/theme/`, the `OCSESSID` cookie.
- **Catalog**: no JSON. Use `route=product/search&search=&limit=100` HTML or the sitemap (extension) plus product page microdata.
- **Cart**: `POST index.php?route=checkout/cart/add` (3.x) with `product_id`, `quantity` returns `{"success":…}`. 4.x uses `route=checkout/cart.add` (separator changed in 4.0.2; UNVERIFIED).

### Ecwid / Lightspeed E-Series (UNVERIFIED)

- **Detection**: `app.ecwid.com/script.js?{storeId}`.
- **Catalog**: REST `https://app.ecwid.com/api/v3/{storeId}/products?token=public_…&limit=100&offset=N`, but the public token is issued per app/owner ([Ecwid API](https://api-docs.ecwid.com/reference/overview)). Treat these stores as fallback (JSON-LD) or as merchant opt-in. The cart is JS-driven.

### Shopify baseline: LIVE-OK

- `GET /products.json?limit=250&page=N` returns keys `id,title,handle,body_html,vendor,product_type,tags,variants,images,options`. Pages beyond the end return `[]`.
- `/.well-known/ucp` (skullcandy) returns `{"ucp":{"version":"2026-08-25","services":{"dev.ucp.shopping":[{"transport":"mcp","endpoint":"https://{shop}.myshopify.com/api/ucp/mcp","schema":"https://ucp.dev/2026-08-25/services/shopping/mcp.openrpc.json"}, …]},"capabilities":{"dev.ucp.shopping.checkout", ".cart", ".fulfillment", ".discount", ".order", …}}}`.
- **Takeaway**: Shopify stores are already agent-ready. Our value is everyone else. We should mirror this manifest format ([ucp.dev](https://ucp.dev)).

### Universal fallback (any platform, including custom)

1. `robots.txt`, then `Sitemap:` lines, then sitemap index, then product sitemaps. Filter by URL patterns such as `/product/`, `/p/`, `/products/`, `/product-page/`, `.html`.
2. Product page: parse `<script type="application/ld+json">` for `@type` `Product`/`ProductGroup` + `Offer` (price, priceCurrency, availability, sku, gtin, image). Verified present on the Woo and BC test stores. Also read OpenGraph `og:type=product`, `product:price:amount`.
3. If both fail, fall back to LLM extraction on cleaned HTML (see 05-generic-extraction-pipeline.md).
4. Checkout fallback: deep link / add-to-cart URL, with the human (or a browser agent) completing checkout, or our own payment rail plus merchant fulfillment.

---

## Detection algorithm (drop-in order, cheapest first)

```ts
// 1 HEAD/GET "/" → check headers + cookies + HTML (single request), then probes only if ambiguous
const rules = [
  { p: 'shopify',      h: /x-shopid|x-shopify/i,  html: /cdn\.shopify\.com|Shopify\.theme/ },
  { p: 'bigcommerce',  h: /x-bc-store-id/i,       c: /SHOP_SESSION_TOKEN|SF-CSRF-TOKEN/, html: /cdn11\.bigcommerce\.com/ },
  { p: 'wix',          h: /x-wix-request-id|Pepyaka/i, html: /static\.parastorage\.com|wixstatic\.com/ },
  { p: 'squarespace',  html: /Static\.SQUARESPACE_CONTEXT|static1\.squarespace\.com/ },
  { p: 'sfcc',         c: /dwsid|dwanonymous_/,   html: /\/on\/demandware\.(store|static)\// },
  { p: 'magento',      c: /form_key|mage-cache-sessid|private_content_version/, html: /x-magento-init|Magento_[A-Z]|mage\/cookies|\/static\/version\d+\// },
  { p: 'woocommerce',  c: /woocommerce_|wp_woocommerce_session/, html: /wp-content\/plugins\/woocommerce|woocommerce-/ },
  { p: 'prestashop',   c: /PrestaShop-[a-f0-9]{32}/, html: /var prestashop\s*=|"static_token"/ },
  { p: 'shopware',     html: /\/bundles\/storefront\/|window\.salesChannelId|sw-access-key/ },
  { p: 'opencart',     c: /OCSESSID/, html: /index\.php\?route=(common|product)\/|catalog\/view\/theme\// },
  { p: 'ecwid',        html: /app\.ecwid\.com\/script\.js/ },
];
// 2 capability probes (confirm + pick adapter):
//   GET /wp-json/  → namespaces includes "wc/store/v1"         => woo adapter
//   GET /graphql?query={storeConfig{store_code}}  → data.storeConfig => magento adapter (catches headless/EDS)
//   GET /products.json?limit=1                    → {products:[]}    => shopify
//   GET /{any}?format=json                        → has "website"    => squarespace
//   GET /.well-known/ucp                          → already agent-ready (just index + link)
// 3 else: sitemap + JSON-LD fallback adapter
```

---

## Recommendations for the hackathon build

1. **Build 4 adapters plus 1 fallback, in this order**: `woocommerce` (catalog + full cart/checkout), `magento-graphql` (catalog, with cart as a stretch), `squarespace-json` (catalog), `sfcc-sfra` (sitemap + Product-Variation), and `jsonld-sitemap` for everything else (BigCommerce, Wix, Shopware, PrestaShop, OpenCart, custom). Treat Shopify as a pass-through: pull `/products.json` and link to its `/.well-known/ucp`.
2. **Normalize to one schema** close to Shopify's products.json and UCP item shapes: `{id, title, handle, url, description, vendor, images[], variants[{id, sku, price{amount_minor, currency}, available, options}], platform, source_endpoint, fetched_at}`. Convert prices to minor-unit ints. WooCommerce already uses minor-unit strings; Magento and SFCC use floats; Squarespace uses decimal strings.
3. **Expose per store**: `GET /api/stores/{domain}/products.json`, `/.well-known/ucp`-style manifest, and an MCP server with tools `search_products`, `get_product`, `create_cart`, `add_to_cart`, `checkout`. Pure GET catalog endpoints on target stores keep crawls cheap and cacheable in Supabase.
4. **Demo checkout on WooCommerce**, the only platform with a documented, public, fully headless cart-to-order API. Flow: `GET /cart` (grab Cart-Token), then `add-item`, `update-customer`, and `checkout` with an offline payment method or a pending order plus pay URL, and our x402/Stripe rail settling in front. For the live demo, use our own WooCommerce instance (easy to spin up) rather than placing real orders on third-party stores.
5. **For the other platforms, "checkout" means a deep link**: an add-to-cart URL (BigCommerce `/cart.php?action=add…`, Shopify `/cart/{variant}:{qty}`) or a hosted checkout handoff. Label it honestly in the UI as "assisted checkout".
6. **Crawler hygiene**: browser UA, 1-2 req/s per host, honor robots.txt, cache aggressively, backoff on 403/429, and detect challenge pages (`Just a moment`, `captcha-delivery.com`).
7. **Known-good demo stores** (all checked today): WooCommerce `porterandyork.com`, `woocommerce.com`; Magento `www.bulk.com/uk`; SFCC `www.camelbak.com`; BigCommerce `www.berlinpackaging.com`; Squarespace `hester-demo.squarespace.com`; Shopify baseline `www.skullcandy.com`.

---

## Open questions and risks

- **Bot walls**: DataDome (hellyhansen), Akamai (landsend), Cloudflare challenge (demo.opencart.com), 403s (yeti, hanes, solostove, jdsports). A server-side crawler in a Next.js route or on Vercel will hit these. We may need a headless browser or an allowlisted proxy for some targets; out of scope for the hackathon.
- **Legal/ToS**: scraping catalogs is generally tolerated for public data. Placing orders on third-party stores via internal endpoints is not. Keep live checkout to our own store or to opted-in merchants.
- **Payment gateways**: Woo, Magento and SFCC card payments need gateway-specific client tokens (Stripe PaymentMethod, Braintree nonce, Adyen encrypted data). We can't tokenize for arbitrary merchants. The realistic headless flow is an offline or pending-payment order, or merchant opt-in to ACP/UCP via Stripe.
- **Magento GraphQL variance**: filterable attributes differ per store, and some return a capped `total_count`. Needs introspection and category-walk fallback.
- **Woo Store API disabled**: some stores disable it or block `/wp-json` with security plugins. Fall back to `product-sitemap.xml` (Yoast/RankMath, 200 LIVE-OK) plus JSON-LD.
- UNVERIFIED items to confirm if time allows: Squarespace cart API, PrestaShop `from-xhr` JSON on a stock 8.x store, the OpenCart 4 route separator, Shopware 6 storefront CSRF, Ecwid public token discoverability, Wix JSON-LD coverage.

---

## Sources

- WooCommerce Store API: https://developer.woocommerce.com/docs/apis/store-api/ · Cart: https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/cart/ · Cart tokens: https://developer.woocommerce.com/docs/apis/store-api/cart-tokens/ · Nonce: https://developer.woocommerce.com/docs/apis/store-api/nonce-tokens/ · Checkout: https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/checkout/ · Order tutorial: https://developer.woocommerce.com/2023/09/20/tutorial-placing-an-order-using-the-store-api/
- Woo agentic: https://developer.woocommerce.com/2025/10/03/ai-agentic-commerce-in-woocommerce/ · https://www.digitalapplied.com/blog/woocommerce-10-9-mcp-agent-ready-wordpress-store-guide · https://wordpress.org/plugins/ucp-acp-agent-for-woocommerce/
- Adobe Commerce GraphQL checkout: https://developer.adobe.com/commerce/webapi/graphql/tutorials/checkout/
- BigCommerce: https://developer.bigcommerce.com/docs/storefront/graphql · https://developer.bigcommerce.com/docs/rest-storefront/carts · https://investors.bigcommerce.com/news-releases/news-release-details/bigcommerce-partners-stripe-support-new-agentic-commerce-suite
- Stripe Agentic Commerce Suite: https://stripe.com/newsroom/news/agentic-commerce-suite
- Shopware Store API: https://shopware.stoplight.io/docs/store-api/38777d33d92dc-quick-start-guide · https://shopware.stoplight.io/docs/store-api/ZG9jOjEwODA3NjQx-authentication-and-authorisation
- PrestaShop listing: https://devdocs.prestashop-project.org/8/themes/reference/templates/listing/ · https://github.com/PrestaShop/PrestaShop/blob/develop/classes/controller/ProductListingFrontController.php
- Wix: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/introduction · https://support.wix.com/en/article/understanding-your-sites-sitemap-file
- Ecwid: https://api-docs.ecwid.com/reference/overview
- UCP: https://ucp.dev (manifest observed live at https://www.skullcandy.com/.well-known/ucp)
- Market share: https://www.gravitykit.com/ecommerce-platform-market-share-2026/ · https://redstagfulfillment.com/what-is-woocommerces-market-share/ · https://www.mobiloud.com/blog/ecommerce-platform-market-share-usa · https://coalitiontechnologies.com/blog/2026-ecommerce-cms-market-share-usage-stats
- Live tests (2026-09-26, read-only GETs): porterandyork.com, woocommerce.com, bulk.com/uk, lampenwelt.de, camelbak.com, berlinpackaging.com, hester-demo.squarespace.com, laguiole-attitude.com, skullcandy.com
