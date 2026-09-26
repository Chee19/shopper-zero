# 05 — Generic product extraction pipeline (unknown / custom / headless stores)

Research date: 2026-09-26. Scope: stores that have no known public catalog API. The goal is to turn any storefront into a normalized `products.json`-style index in our Supabase `products` table (see `supabase/migrations/20260926000000_init.sql`).

Anything not verified against a primary source today is marked **UNVERIFIED**.

---

## TL;DR

1. **Do it in tiers and stop at the first tier that works.** 0) platform probes (Shopify `/products.json`, WooCommerce Store API, Magento GraphQL; other docs cover these), 1) public feeds, 2) **sitemap + schema.org JSON-LD** (covers most stores; it is our default engine), 3) microdata/OpenGraph fallback, 4) hosted render/extract API for JS-only pages, 5) Claude LLM extraction as the last resort. Tiers 0-3 need only `fetch` + `cheerio` and cost almost nothing.
2. **JSON-LD `Product` / `ProductGroup` + `Offer` is the most useful signal.** Google Merchant listings push merchants to publish it, including variant support through `ProductGroup` + `hasVariant` / `variesBy` ([Google docs](https://developers.google.com/search/docs/appearance/structured-data/product-variants)). Write one solid parser that handles `@graph`, arrays, `AggregateOffer`, and `ProductGroup`.
3. **Discovery is robots.txt, then `Sitemap:` lines, then the sitemap index, then product sitemaps.** Filter URLs with platform-specific name patterns (`product-sitemap.xml`, `sitemap_products_1.xml`, `/p/`, `/product/`) and fall back to "fetch and check for `@type: Product`".
4. **Run it on Vercel Node route handlers driven by a Supabase Queue (pgmq), not in Supabase Edge Functions.** Edge Functions allow only **2 s of CPU per request** and 256 MB of memory ([limits](https://supabase.com/docs/guides/functions/limits)), and HTML parsing uses a lot of CPU. On Vercel with Fluid compute the default and Hobby maximum are 300 s, and Pro can go to 800 s ([Vercel](https://vercel.com/docs/functions/configuring-functions/duration)). Process pages in small batches (about 25 URLs per invocation) and re-enqueue the rest.
5. **LLM fallback:** use `claude-haiku-4-5` with native structured outputs (`output_config.format`, GA, no beta header, [docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)) on cleaned markdown. That costs about **$0.005-0.01/page** ($1/$5 per MTok), or half that with Batch. Use `claude-sonnet-5` ($2/$10 per MTok, [pricing](https://platform.claude.com/docs/en/about-claude/pricing)) only for hard pages. Never send raw HTML.
6. **Fastest hosted fallback to integrate is Firecrawl** (`firecrawl` npm v4.41; `/v2/map` = 1 credit per call, scrape = 1 credit, +4 for JSON-schema extraction; the free tier has 1,000 credits/month with 2 concurrent requests ([pricing](https://www.firecrawl.dev/pricing))). The **Jina Reader** (`r.jina.ai/<url>`, free without a key at about 20 RPM) is the cheapest way to get HTML-to-markdown. **Zyte `/v1/extract` with `product: true`** gives the best purpose-built product extraction, but setting it up takes longer.
7. **Incremental re-crawl:** use sitemap `<lastmod>` diffs, conditional GET (`ETag` / `If-Modified-Since`), and a content hash of the extracted JSON-LD. Re-fetch offer/price data more often (daily) than full content (weekly).
8. **Politeness and legal:** honor robots.txt, crawl-delay, and 1-2 req/s per host. Send an honest User-Agent with a contact URL. Scrape only public, logged-out pages. The legal risk is mostly contract/ToS, not the CFAA (see the Legal section).

---

## Details

### 1. Tiered pipeline and decision logic

```
            ┌─────────────────────────────────────────────────────────┐
 domain ──► │ T0 fingerprint + platform probes (cheap HEAD/GET)       │── hit ─► platform adapter (other docs)
            └─────────────────────────────────────────────────────────┘
                     │ miss
            ┌─────────────────────────────────────────────────────────┐
            │ T1 feeds: /products.json-like, Google/Meta feed URLs,   │── hit ─► parse feed → upsert
            │    RSS/Atom w/ g: namespace, <link rel=alternate>       │
            └─────────────────────────────────────────────────────────┘
                     │ miss
            ┌─────────────────────────────────────────────────────────┐
            │ T2 robots.txt → sitemaps → product URLs                 │
            │    fetch each URL (plain HTTP) → JSON-LD Product?       │── ≥60% of sampled pages parse ─► crawl all
            └─────────────────────────────────────────────────────────┘
                     │ JSON-LD missing
            ┌─────────────────────────────────────────────────────────┐
            │ T3 microdata / RDFa / OpenGraph product:* tags          │── has name+price ─► crawl all
            └─────────────────────────────────────────────────────────┘
                     │ empty HTML shell (SPA) or 403/challenge
            ┌─────────────────────────────────────────────────────────┐
            │ T4 render: Firecrawl / Jina / Browserbase(Playwright)   │── re-run T2/T3 on rendered HTML
            └─────────────────────────────────────────────────────────┘
                     │ still no structured data
            ┌─────────────────────────────────────────────────────────┐
            │ T5 LLM: markdown → Claude Haiku 4.5 structured output   │── validate (price>0, name) ─► upsert
            └─────────────────────────────────────────────────────────┘
```

**Decision rule. Probe once per store, then lock in a strategy.** Sample about 5 product URLs from the sitemap and run T2, then T3, then T4, then T5 on them. Choose the cheapest tier that returns `name` and `price` for at least 3 of the 5. Save the chosen tier to `stores.metadata.strategy` and `crawl_runs.strategy`, then crawl the full catalog with that tier only. Escalate a single URL only when the chosen tier fails on it.

**No sitemap?** Use Firecrawl `/v2/map` (1 credit per call no matter how many URLs come back; it combines sitemaps, SERP, and cached crawl data ([docs](https://docs.firecrawl.dev/features/map))). Otherwise, run a shallow BFS from the homepage and category pages, keeping links that match product-URL patterns.

#### T0 fingerprint (a few lines, cheap)
One GET of `/` gives enough signals to detect the platform:
- `meta[name=generator]` (WooCommerce, PrestaShop, Wix.com Website Builder, Squarespace).
- Asset hosts: `cdn.shopify.com`, `/wp-content/plugins/woocommerce/`, `static/version*/frontend/` (Magento), `cdn11.bigcommerce.com`, `static.wixstatic.com`, `static1.squarespace.com`.
- Cookies/headers: `PrestaShop-*`, `X-Magento-*`, `x-shopid` (Shopify), `set-cookie: SS_MID` (Squarespace).

Quick probes that return whole catalogs without authentication:
- `GET /products.json?limit=250&page=N` (Shopify).
- `GET /wp-json/wc/store/v1/products?per_page=100&page=N` (WooCommerce Store API, public by design).
- `POST /graphql` with a `products(search:"")` query (Magento 2 / Adobe Commerce; often open).
- `?format=json` on Squarespace commerce pages (**UNVERIFIED** whether it still works in 2026).

Platform-specific details are in the platform research docs. This doc covers the generic path.

#### T1 feeds
- **Google Merchant Center feeds have no standard public URL.** Merchants upload them or GMC fetches them from a private URL. Heuristics that sometimes work:
  - WooCommerce feed plugins: `/wp-content/uploads/woo-product-feed-pro/xml/*.xml`, `/?feed=...`, `/product-feed/`.
  - Magento: `/pub/media/feed/*.xml`.
  - Probing `/google-shopping.xml`, `/feed/google.xml`, `/products.xml`, `/feed.xml`.

  All of these are **UNVERIFIED** as general conventions: guessing costs a few 404s, so it is worth one pass in parallel.
- `<link rel="alternate" type="application/rss+xml">` on the homepage. Parse RSS/Atom items that carry `g:price` / `g:id` (the Google namespace `http://base.google.com/ns/1.0`).
- Treat a feed as the best possible source: it is complete, clean, and includes GTINs.

#### T2 sitemap + JSON-LD (main engine)
- robots.txt `Sitemap:` directives, then `/sitemap.xml`, then `/sitemap_index.xml`, then `/wp-sitemap.xml`.
- A sitemap index has `<sitemapindex><sitemap><loc>`. A URL set has `<urlset><url><loc><lastmod>`. Handle `.xml.gz` too: `DecompressionStream('gzip')` works in Node 18+.
- Product sitemap names by platform:
  - Yoast/Rank Math (Woo): `product-sitemap.xml`.
  - Shopify: `sitemap_products_1.xml`.
  - BigCommerce: `xmlsitemap.php?type=products`.
  - Magento: often one `sitemap.xml` with everything.
  - PrestaShop: `1_index_sitemap.xml`, then `1_en_0_sitemap.xml`.
- Use the image extension (`<image:image><image:loc>`) as a free image source.
- Limits: 50k URLs or 50 MB per sitemap file (sitemaps.org protocol).

### 2. schema.org extraction rules (what real sites emit)

JSON-LD (`<script type="application/ld+json">`) messiness to handle:
- The JSON may be an **array**, may use `@graph`, or may contain `Product` nested in `WebPage.mainEntity` / `ItemPage.mainEntity`.
- `@type` may be a string or an array (`["Product","Thing"]`), and may carry a full URL (`http://schema.org/Product`).
- `offers` may be an `Offer`, an array of `Offer`, or an **`AggregateOffer`** (`lowPrice` / `highPrice` / `offerCount`, sometimes with nested `offers`).
- `price` may be a number or a string (`"1,299.00"`, `"19.99"`). The price may sit only in `priceSpecification.price` (`UnitPriceSpecification`). Sale prices appear as multiple priceSpecifications with `priceType: https://schema.org/StrikethroughPrice` for the list price.
- `availability` usually looks like `https://schema.org/InStock`, `http://schema.org/OutOfStock`, `PreOrder`, `BackOrder`, `Discontinued`, `LimitedAvailability`, `SoldOut`, `OnlineOnly`, or `InStoreOnly`. Map by suffix.
- `image` may be a string, an array of strings, an `ImageObject` (`url` / `contentUrl`), or an array of those.
- `brand` may be a string or an object (`{ "@type": "Brand", "name": ... }`).
- Identifiers: `sku`, `mpn`, `gtin`, `gtin8`, `gtin12`, `gtin13`, `gtin14`, `productID`.
- **Variants:** `ProductGroup` (`productGroupID`, `variesBy`, `hasVariant[]`). Otherwise each variant `Product` has `isVariantOf` / `inProductGroupWithID`. Some sites emit multiple top-level `Product` nodes, one per variant. Google-supported `variesBy` values are color, size, suggestedAge, suggestedGender, material, and pattern ([docs](https://developers.google.com/search/docs/appearance/structured-data/product-variants)).
- Broken JSON is common: trailing commas, raw newlines in strings, HTML entities, and `<!-- -->` wrappers. Try `JSON.parse` first, then retry after stripping control characters and trailing commas. `json5` is an option but has not been updated since 2023.

Microdata / RDFa (older Magento and PrestaShop themes, some custom stores):
- `[itemtype$="schema.org/Product"]` scopes, `[itemprop=name|price|priceCurrency|sku|gtin13|availability|image]`. The value comes from `content`, `href`, or `src`, falling back to text.
- RDFa: `[typeof~="Product"]` / `[property="schema:price"]`. It is rare, so handle it only with the same selector trick.

OpenGraph product tags (weak but common):
- `og:type=product` (or `og:type=product.item`), `product:price:amount`, `product:price:currency`, `product:availability`, `product:brand`, `product:retailer_item_id`, `og:title`, `og:image`, `og:description`.
- Some stores use the older `og:price:amount`.

### 3. Libraries (Node/TS), checked on npm 2026-09-26

| Package | Version / last publish | Verdict |
|---|---|---|
| `cheerio` | 1.2.0 / 2026-07 | **USE.** HTML parsing and selectors. Fast, works in Node route handlers. |
| `fast-xml-parser` | 5.11.1 / 2026-08 | **USE** for sitemaps (small, no deps). |
| `robots-parser` | 3.0.1 / 2023-02 | **USE.** Stable, tiny, spec-complete, and needs no updates. |
| `p-queue` | 9.3.3 / 2026-07 | **USE** for per-host concurrency and interval caps. |
| `zod` | 4.6.5 / 2026-09 | **USE.** Normalized schema, plus the Claude `zodOutputFormat` helper. |
| `@anthropic-ai/sdk` | 0.128.0 / 2026-09 | **USE** for the LLM tier. |
| `firecrawl` (new name) / `@mendable/firecrawl-js` | 4.41.0 / 2026-09 | **USE** for map/render fallback. Both names are the same package. |
| `turndown` | 7.2.4 / 2026-04 | Use for HTML-to-markdown before the LLM (or use Jina Reader). |
| `linkedom` | 0.18.13 / 2026-07 | Optional. Use it if you need a DOM (for example, `@mozilla/readability`). |
| `schema-dts` | 2.0.0 / 2026-03 | Optional. Provides TS types for schema.org, useful for hints. |
| `sitemapper` | 4.1.6 / 2026-05 | OK, but it hides `lastmod` handling and gz edge cases. A hand-rolled parser (below) is about 40 lines. |
| `crawlee` | 3.18.1 / 2026-09 | Great for a long-running worker, but **SKIP on Vercel**: its heavy request-queue model conflicts with serverless. Revisit only with a separate worker (Fly/Railway). |
| `metascraper` | 5.58.1 / 2026-09 | **SKIP for products.** It does general link-preview metadata and has no maintained price rule (`metascraper-shopping` / `-price` are not on npm). |
| `@extractus/article-extractor` | 9.0.1 / 2026-08 | **SKIP.** It extracts articles, not products. |
| `web-auto-extractor` | 1.0.17 / 2022-06 | **SKIP.** Unmaintained. |
| `microdata-node` | 2.0.0 / 2022-06 | Avoid. Use the ~30-line cheerio microdata reader instead. |
| `playwright-core` + `@sparticuz/chromium` | 1.63.0 / 153.0.0 | Possible on Vercel, but cold starts are slow and the bundle is big. Prefer Browserbase or Firecrawl for rendering. |
| `@browserbasehq/sdk` / `@browserbasehq/stagehand` | 2.21.0 / 4.1.0 | Hosted Chrome over CDP. Use it if we need an interactive checkout later. |

### 4. Headless rendering and hosted extraction APIs

| Service | What you get | Free tier / price | Integration speed | Verdict |
|---|---|---|---|---|
| **Firecrawl** | `/v2/scrape` (markdown/html/`json` with schema), `/v2/map` (URL discovery), `/v2/crawl`, agent | Free: 1,000 credits/mo, 2 concurrent. Hobby $16/mo (5k), Standard $83/mo (100k), billed annually. Scrape/map/crawl = 1 credit/page (map = 1 per call); JSON format = +4 credits/page; stealth proxy costs extra ([pricing](https://www.firecrawl.dev/pricing), [map](https://docs.firecrawl.dev/features/map)) | **Fastest.** One SDK call; the schema-based `json` format replaces our T5 | **Primary T4 fallback.** Use `map` for stores with no sitemap. |
| **Jina Reader** | `GET https://r.jina.ai/<url>` returns clean markdown (renders JS) | No key: about 20 RPM. With a key: 10M free tokens, then pay-as-you-go (low cents per M tokens) ([jina.ai/reader](https://jina.ai/reader/); rates from third-party summaries, **UNVERIFIED** exact) | Zero-SDK `fetch` | **Use as a cheap markdown source for T5.** |
| **Zyte API** | `POST https://api.zyte.com/v1/extract` with `{"url","product":true,"productOptions":{"extractFrom":"httpResponseBody"}}`; returns `product{name,price,currency,sku,gtin,variants,availability,...}`, plus `productList` / `productNavigation` ([docs](https://docs.zyte.com/zyte-api/usage/extract/index.html)) | Pay-as-you-go, per-site tiered pricing, trial credit (**UNVERIFIED** amounts; see [pricing](https://www.zyte.com/pricing/)) | Easy (basic auth, one POST) | Best purpose-built product AI and anti-bot. Good plan B if Firecrawl is blocked. |
| **Diffbot** | Product API (auto-extracts product fields) | Free 10k credits/mo at 5 calls/min; Startup $299/mo ([pricing](https://www.diffbot.com/pricing)) | Easy | 5 calls/min on free is too slow for demos. Skip. |
| **ScrapingBee** | Proxy + JS render + `ai_extract_rules` | 1,000 free credits; JS render = 5x; plans from $49/mo (third-party summary) | Easy | Redundant with Firecrawl. Skip. |
| **Browserbase** | Hosted Chrome (Playwright/Puppeteer via CDP), Stagehand | Free: 1 browser-hour, 3 concurrent, 15-min sessions; Developer $20/mo (100 h) ([pricing](https://www.browserbase.com/pricing)) | Medium | Skip for extraction. Worth considering for the **checkout** track (agent driving a real checkout). |
| **Self-hosted Playwright** | Full control | Free | Slow on serverless (Chromium layer, cold starts) | Skip for the hackathon. |

### 5. LLM fallback extraction (T5)

- **Input:** never send raw HTML (30-150k tokens). Strip it first: remove `script`, `style`, `svg`, `nav`, `footer`, and `header`; keep `main`, `[itemprop]`, and the title/price regions; convert to markdown with turndown (or fetch `r.jina.ai`); truncate to about 12k characters. Also send any partial JSON-LD / OG tags as hints.
- **Models and pricing** ([pricing page](https://platform.claude.com/docs/en/about-claude/pricing)):
  - `claude-haiku-4-5`: $1 in / $5 out per MTok. Batch is 50% off. Cache reads cost 0.1x.
  - `claude-sonnet-5`: $2 / $10 per MTok. The intro price was made permanent. Sonnet 5 uses the newer tokenizer, which produces about 30% more tokens for the same text.
- **Per page (~4k input, ~400 output tokens):**
  - Haiku 4.5 ≈ $0.004 + $0.002 = **~$0.006/page**. Batch ≈ $0.003. 1,000 pages ≈ $6.
  - Sonnet 5 ≈ (5.2k × $2 + 520 × $10)/1M ≈ **~$0.016/page**.
  - Cache the system prompt and schema (1.25x write, 0.1x read) to trim input costs further.
- **Structured output (GA):** `client.messages.parse({ model, max_tokens, output_config: { format: zodOutputFormat(Schema) }, messages })`, importing from `@anthropic-ai/sdk/helpers/zod` ([docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)). Schema limits: no `minimum` / `maxLength` / `pattern` (the SDK moves them into field descriptions), and no recursion.
- **Guardrails:** require `name` and `url`. `price` must be a number or null (**never** guessed). Include `confidence`, and add an instruction: "return null if not present on the page". Reject results where the price is not present as a string in the source markdown. This is a cheap hallucination check.
- **Listing pages:** ask for `products[]` with name, url, and price to seed discovery on stores without sitemaps. Zyte's `productList` does the same thing.

### 6. Running it inside Next.js 16 + Supabase

Constraints (verified):
- **Vercel functions (Fluid compute, default on):**
  - Default and Hobby maximum: 300 s.
  - Pro/Enterprise maximum: 800 s, with an optional 1,800 s beta.
  - Set it per route with `export const maxDuration = 300` (App Router route segment config; see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`).
  - Fluid compute bills CPU only while code executes, so I/O-bound crawling is cheap ([Vercel](https://vercel.com/docs/functions/configuring-functions/duration)).
- **`after()` from `next/server`** runs work after the response within the route's `maxDuration`. It works for "kick off crawl, return 202" (see `.../04-functions/after.md`).
- **Supabase Edge Functions:** 256 MB memory, **2 s CPU per request**, wall clock 150 s (Free) / 400 s (paid), 150 s request idle timeout ([limits](https://supabase.com/docs/guides/functions/limits)). Fine as a thin cron trigger, but a poor fit for cheerio parsing of hundreds of pages.
- **Supabase Queues = `pgmq`.** Enable it in the Dashboard (Integrations, then Queues) and expose it through the `pgmq_public` schema. RPCs:
  - `send(queue_name, message jsonb, sleep_seconds)`
  - `send_batch(queue_name, messages jsonb[], sleep_seconds)`
  - `read(queue_name, sleep_seconds /*visibility timeout*/, n)`
  - `pop`, `archive(queue_name, message_id)`, `delete(queue_name, message_id)`

  ([API](https://supabase.com/docs/guides/queues/api)). From supabase-js, call `supabase.schema('pgmq_public').rpc('read', {...})` with the service-role client. The docs example omits `.schema(...)`, and you need it unless `pgmq_public` is on the exposed schemas' default path.
- **`pg_cron` + `pg_net`** can call an HTTP endpoint on a schedule ([Supabase](https://supabase.com/docs/guides/functions/schedule-functions)). Point it at the Vercel route, not an Edge Function.

**Recommended topology:**

```
UI / agent ── POST /api/stores {domain} ──► route: insert stores row, pgmq send('discover', {storeId})
                                                 └─ after(): immediately call /api/worker once (don't wait for cron)
pg_cron (every 1 min) ── pg_net.http_post ──► POST /api/worker  (Authorization: Bearer CRON_SECRET)
/api/worker (maxDuration 300):
    loop until 240s elapsed:
      msgs = read('crawl', vt=120, n=25)
      handle by type:
        discover  → T0/T1 probes, sitemap walk → send_batch('crawl', [{type:'page', url}...]), decide strategy on sample
        page      → fetch (per-host p-queue, 1–2 rps) → extract by tier → upsert products → delete(msg)
        failure   → leave it; message reappears after vt; after 3 tries archive + log to crawl_runs.error
      if more msgs remain → self-invoke fetch('/api/worker') via after() (fan-out chain)
```

- Use one queue with a `type` field (`crawl`) to keep it simple.
- Keep a per-host concurrency map in memory. For cross-invocation politeness, store `stores.metadata.next_allowed_at`, or use a per-host batch in which one message contains 25 URLs of the same host.
- Upsert uses `onConflict: 'store_id,url'`. The unique constraint already exists in the init migration.
- Local dev needs no cron: just `curl -X POST localhost:3000/api/worker` in a loop, or have the POST route process the first 20 URLs synchronously so the demo is instant.

### 7. Incremental re-crawl

1. **Sitemap diffing.** Store `lastmod` per URL, for example in `products.raw.lastmod` or a small `crawl_urls` table (`store_id`, `url`, `lastmod`, `etag`, `last_modified`, `content_hash`, `next_fetch_at`, `fail_count`). On re-crawl, re-fetch only URLs that are new or have a changed `lastmod`. Mark URLs missing from the sitemap as `availability='unknown'` or soft-delete them after N misses.
2. **Conditional GET.** Send `If-None-Match` / `If-Modified-Since`. A 304 means skip (many CDNs support it).
3. **Content hash.** Hash the normalized extraction. If it is unchanged, update only a `last_seen_at` timestamp and skip the write (this avoids `updated_at` churn).
4. **Tiered freshness.** Price and availability change fast, content slowly:
   - T2 stores: refresh everything daily, since it is cheap.
   - T4/T5 stores: refresh price weekly and content monthly.
   - Always re-verify a single product live immediately before checkout (a single fetch plus the same parser). This is critical for the agent checkout flow: never charge an indexed price without a live check.
5. **Backoff:** `next_fetch_at = now + base × 2^fail_count`. After 429/503, honor `Retry-After`.

### 8. Politeness and legal (short)

- **Honor robots.txt** (`robots-parser`: `isAllowed(url, UA)`, `getCrawlDelay(UA)`) and crawl-delay. Default to 1-2 req/s per host and no more than 4 concurrent requests. Use `User-Agent: ShoperZeroBot/0.1 (+https://<our-domain>/bot)`. Respect `X-Robots-Tag: noindex`, and treat `noai` as an opt-out signal.
- **hiQ v. LinkedIn (9th Cir. 2022):** scraping publicly accessible data is likely *not* "without authorization" under the CFAA. But hiQ ultimately **lost on breach of contract** (ToS) and settled in Dec 2022. **Meta v. Bright Data (N.D. Cal. 2024):** scraping logged-out public pages did not breach Meta's terms. Takeaway: stay logged-out, stay public, and do not accept ToS through clickwrap.
- **Risk areas:** copyrighted descriptions and images (store a link or excerpt and hot-link images rather than re-hosting them), GDPR if we touch reviews containing personal data, and anti-circumvention. Do not defeat CAPTCHAs or bot challenges ourselves; if a store challenges us, mark it `blocked` and offer the merchant an opt-in.
- **Best positioning:** make it merchant opt-in ("claim your store, we make it agent-ready"). Crawling is the zero-touch fallback.

---

## Code sketches (TS, Node runtime route handlers)

### A. Normalized product shape (matches `public.products`)

```ts
// src/lib/extract/types.ts
import { z } from "zod";

export const Availability = z.enum(["in_stock", "out_of_stock", "preorder", "unknown"]);

export const Variant = z.object({
  sku: z.string().nullable(),
  gtin: z.string().nullable(),
  title: z.string().nullable(),
  price: z.number().nullable(),
  currency: z.string().nullable(),
  availability: Availability,
  options: z.record(z.string(), z.string()), // { color: "blue", size: "M" }
  url: z.string().nullable(),
  image: z.string().nullable(),
});

export const NormalizedProduct = z.object({
  url: z.string(),
  external_id: z.string().nullable(),   // productGroupID ?? sku ?? productID
  title: z.string(),
  description: z.string().nullable(),
  brand: z.string().nullable(),
  price: z.number().nullable(),          // lowest in-stock variant/offer price
  currency: z.string().nullable(),
  availability: Availability,
  images: z.array(z.string()),
  variants: z.array(Variant),
  gtin: z.string().nullable(),
  source: z.enum(["platform_api", "feed", "jsonld", "microdata", "opengraph", "render", "llm"]),
});
export type NormalizedProduct = z.infer<typeof NormalizedProduct>;
```

### B. Polite fetch + robots + sitemap discovery

```ts
// src/lib/extract/discover.ts
import "server-only";
import robotsParser from "robots-parser";
import { XMLParser } from "fast-xml-parser";

export const UA = "ShoperZeroBot/0.1 (+https://shoperzero.example/bot)";
const xml = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true });

export async function politeFetch(url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", ...init.headers },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  return res;
}

async function readBody(res: Response, url: string): Promise<string> {
  const gz = url.endsWith(".gz") || res.headers.get("content-type")?.includes("gzip");
  if (gz && res.body) {
    // Only needed when served as a raw .gz file (Content-Encoding gzip is auto-decoded by fetch)
    const stream = res.body.pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  }
  return res.text();
}

export async function getRobots(origin: string) {
  const url = `${origin}/robots.txt`;
  const res = await politeFetch(url).catch(() => null);
  const body = res?.ok ? await res.text() : "";
  return robotsParser(url, body); // .isAllowed(u, UA), .getCrawlDelay(UA), .getSitemaps()
}

const PRODUCT_SITEMAP_HINT = /product|prod_|sitemap_products|type=products|catalog/i;
const PRODUCT_URL_HINT = /\/(products?|p|item|shop|dp|catalog\/product)\/|[-_/]p\d+|\.html$/i;

export type SitemapUrl = { loc: string; lastmod?: string; image?: string };

/** robots → sitemaps → recurse indexes → url entries. Prefers product sitemaps. */
export async function discoverProductUrls(origin: string, max = 5000): Promise<SitemapUrl[]> {
  const robots = await getRobots(origin);
  let roots = robots.getSitemaps();
  if (roots.length === 0) roots = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`];

  const seen = new Set<string>();
  const queue = [...roots];
  const all: SitemapUrl[] = [];

  while (queue.length && all.length < max && seen.size < 200) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    const res = await politeFetch(sm).catch(() => null);
    if (!res?.ok) continue;
    const doc = xml.parse(await readBody(res, sm));

    if (doc.sitemapindex) {
      const children = ([] as any[]).concat(doc.sitemapindex.sitemap ?? []).map((s) => String(s.loc).trim());
      // product sitemaps first; skip obvious non-product ones (posts, pages, categories, authors)
      const prod = children.filter((u) => PRODUCT_SITEMAP_HINT.test(u));
      const rest = children.filter((u) => !PRODUCT_SITEMAP_HINT.test(u) && !/post|page|categor|tag|author|blog|cms/i.test(u));
      queue.unshift(...prod);
      queue.push(...(prod.length ? [] : rest));
    } else if (doc.urlset) {
      for (const u of ([] as any[]).concat(doc.urlset.url ?? [])) {
        const loc = String(u.loc ?? "").trim();
        if (!loc || !robots.isAllowed(loc, UA)) continue;
        const image = u.image ? ([] as any[]).concat(u.image)[0]?.loc : undefined;
        all.push({ loc, lastmod: u.lastmod, image });
      }
    }
  }
  // If a sitemap wasn't product-specific, filter by URL shape; caller verifies via JSON-LD sampling.
  const productish = all.filter((u) => PRODUCT_URL_HINT.test(u.loc));
  return (productish.length > 10 ? productish : all).slice(0, max);
}
```

### C. JSON-LD / microdata / OpenGraph → NormalizedProduct

```ts
// src/lib/extract/structured.ts
import "server-only";
import * as cheerio from "cheerio";
import type { NormalizedProduct } from "./types";

type Node = Record<string, any>;
const arr = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const typeOf = (n: Node) => arr(n?.["@type"]).map((t) => String(t).replace(/^https?:\/\/schema\.org\//, ""));
const isType = (n: Node, t: string) => typeOf(n).includes(t);

function safeJson(text: string): any {
  const t = text.replace(/^\s*<!--|-->\s*$/g, "").trim();
  try { return JSON.parse(t); } catch {}
  try { return JSON.parse(t.replace(/[\u0000-\u001F]+/g, " ").replace(/,\s*([}\]])/g, "$1")); } catch { return null; }
}

/** Flatten @graph / arrays / mainEntity into a list of nodes. */
function collectNodes(root: any, out: Node[] = []): Node[] {
  for (const n of arr(root)) {
    if (!n || typeof n !== "object") continue;
    out.push(n);
    if (n["@graph"]) collectNodes(n["@graph"], out);
    if (n.mainEntity) collectNodes(n.mainEntity, out);
    if (n.itemListElement) collectNodes(arr(n.itemListElement).map((e: any) => e.item ?? e), out);
  }
  return out;
}

const num = (v: any): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  let s = String(v).replace(/[^\d.,-]/g, "");
  // "1.299,00" (EU) vs "1,299.00" (US)
  if (/,\d{2}$/.test(s) && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

const avail = (v: any): NormalizedProduct["availability"] => {
  const s = String(v ?? "").split("/").pop()?.toLowerCase() ?? "";
  if (["instock", "limitedavailability", "onlineonly", "instoreonly", "in_stock"].includes(s)) return "in_stock";
  if (["preorder", "presale", "backorder"].includes(s)) return "preorder";
  if (["outofstock", "soldout", "discontinued", "out_of_stock"].includes(s)) return "out_of_stock";
  return "unknown";
};

const img = (v: any): string[] =>
  arr(v).map((i: any) => (typeof i === "string" ? i : i?.url ?? i?.contentUrl)).filter(Boolean);

const brandName = (b: any) => (typeof b === "string" ? b : arr(b)[0]?.name ?? null);
const gtinOf = (n: Node) => n.gtin ?? n.gtin13 ?? n.gtin12 ?? n.gtin14 ?? n.gtin8 ?? null;

function offerInfo(offers: any) {
  // Returns lowest price + currency + availability across Offer | Offer[] | AggregateOffer
  let best: { price: number | null; currency: string | null; availability: NormalizedProduct["availability"] } =
    { price: null, currency: null, availability: "unknown" };
  for (const o of arr(offers)) {
    const inner = isType(o, "AggregateOffer") && o.offers ? arr(o.offers) : [o];
    for (const x of inner) {
      const spec = arr(x.priceSpecification).find((p: any) => !String(p.priceType ?? "").includes("Strikethrough"));
      const price = num(x.price ?? x.lowPrice ?? spec?.price);
      const currency = x.priceCurrency ?? spec?.priceCurrency ?? o.priceCurrency ?? null;
      const a = avail(x.availability ?? o.availability);
      if (price != null && (best.price == null || price < best.price)) best = { price, currency, availability: a };
      else if (best.availability === "unknown") best.availability = a;
    }
  }
  return best;
}

function variantFrom(p: Node, variesBy: string[]) {
  const o = offerInfo(p.offers);
  const options: Record<string, string> = {};
  for (const k of variesBy.length ? variesBy : ["color", "size", "material", "pattern"]) {
    const key = k.replace(/^https?:\/\/schema\.org\//, "");
    if (p[key] != null) options[key] = String(typeof p[key] === "object" ? p[key].name ?? "" : p[key]);
  }
  return {
    sku: p.sku ?? null, gtin: gtinOf(p), title: p.name ?? null,
    price: o.price, currency: o.currency, availability: o.availability,
    options, url: p.url ?? arr(p.offers)[0]?.url ?? null, image: img(p.image)[0] ?? null,
  };
}

export function fromJsonLd(html: string, pageUrl: string): NormalizedProduct | null {
  const $ = cheerio.load(html);
  const nodes: Node[] = [];
  $('script[type="application/ld+json"]').each((_, el) => collectNodes(safeJson($(el).text() ?? ""), nodes));

  const group = nodes.find((n) => isType(n, "ProductGroup"));
  const products = nodes.filter((n) => isType(n, "Product"));
  if (!group && products.length === 0) return null;

  const main = group ?? products.find((p) => !p.isVariantOf) ?? products[0];
  const variesBy = arr(group?.variesBy).map(String);
  const variantNodes = group ? arr(group.hasVariant) : products.length > 1 ? products : [];
  const variants = variantNodes.map((v) => variantFrom(v, variesBy));
  const mainOffer = offerInfo(main.offers);

  const priced = variants.filter((v) => v.price != null);
  const inStock = priced.filter((v) => v.availability === "in_stock");
  const cheapest = (inStock.length ? inStock : priced).sort((a, b) => a.price! - b.price!)[0];

  return {
    url: main.url ? new URL(main.url, pageUrl).href : pageUrl,
    external_id: main.productGroupID ?? main.sku ?? main.productID ?? main.mpn ?? null,
    title: String(main.name ?? "").trim(),
    description: main.description ? String(main.description).slice(0, 5000) : null,
    brand: brandName(main.brand),
    price: cheapest?.price ?? mainOffer.price,
    currency: cheapest?.currency ?? mainOffer.currency,
    availability: variants.length
      ? (variants.some((v) => v.availability === "in_stock") ? "in_stock" : variants[0].availability)
      : mainOffer.availability,
    images: [...new Set([...img(main.image), ...variants.map((v) => v.image).filter(Boolean) as string[]])],
    variants,
    gtin: gtinOf(main),
    source: "jsonld",
  };
}

/** Microdata + OpenGraph fallback (T3). */
export function fromMicrodataOrOg(html: string, pageUrl: string): NormalizedProduct | null {
  const $ = cheerio.load(html);
  const scope = $('[itemscope][itemtype*="schema.org/Product"]').first();
  const prop = (name: string, ctx = scope) => {
    const el = ctx.find(`[itemprop="${name}"]`).first();
    return el.attr("content") ?? el.attr("href") ?? el.attr("src") ?? (el.text().trim() || null);
  };
  const og = (p: string) => $(`meta[property="${p}"]`).attr("content") ?? $(`meta[name="${p}"]`).attr("content") ?? null;

  const title = (scope.length && prop("name")) || og("og:title");
  const price = num((scope.length && prop("price")) || og("product:price:amount") || og("og:price:amount"));
  if (!title || (price == null && og("og:type") !== "product")) return null;

  return {
    url: pageUrl,
    external_id: (scope.length && (prop("sku") || prop("productID"))) || og("product:retailer_item_id"),
    title,
    description: (scope.length && prop("description")) || og("og:description"),
    brand: (scope.length && prop("brand")) || og("product:brand"),
    price,
    currency: (scope.length && prop("priceCurrency")) || og("product:price:currency") || og("og:price:currency"),
    availability: avail((scope.length && prop("availability")) || og("product:availability")),
    images: [((scope.length && prop("image")) || og("og:image"))].filter(Boolean) as string[],
    variants: [],
    gtin: (scope.length && (prop("gtin13") || prop("gtin"))) || null,
    source: scope.length ? "microdata" : "opengraph",
  };
}

/** Heuristic: SPA shell / bot wall → escalate to render tier. */
export function looksUnrendered(html: string, status: number) {
  if ([403, 429, 503].includes(status)) return true;
  if (/cf-chl|captcha|px-captcha|_Incapsula_|datadome/i.test(html)) return true;
  const text = cheerio.load(html)("body").text().replace(/\s+/g, " ");
  return text.length < 500; // almost-empty body = client-rendered
}
```

### D. LLM fallback (T5) with Claude structured outputs

```ts
// src/lib/extract/llm.ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const client = new Anthropic(); // ANTHROPIC_API_KEY

const LlmProduct = z.object({
  is_product_page: z.boolean(),
  title: z.string().nullable(),
  brand: z.string().nullable(),
  description: z.string().nullable(),
  price: z.number().nullable().describe("Current selling price as shown. null if not visible. Never guess."),
  currency: z.string().nullable().describe("ISO 4217 code"),
  availability: z.enum(["in_stock", "out_of_stock", "preorder", "unknown"]),
  sku: z.string().nullable(),
  gtin: z.string().nullable(),
  images: z.array(z.string()),
  variants: z.array(z.object({ title: z.string(), price: z.number().nullable(), sku: z.string().nullable(), options: z.array(z.object({ name: z.string(), value: z.string() })) })),
});

export async function llmExtract(markdown: string, url: string, hints: object = {}) {
  const res = await client.messages.parse({
    model: "claude-haiku-4-5", // escalate to "claude-sonnet-5" on low-confidence/failed validation
    max_tokens: 1500,
    system: "You extract e-commerce product data from a web page. Only use facts present in the page text. Use null when absent.",
    output_config: { format: zodOutputFormat(LlmProduct) },
    messages: [{ role: "user", content: `URL: ${url}\nHints: ${JSON.stringify(hints)}\n\nPAGE:\n${markdown.slice(0, 12_000)}` }],
  });
  const p = res.parsed_output; // verify helper field name against SDK 0.128 typings
  if (!p?.is_product_page || !p.title) return null;
  // Anti-hallucination: the price must literally appear in the page
  if (p.price != null && !markdown.includes(String(p.price).replace(/\.0+$/, ""))) p.price = null;
  return p;
}
```

(`parsed_output` is the SDK's parsed field name per current docs. **Confirm it in the SDK typings** when you wire this up.)

### E. Worker route handler (queue consumer)

```ts
// src/app/api/worker/route.ts
import { after } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 300;
export const runtime = "nodejs";

export async function POST(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response("no", { status: 401 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const q = sb.schema("pgmq_public");
  const deadline = Date.now() + 240_000;
  let processed = 0;

  while (Date.now() < deadline) {
    const { data: msgs } = await q.rpc("read", { queue_name: "crawl", sleep_seconds: 120, n: 10 });
    if (!msgs?.length) break;
    await Promise.all(msgs.map(async (m: any) => {
      try {
        await handle(m.message, sb);            // discover | page  (dispatch to tiers)
        await q.rpc("delete", { queue_name: "crawl", message_id: m.msg_id });
      } catch (e) {
        if (m.read_ct >= 3) await q.rpc("archive", { queue_name: "crawl", message_id: m.msg_id });
      }
      processed++;
    }));
  }
  if (processed > 0) after(() => fetch(new URL("/api/worker", req.url), { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
  return Response.json({ processed });
}
declare function handle(msg: any, sb: any): Promise<void>;
```

Note: the parallel `Promise.all` above ignores per-host politeness. For real crawls, group messages by host and use `p-queue` with `{ concurrency: 2, intervalCap: 2, interval: 1000 }` per host.

SQL to enable the queue (the teammate adds this to a migration):

```sql
create extension if not exists pgmq;
select pgmq.create('crawl');
-- Supabase Dashboard > Integrations > Queues > "Expose Queues via PostgREST" creates the pgmq_public schema/RPCs.
-- Optional cron (needs pg_cron + pg_net, secrets via Vault):
-- select cron.schedule('crawl-worker', '* * * * *', $$ select net.http_post(
--   url := 'https://<app>.vercel.app/api/worker',
--   headers := jsonb_build_object('Authorization','Bearer <CRON_SECRET>')) $$);
```

---

## Concrete recommendations for the hackathon build

1. **Build T2 + T3 first** (sections B and C: about 250 lines, dependencies `cheerio`, `fast-xml-parser`, `robots-parser`, `p-queue`, `zod`). This alone indexes most WooCommerce, Magento, BigCommerce, PrestaShop, Wix, Squarespace, and custom stores that care about Google Shopping.
2. **Demo path is synchronous:** `POST /api/stores {domain}` discovers up to 50 product URLs, fetches them with concurrency 4, parses, upserts, and returns the count. It fits easily inside 300 s. Add the pgmq worker only once the demo works.
3. **Add Firecrawl as the single T4 and T5 combined:** `firecrawl.scrape(url, { formats: [{ type: "json", schema }] })` (5 credits/page), plus `firecrawl.map()` for stores with no sitemap. The free 1,000 credits are enough for demos. Keep our own Claude T5 (section D) as the cheaper path at scale, or if Firecrawl limits bite.
4. **Store everything raw.** Put the full JSON-LD node(s) in `products.raw` so we can re-normalize later without re-crawling.
5. **Add small schema tweaks** (for the teammate owning migrations):
   - `products.gtin text`, `products.sku text`, `products.source text`, `products.content_hash text`, `products.last_seen_at timestamptz`.
   - A `crawl_urls` table for lastmod/etag diffing.
   - Keep `stores.metadata.strategy`.
6. **Pick 3 demo stores we have verified** that are non-Shopify, have JSON-LD, and do not return 403 (one WooCommerce, one Magento/BigCommerce, one custom). Test them early. Cloudflare-protected stores will 403 our Vercel IPs.
7. **Do a live re-verify before checkout.** The checkout agent calls `GET /api/products/:id/verify`, which re-fetches the page, re-parses, and returns the current price and availability. Cache for 60 s.
8. **Skip:** Crawlee, self-hosted Playwright, Diffbot, ScrapingBee, metascraper, and web-auto-extractor.

## Open questions / risks

- **Bot walls** (Cloudflare Bot Management, DataDome, PerimeterX/HUMAN, Akamai) will block Vercel datacenter IPs on many mid- and large-size stores. Firecrawl stealth or Zyte handles some of them at a higher price. We should not build our own evasion (legal and ethical exposure).
- **Variants on custom stores** are often only in JS state (`window.__INITIAL_STATE__`, `__NEXT_DATA__`, Magento `jsonConfig` / `spConfig`). A cheap win: regex out `<script id="__NEXT_DATA__">` and hand it to the LLM as hints. **UNVERIFIED** how often this beats JSON-LD.
- **Currency and locale:** multi-currency stores serve prices based on geo-IP. Our Vercel region sets the currency we see. Record `currency` per product and do not convert.
- **Price accuracy vs checkout:** JSON-LD sometimes lags the displayed price (for example, cart-level discounts). That is why the live verify is mandatory before paying.
- **Google Merchant feed URLs** are not publicly discoverable in general. The T1 feed probe is best-effort.
- **Legal posture:** crawling without consent is defensible for public, logged-out pages but may breach some ToS. The merchant opt-in path ("claim your store") would be a better pitch and much lower risk.
- **Vercel Hobby cap of 300 s** and the Supabase Free Edge Function limits of 150 s wall clock and 2 s CPU mean long crawls must be chunked through the queue.
- **Standards overlap:** other research tracks cover agent-commerce catalog specs (OpenAI/Stripe ACP product feed, Google UCP, llms.txt). Our normalized shape should map cleanly onto whichever one we expose. Confirm the field names with the checkout/protocol doc owner.

## Sources

- Google, Product variants structured data (ProductGroup, hasVariant, variesBy): https://developers.google.com/search/docs/appearance/structured-data/product-variants
- Supabase Edge Function limits (256 MB, 2 s CPU, 150/400 s wall clock): https://supabase.com/docs/guides/functions/limits
- Supabase Queues overview and pgmq_public API: https://supabase.com/docs/guides/queues, https://supabase.com/docs/guides/queues/api
- Supabase scheduling functions with pg_cron + pg_net: https://supabase.com/docs/guides/functions/schedule-functions
- Vercel function max duration (300 s default and Hobby; 800 s Pro; 1,800 s beta): https://vercel.com/docs/functions/configuring-functions/duration
- Next.js 16 local docs: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`, `.../04-functions/after.md`
- Claude pricing (Haiku 4.5 $1/$5, Sonnet 5 $2/$10, Batch 50%): https://platform.claude.com/docs/en/about-claude/pricing
- Claude structured outputs (`output_config.format`, `zodOutputFormat`, GA): https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Firecrawl pricing: https://www.firecrawl.dev/pricing. Firecrawl map: https://docs.firecrawl.dev/features/map
- Zyte API automatic extraction: https://docs.zyte.com/zyte-api/usage/extract/index.html. Zyte pricing: https://www.zyte.com/pricing/
- Jina Reader: https://jina.ai/reader/
- Diffbot pricing: https://www.diffbot.com/pricing
- Browserbase pricing: https://www.browserbase.com/pricing
- ScrapingBee: https://www.scrapingbee.com/ (pricing via third-party summaries)
- npm registry (versions checked 2026-09-26 with `npm view`): cheerio, fast-xml-parser, robots-parser, p-queue, zod, @anthropic-ai/sdk, firecrawl, crawlee, metascraper, sitemapper, web-auto-extractor, microdata-node, linkedom, playwright-core, @sparticuz/chromium, @browserbasehq/sdk, @browserbasehq/stagehand
- Legal: hiQ Labs v. LinkedIn, 31 F.4th 1180 (9th Cir. 2022) and the Dec 2022 settlement; Meta Platforms v. Bright Data (N.D. Cal., Jan 2024). Summarized from prior knowledge, not re-fetched today (**UNVERIFIED** for 2026 developments).
- sitemaps.org protocol (50k URLs / 50 MB limits): https://www.sitemaps.org/protocol.html
