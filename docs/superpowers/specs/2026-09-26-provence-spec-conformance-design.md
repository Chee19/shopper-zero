# Provence demo store: spec conformance

Design, 2026-09-26. Makes `demo-stores/provence` adhere to `docs/specs` and `docs/research`,
and registers it as a third `OURS` demo fixture.

## 1. Why

The Provence store (`Lumière de Provence`, a fictional SFCC-style beauty storefront in
before/after modes) was built before the research and specs landed. It demos ShoperZero, so
what it serves has to match the contracts the product's own probes and serializers are
specified against. Today it does not, and three of the gaps are load-bearing: the store
currently cannot be scanned or indexed the way spec 02 describes.

`docs/specs/DECISIONS.md` is binding, then spec 00, then 01–05. This document does not
override any of them; where it deviates, §9 says so and why.

## 2. Scope

**In:** `demo-stores/provence/**` only.

**Out:** `src/**`, `infra/**`, `demo-stores/news/**`. Anything needed there is written up as a
handoff (§8) rather than built. In particular `src/lib/crawl/__fixtures__/demo-stores.ts` is
WS2's file (Chee19, per `TEAM-SPLIT.md`) and is not touched.

## 3. What the scan should report

The point of the work: both modes produce a **score derived from spec 02 §6.8**, not an
invented one. Two rows, pinned by test (§7).

### 3.1 Before → 41 → D

Detection: `sfcc` at confidence ≈0.98 (`/on/demandware.store/` html 0.7, `dwsid` cookie 0.6,
site-id extraction 0.8, noisy-OR). Spec 02 §5.4: *"SFCC has no probe; for it, 'site id
extracted' counts as the probe"*, so `adapter` is set.

The `api` probe's standard signals all fail (no UCP profile, no MCP card, no ACP link,
`/products.json` 404, no `cart.js`). The platform signal `sfcc_product_variation` passes,
setting `catalog` (sitemap + API), `product_detail`, `price_availability` and `variants`.
SFCC contributes no cart signal (§6.3: *"Cart-AddProduct is a POST"*).

`passed`, because `catalog && price_availability` (§6.1). Class is **`api_platform`**, since
no standard-class signal set a capability — §6.8's definition being *"the agent has to know
the platform's private API, and there is nothing it can discover."*

| Term | Value |
|---|---|
| `BAND[api_platform]` | 20 |
| capabilities | catalog 7 + product_detail 5 + price_availability 8 + variants 4 = 24, × `FACTOR` 0.7 = **16.8** |
| checks | `sitemap` 10 + `robots_allows_agents` 10 = 20, × `CHECKS_SHARE` 0.20 = **4** |
| **total** | 20 + 16.8 + 4 = 40.8 → round **41** → **D** (`gradeFor` ≥40) |

The other six checks fail: `products_json`, `well_known_ucp`, `mcp_endpoint`, `llms_txt`,
`jsonld_product_coverage`, `agent_checkout`.

> **Knife-edge — deliberate, and pinned by `scoring.test.mjs`.** 41 is one point above the
> D/F boundary. `robots_allows_agents` is worth 10 of the 20 check points; if it flips, the
> score is 38.8 → **F**. Before-mode's robots.txt disallows `*?pid=`, so the sitemap must
> list clean `.html` product URLs with no query string (§5.2 item 3). This is the single
> most fragile thing in the design.

### 3.2 After → 100 → A

After-mode keeps the Demandware skin, so it still detects as `sfcc` — but standard signals
now fire, which is what lifts the band from 20 to 45.

| Term | Value |
|---|---|
| `BAND[api_standard]` | 45 |
| capabilities | all six (catalog 7, product_detail 5, price_availability 8, variants 4, cart 6, checkout_reachable 5) = 35, × `FACTOR` 1.0 = **35** |
| checks | all eight = 100, × 0.20 = **20** |
| **total** | 45 + 35 + 20 = **100** → **A** |

Capability sources: `ucp_capabilities` gives catalog/product_detail/price_availability via
`catalog.search`+`.lookup`, `cart` via `.cart`, `checkout_reachable` via `.checkout`;
`products_json` gives `variants`, whose signal needs only *"a product with more than 1
variant"* — six of the ten qualify (§3.3).

This ties the Shopify control row in §6.8's expected-score table.

### 3.3 Catalog shape the serializers must handle

Verified against `catalog.mjs`, because several spec rules are conditional on variant count:

| Fact | Value |
|---|---|
| Products | 10 |
| Variants | 18 |
| Products with **exactly one** variant | **4** — `shea-rich-body-cream`, `cherry-blossom-body-lotion`, `lavender-pillow-mist`, `hand-cream-discovery-trio` |
| Out-of-stock variants | 1 — `04FM150` (rose-petal-face-mist, 150 ml) |

The single-variant products are the reason §6.4's `group_id`, `listing_has_variations` and
`variant_dict` are conditional rather than unconditional, and the one out-of-stock variant is
what exercises the `out_of_stock` availability mapping in JSON-LD, the ACP feed and
`products.json`. Both are asserted in §7.

### 3.4 Cascade and estimates

`api` passes in both modes, so `dom` and `computer_use` end `skipped` with
`error.code: "cascade_stopped"` and `STATIC_ESTIMATES` prefilled (§6.2).

`Product-Variation` keeps its existing 350 ms artificial latency in **both** modes — a real
SFRA controller is slow, and it is not gamed for effect. Per §6.3,
`est_seconds_per_task = round1(3 × median(ok latencies) / 1000)`, so before-mode lands near
**1.1 s** (one slow controller dominates the median) and after-mode near **0.1 s** (the
median is dominated by fast static endpoints). `est_usd_per_task` is `0.00` for both.

## 4. Module layout

`server.mjs` is 692 lines and roughly half rendering. Adding six serializers to it would push
it past 1,200. Split, with `formats/` deliberately mirroring spec 03's own
`src/lib/formats/*` names so divergence between the demo store and WS3's implementation is
visible at a glance:

```
demo-stores/provence/
  server.mjs      routing + HTTP plumbing only
  config.mjs      BRAND, SHIPPING, MODE, BEFORE, ORIGIN, DW, STORE_EPOCH   (extracted)
  pages.mjs       HTML rendering: layout, home, plp, pdp, cart, checkout   (extracted)
  sfcc.mjs        Demandware controllers: Product-Variation, Cart-*, Search-UpdateGrid, Page-Include
  mcp.mjs         minimal JSON-RPC MCP endpoint                            (after-mode only)
  formats/
    text.mjs      stripHtml, truncate, escapeHtml, plainDescription, isAvailable  (03 §6, verbatim)
    money.mjs     toMinor, fromMinor, acpPrice, formatMoney
    jsonld.mjs    ProductGroup + hasVariant Offers          (parseable under 02 §5.7)
    shopify.mjs   products.json list + single               (03 §6.1 / §6.2)
    ucp.mjs       /.well-known/ucp profile                  (03 §6.6)
    acp.mjs       feed.acp.jsonl                            (03 §6.3)
    llms.mjs      llms.txt                                  (03 §6.5)
  __tests__/
    conformance.test.mjs
    scoring.test.mjs
  catalog.mjs, art.mjs, public/, README.md
```

Rules that hold across the split:

- **No new dependencies.** Node builtins only, as today.
- **`catalog.mjs` keeps dollar floats.** It is merchant data. `money.mjs` converts to the
  spec's integer minor units at the serializer boundary only, never in the catalog.
- **Determinism.** The catalog has no timestamps, so `config.mjs` exports a fixed
  `STORE_EPOCH = '2026-09-26T10:00:00.000Z'` (ISO with milliseconds, 00 §4.3) used for every
  `created_at` / `updated_at` / `published_at`. Fixed output keeps the tests meaningful.
- **Synthetic numeric ids**, since Shopify shapes need integers:
  - product `seq` = 1-based index in `PRODUCTS` (1–10)
  - variant `seq` = `productSeq * 100 + variantIndex + 1`
  - image `id` = `productSeq * 1000 + (i + 1)` (spec 03 §6.1's formula)

## 5. Before-mode

### 5.1 `Product-Variation` gets spec 02 §5.5.4's shape

The current response is `{pid, price: {value, formatted, currency}, available}`. The adapter
requires `product.productName` or it counts a miss, and ≥3 misses of the first 5 throw
`AdapterError('unavailable')`; the `sfcc_product_variation` signal requires `price.sales` and
`available`. **Both fail today**, so before-mode is currently unpinned — the api probe fails
and the cascade falls through to `dom`, which finds no JSON-LD either.

New shape:

```jsonc
{ "product": {
    "id": "01HC075",                    // variant pid
    "masterId": "01HC150",              // p.master
    "productName": "Shea Butter Hand Cream",
    "shortDescription": "…",            // p.summary
    "longDescription": "…",             // p.description
    "brand": "Lumière de Provence",
    "images": { "large": [{ "url": "…", "alt": "…" }], "small": [ … ] },
    "variationAttributes": [
      { "id": "size", "displayName": "Size",
        "values": [ { "value": "01HC075", "displayValue": "75 ml", "selected": true, "orderable": true } ] }
    ],
    "price": { "sales": { "value": 24, "currency": "USD", "formatted": "$24.00" }, "list": null },
    "available": true,
    "readyToOrder": true
} }
```

Unknown pid stays `404`. The 350 ms delay stays (§3.4).

### 5.2 URL and discovery fixes

1. **`productPath` → `/en-us/{slug}/{master}.html`.** §5.5.4 takes the pid as the last path
   segment before `.html`; today's `/en-us/{slug}-{master}.html` yields
   `shea-hand-cream-01HC150`, which is not a pid, so every adapter lookup misses. Ending the
   path with the master id matches real SFRA (`…/chute-mag/1832001050.html`) and makes the
   documented regex extract a real pid. `Product-Variation` also accepts the old
   `{slug}-{master}` form so existing links and `public/*.js` keep working.
2. **Real sitemap index.** `/sitemap_index.xml` becomes a `<sitemapindex>` referencing
   `/sitemap_0-product.xml` (§5.5.4 prefers child sitemaps matching `/product/i`). The child
   lists product URLs only; the parent also references `/sitemap_1-pages.xml` for home,
   categories and the policy page.
3. **Clean product URLs in the sitemap — no `?pid=`.** See the knife-edge note in §3.1.

### 5.3 Deliberately unchanged

These are the demo's substance and none of them move the score: no JSON-LD, no `og:price`,
price only after JS, the wrong-size cart bug (1-based swatch index into a 0-based array),
the full-screen cookie wall, the newsletter pop-up, and the checkout bot wall. The checkout
403 costs nothing because SFCC contributes no `cart` or `checkout_reachable` signal anyway.

`/products.json`, `/llms.txt`, `/.well-known/ucp`, `/feed.acp.jsonl` and `/api/mcp` all
return **404** in before-mode.

## 6. After-mode

### 6.1 `/.well-known/ucp` (03 §6.6)

Top-level `ucp` only — no sibling keys. `version` `"2026-08-25"`, `supported_versions` `{}`.

```jsonc
"services": { "dev.ucp.shopping": [ {
  "version": "2026-08-25",
  "spec": "https://ucp.dev/2026-08-25/specification/overview/",
  "transport": "mcp",
  "endpoint": "{ORIGIN}/api/mcp",
  "schema": "https://ucp.dev/2026-08-25/services/shopping/mcp.openrpc.json"
} ] }
```

Capabilities claimed: `dev.ucp.shopping.catalog.search`, `.catalog.lookup`, `.cart`,
`.checkout`, `.fulfillment` (with `extends: ["dev.ucp.shopping.checkout"]`), `.order`. Each
entry carries `version`, `spec` and `schema` at the `ucp.dev/{version}/…` paths §6.6 lists.

`payment_handlers: {}` — see §9.3.

### 6.2 `/products.json` (03 §6.1)

Body `{ "products": [ … ] }`. Paging per `parseShopifyPaging`: `limit` default 30, clamped to
250, minimum 1; `page` default 1; `page * limit > 25000` → `400 {"errors":"Page * Limit
exceeds the 25000 limit."}`. `collection`, `since_id` and other unknown params accepted and
ignored.

Product key order, exactly: `id, title, handle, body_html, published_at, created_at,
updated_at, vendor, product_type, tags, variants, images, options`.

- `body_html` — `"<p>" + escapeHtml(p.description) + "</p>"`, never null
- `vendor` — `BRAND.name`
- `product_type` — the category name
- `tags` — **array** in the list shape
- `options` — `[{ name: "Size", position: 1, values: [...] }]`, including for the four
  single-variant products, which have one real size rather than no option. Shopify's
  `[{ name: "Title", values: ["Default Title"] }]` fallback is therefore never emitted, and
  no variant is ever titled `"Default Title"`.

Variant key order: `id, title, option1, option2, option3, sku, requires_shipping, taxable,
featured_image, available, price, grams, compare_at_price, position, product_id, created_at,
updated_at`. `requires_shipping` and `taxable` true, `grams` null, `compare_at_price` null
(the catalog has no list prices), `price` as `fromMinor` → `"24.00"`.

Image object key order follows §6.1's worked example: `id, created_at, position, updated_at,
product_id, variant_ids, src, width, height`, with `width`/`height` null.

### 6.3 `/products/{handle}.json` (03 §6.2)

Body `{ "product": … }`. Key order: `id, title, body_html, vendor, product_type, created_at,
handle, updated_at, published_at, template_suffix, published_scope, tags, variants, options,
images, image`. `template_suffix` null, `published_scope` `"global"`, `tags` a **string**
(`join(", ")`), `image` = `images[0]` or null. Detail `images[]` key order: `id, product_id,
position, created_at, updated_at, alt, width, height, src, variant_ids`.

Detail variant key order: `id, product_id, title, price, sku, position, inventory_policy
("deny"), compare_at_price, fulfillment_service ("manual"), inventory_management (null),
option1, option2, option3, created_at, updated_at, taxable (true), barcode (null), grams
(null), image_id, weight (null), weight_unit ("kg"), inventory_quantity, old_inventory_quantity,
tax_code (null), requires_shipping (true), quantity_rule ({"min":1,"max":null,"increment":1}),
price_currency, compare_at_price_currency (""), quantity_price_breaks ([])`.

`inventory_quantity` comes from the catalog's `stock`. A bare handle with no `.json` suffix
302s to the PDP; `.js` → 404 (MVP, per §6.2). Unknown handle → `404 {"errors":"Not Found"}`.

### 6.4 `/feed.acp.jsonl` (03 §6.3)

One `\n`-terminated JSON object per **variant**. `Content-Type: text/plain; charset=utf-8` by
default so it renders in a browser; `?download=1` switches to `application/x-ndjson` plus
`Content-Disposition: attachment; filename="lumiere-de-provence.acp.jsonl"`. Always
`X-ACP-Feed-Version: 2026-04-17`.

Required: `item_id` (variant sku), `description` (truncated 5000), `url`, `brand`,
`seller_name`, `image_url`, `price` (`acpPrice` → `"24.00 USD"`), `availability`
(`in_stock` / `out_of_stock`), and `title` — which is
`truncate(p.variants.length > 1 ? "{product} - {size}" : p.title, 150)`, so the four
single-variant products (§3.3) carry **no size suffix**.

Optional, emitted only when known: `product_category`, `additional_image_urls`, `size`,
`seller_url`, `is_eligible_search: true`, `is_eligible_checkout: false`.

Conditional on `p.variants.length > 1`, so **absent on all four single-variant products**:
`group_id` (the master; §6.3 also requires it to differ from `item_id`, which holds since
`item_id` is the variant sku), `listing_has_variations: true`, and
`variant_dict: {"Size": "75 ml"}`.

**Never emit `null`, `""` or `"null"`** — omit the key. `mpn`, `gtin`, `color` and
`sale_price` are therefore always absent for this catalog.

### 6.5 `/llms.txt` (03 §6.5)

The per-store template's headings and order verbatim — `## For AI agents`,
`### Typical agent flow`, `## Catalog data`, `## Products`, `## Optional` — with URLs
re-pointed at the merchant origin and the three ShoperZero-specific lines dropped (§9.2).
`Content-Type: text/plain; charset=utf-8`. Lists all 10 products with price range and stock.

### 6.6 `/api/mcp` (03 §3)

A minimal Streamable HTTP JSON-RPC endpoint, enough for §6.3's `mcp_endpoint` signal to find
`result.tools[]`, and honest enough that an agent can actually call it.

- `POST` with `Accept: application/json, text/event-stream`
- `initialize` → `protocolVersion`, `serverInfo`, `capabilities.tools`
- `tools/list` → `search_catalog`, `lookup_catalog`, `get_product`
- `tools/call` → results whose `structuredContent` is the UCP product shape (03 §6.4)
- Session handling: accept and echo `Mcp-Session-Id`, but do not require it

### 6.7 Product pages

JSON-LD `ProductGroup` stays, gains per-variant `image` and `inProductGroupWithID` so §5.7's
variant grouping resolves both ways. `ProductGroup` is emitted uniformly, including for the
four single-variant products — §5.7 handles a group with one `hasVariant` ("Otherwise there
is a single variant"), and one shape for every PDP keeps the serializer and its test simple. Plus `og:price:amount`, `og:price:currency`,
`product:availability`, `<link rel="canonical">`, and price and availability server-rendered
into the HTML. robots.txt allows everything except `*/account`, and names the sitemap index.

## 7. Tests

`node --test demo-stores/provence/__tests__/*.test.mjs`, no new dependencies. Each file boots
the server on an ephemeral port in each mode.

**`conformance.test.mjs`**

- `products.json` list and detail: key order asserted with `Object.keys(...)` deep-equal, not
  merely presence; `parseShopifyPaging` semantics including the 25000 error body
- UCP profile: `ucp` is the only top-level key; `version` a string; the six capabilities
  present; `services[0].transport === "mcp"`
- ACP feed: 18 lines, one per variant; every line parses; required fields present; **no value
  is ever `null`, `""` or `"null"`**; for the four single-variant products (§3.3) `group_id`,
  `listing_has_variations` and `variant_dict` are **absent** and `title` carries no size
  suffix, while for a multi-variant product all three are present and `group_id !== item_id`
- availability: `04FM150` is `out_of_stock` in the ACP feed, `available: false` in
  `products.json`, and `https://schema.org/OutOfStock` in JSON-LD; every other variant is in
  stock in all three
- llms.txt: starts with `#`, headings present in order
- `Product-Variation` in both modes: `product.productName` and `price.sales` present
- JSON-LD re-parsed under §5.7's rules: ProductGroup selected by URL match, `hasVariant`
  deref, offers yield price + currency + availability, availability maps to
  `in_stock` / `out_of_stock`
- before-mode 404s: `/products.json`, `/llms.txt`, `/.well-known/ucp`, `/feed.acp.jsonl`,
  `/api/mcp`

**`scoring.test.mjs`** — the one that locks the design. Re-implements §6.8's constants
(`BAND`, `FACTOR`, `CAPABILITY_WEIGHTS`, `CHECKS_SHARE`) and 00's `READINESS_WEIGHTS`, runs
the eight readiness checks and the api-probe signals against the live server, and asserts:

- before: class `api_platform`, four capabilities, two checks, **40.8 → 41 → D**
- after: class `api_standard`, six capabilities, eight checks, **100 → A**
- the knife-edge explicitly: no sitemap product URL matches `?pid=`, and
  `robots_allows_agents` passes for `ShoperZeroBot`, `GPTBot`, `ClaudeBot`, `OAI-SearchBot`
  and `PerplexityBot`

A `test` script is added to `package.json` alongside the existing `demo:*` scripts.

## 8. Handoff to WS2

`README.md` gains a ready-to-paste fixture pair for
`src/lib/crawl/__fixtures__/demo-stores.ts`. **This design does not create or edit that file**
— it is Chee19's per `TEAM-SPLIT.md`.

```ts
{ url: PROVENCE_BEFORE_URL, expectPlatform: "sfcc", expectCrawlTier: "platform_api",
  expectAdapter: "sfcc", minProducts: 8,
  expectScan: { best_method: "api",
    statuses: { api: "passed", dom: "skipped", computer_use: "skipped" },
    grade: "D", afterGrade: "A" },
  status: "OURS",
  notes: "SFCC private controller only; api_platform band. 41 → D. Sitemap must stay ?pid=-free." },

{ url: PROVENCE_AFTER_URL, expectPlatform: "sfcc", expectCrawlTier: "platform_api",
  expectAdapter: "sfcc", minProducts: 8,
  expectScan: { best_method: "api",
    statuses: { api: "passed", dom: "skipped", computer_use: "skipped" },
    grade: "A", afterGrade: "A" },
  status: "OURS",
  notes: "Self-hosted UCP + products.json + MCP + ACP. api_standard. 100 → A." },
```

The README also records that Provence fills the `api_platform` → `api_standard` contrast,
which §10's table does not otherwise cover: its `api` rows are all either already-good
(Shopify) or platform-API stores scanned once.

## 9. Deviations from the specs, and why

**9.1 `_shoperzero` blocks omitted.** Spec 03's shapes carry `_shoperzero` extras holding our
UUIDs, `seq`, `store_slug` and an `api_url` into the ShoperZero app. A merchant self-hosting
its own agent surface should not emit those — it would be impersonating our index. Every
standard Shopify key is emitted in the documented order; the namespaced block is dropped. No
probe signal or readiness check reads it.

**9.2 llms.txt re-pointed at the merchant.** §6.5's template says "maintained by ShoperZero"
and links `{base}/s/{slug}/…`. Headings and order are kept verbatim; URLs point at the store's
own origin; the "maintained by", "Store page" and "All ShoperZero stores" lines are dropped.

**9.3 `payment_handlers: {}` while claiming checkout.** §6.6 couples the two ("one entry per
`enabledRails()`"). This store never takes a payment, and inventing a handler id that no rail
implements would be worse than an empty map, which §6.6 permits as "a required member, may be
empty". The `agent_checkout` check only requires `dev.ucp.shopping.checkout` to be declared,
so the A grade is unaffected.

**9.4 `ShopperZero` vs `ShoperZero` spelling left as-is.** The store spells the agent with two
p's in its robots.txt and UA regex; the specs use one. Accepted by the user for now. It does
not move either score: `ShoperZeroBot` simply falls through to `User-agent: *`, which allows
product URLs in both modes, and it still matches the before-mode bot gate's `/bot/i`.

**9.5 Image object key order taken from §6.1's example, not its table.** The two disagree on
where `updated_at` sits. The worked example is concrete, so it wins. Flagged here because it
is a genuine ambiguity in the source spec, worth raising with WS3.

## 10. Risks

| Risk | Handling |
|---|---|
| The 41/D pin is one point from F | `scoring.test.mjs` asserts the exact score and the two contributing checks; §5.2 keeps the sitemap `?pid=`-free |
| `productPath` change breaks `public/*.js` deep links | `Product-Variation` accepts both the old and new id forms; conformance test covers both |
| Spec 03's shapes are specified against `IndexedProduct`, not a merchant catalog | Fields the catalog cannot supply (`gtin`, `compare_at_price`, `weight`) are emitted as the spec's documented null/empty form, or omitted where the spec says to omit |
| WS3 later implements the serializers differently | `formats/*` names mirror `src/lib/formats/*` so a diff is easy; §9.5 records the one ambiguity found |
| Both modes now pass `api`, so `dom` and `computer_use` are never exercised here | Out of scope by §2. §10.1's `js-shop` fixture still does not exist; noted as a gap for WS2 |

## 11. Out of scope, recorded

- `infra/fixtures/js-shop/` (spec 02 §10.1) does not exist. The `computer_use` probe has no
  fixture until someone builds it. Not this work.
- `demo-stores/news/` (`The Northgate Chronicle`, PRD only) is untouched. Its PRD says to
  follow Provence's structure, so it should be built against the post-conformance store.
- `src/` is still the bare Next scaffold: no `src/lib/contracts`, `src/lib/crawl` or
  `src/lib/scan`. This design is written against the specs as written, since there is no
  implementation to test against yet.
