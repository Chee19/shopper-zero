# 06 · Agent-facing index and discoverability

How agents find and use the ShoperZero index. Researched 2026-09-26. Every claim marked **VERIFIED LIVE** was checked against a real endpoint today; **UNVERIFIED** means I could not confirm it from a primary source.

---

## TL;DR

1. **Shopify `/products.json` is the de-facto scan format, and we should copy it field for field** (VERIFIED LIVE on allbirds.com). The shape is `{products:[{id,title,handle,body_html,published_at,created_at,updated_at,vendor,product_type,tags[],variants[],images[],options[]}]}`. Prices are **decimal strings** (`"25.00"`). Pagination uses `?limit=` (max 250) and `?page=N`.
2. **Shopify has moved agents onto UCP (Universal Commerce Protocol).** Every Shopify store now serves **`/.well-known/ucp`** (current version **`2026-08-25`**) and an MCP endpoint at **`POST /api/ucp/mcp`** with 14 tools: `search_catalog`, `lookup_catalog`, `get_product`, `create_cart`, `get_cart`, `update_cart`, `cancel_cart`, `create_checkout`, `get_checkout`, `update_checkout`, `complete_checkout`, `cancel_checkout`, `get_order`. VERIFIED LIVE by `tools/list` on weareallbirds.myshopify.com.
3. **Our strongest move is to become "UCP for non-Shopify stores".** Serve a UCP business profile and a UCP-shaped MCP server (same tool names and argument shapes) for each indexed store. Any agent that already speaks Shopify/UCP then works against WooCommerce, Magento and the rest through us, with no new integration.
4. **Keep three formats from one normalized DB:** (a) Shopify-compatible `products.json` for scanners, (b) an ACP product feed (JSONL) for ChatGPT-style ingestion, (c) UCP/MCP tools for interactive agents. Add `llms.txt` per store as the human-readable entry point. Shopify's own `llms.txt` is now an agent instruction sheet that points at UCP (VERIFIED LIVE).
5. **MCP in Next 16:** use **`mcp-handler@2.2.0`** with **`@modelcontextprotocol/server@2.1.0`** and **`zod@4`**. `@vercel/mcp-adapter` is legacy (0.3.2). v2 uses `server.registerTool(name, {inputSchema: z.object(...)}, handler)` and a single `app/api/mcp/route.ts` exporting `GET` and `POST`. Versions VERIFIED on the npm registry.
6. **Search:** use Supabase hybrid search (a `tsvector` generated column with GIN, plus `pgvector` HNSW, fused with RRF in a SQL function called through `supabase.rpc`). Embed with **OpenAI `text-embedding-3-small` at `dimensions: 512`** ($0.02 per 1M tokens, so 100k products cost about $0.40). Put filters (store, price in minor units, availability, brand, category) inside the SQL function.
7. **Discovery files worth shipping:** `/.well-known/ucp` (real and in use), `/llms.txt`, `/openapi.json` (GPT Actions), `/.well-known/agent-card.json` (A2A, cheap), and `robots.txt` with `Content-Signal:`. **Skip** `ai-plugin.json` (dead). Serve an MCP Server Card only as a best-effort extra: SEP-2127 is **still an open PR** and its path is not settled.
8. **Gotcha found live:** Shopify's UCP MCP rejects calls unless `meta.ucp-agent.profile` is a **fetchable URL**. It returned `-32001 "UCP discovery failed" / profile_unreachable`. If we proxy to Shopify, or copy their strictness, we must host our own agent profile JSON. For our own server, accept `meta` as optional.

---

## Details

### 1. Shopify compatibility baseline (VERIFIED LIVE)

Fetched `https://www.allbirds.com/products.json?limit=1`, `/products/{handle}.json`, `/products/{handle}.js` and `/collections/all/products.json`.

**`GET /products.json?limit=250&page=N`**, also `/collections/{handle}/products.json` (same shape):
```jsonc
{ "products": [ {
  "id": 7340901859408, "title": "Women's Allbirds Flip Flop - Dusty Pink",
  "handle": "womens-allbirds-flip-flop-dusty-pink", "body_html": "<p>…</p>",
  "published_at": "2026-09-25T16:58:13-07:00", "created_at": "…", "updated_at": "…",
  "vendor": "Allbirds", "product_type": "Shoes", "tags": ["…"],
  "variants": [ { "id": 42146889039952, "title": "5", "option1": "5", "option2": null, "option3": null,
      "sku": "A12513W050", "requires_shipping": true, "taxable": true, "featured_image": null,
      "available": false, "price": "25.00", "grams": 455, "compare_at_price": "50.00",
      "position": 1, "product_id": 7340901859408, "created_at": "…", "updated_at": "…" } ],
  "images": [ { "id": 1, "created_at": "…", "position": 1, "updated_at": "…", "product_id": 7340901859408,
      "variant_ids": [], "src": "https://cdn.shopify.com/…", "width": 2000, "height": 2000 } ],
  "options": [ { "name": "Size", "position": 1, "values": ["5","6","7"] } ]
} ] }
```
- `tags` is an **array** in the current response (older stores returned a comma string, so accept both when parsing).
- **`GET /products/{handle}.json`** wraps the product in `{"product": {...}}` and adds `template_suffix`, `published_scope`, `image` (the featured image) and more variant fields: `inventory_policy`, `inventory_management`, `barcode`, `weight`, `weight_unit`, `inventory_quantity`, `price_currency`, `compare_at_price_currency`, `image_id`, `tax_code`, `quantity_rule`. Note that it does **not** carry `available`.
- **`GET /products/{handle}.js`** is the theme AJAX shape. Prices are **integers in cents** (`price: 2500`), with `price_min`, `price_max`, `available`, `url`, `media` and `featured_image`.
- **Our compat rule:** emit the `/products.json` shape exactly, with numeric ids generated from a bigint sequence (Shopify clients expect numbers) and decimal-string prices. Put anything extra under a namespaced key such as `"_shoperzero": { store_domain, source_url, currency, gtin, brand, platform }` so strict clients don't break.

### 2. Shopify Storefront Catalog MCP / UCP MCP (VERIFIED LIVE)

- Endpoint: `POST https://{shop}/api/ucp/mcp` (JSON-RPC, `Content-Type: application/json`). Docs: https://shopify.dev/docs/agents/catalog/storefront-mcp
- Every tool takes `meta: { "ucp-agent": { profile: "<uri>" } }` (required), plus a domain object.

| Tool | Main args (from live `tools/list`) |
|---|---|
| `search_catalog` | `catalog: { query?, context?, signals?, filters?, pagination? }`. "At least one of query or filters." |
| `lookup_catalog` | `catalog: { ids[] (≤10), context?, signals?, filters? }` |
| `get_product` | `catalog: { id, selected?: [{name,label}], preferences?, context?, signals?, filters? }` |
| `create_cart` / `update_cart` | `cart: { line_items: [{ item: { id: variantId }, quantity }], buyer?, context?, fulfillment?, discounts? }` (+ `id` for update) |
| `get_cart` / `cancel_cart` | `id` |
| `create_checkout` / `update_checkout` | `checkout: { line_items, payment?, buyer?, context?, attribution?, cart_id?, fulfillment?, discounts? }` |
| `complete_checkout` | `id`, `checkout: { payment: { instruments: [{ id, handler_id, type, … }] }, attribution? }` |
| `get_checkout` / `cancel_checkout` / `get_order` | `id` |

- `filters`: `{ categories?: string[] (OR), price?: { min?: int, max?: int } /* minor units */, available?: boolean /* default true */ }`
- `context`: `{ address_country (ISO 3166-1 a2), address_region, postal_code, language (BCP47), currency (ISO 4217), intent }`
- `pagination`: `{ cursor?, limit? (default 10) }`. The response carries `has_next_page`, `total_count` and a cursor.
- **Prices in MCP responses are `{amount: <int minor units>, currency}`.** The tool descriptions tell the model to divide by 100.
- Product ids are GIDs (`gid://shopify/Product/123`). We should use our own URN-like ids such as `sz:product:<uuid>` and `sz:variant:<uuid>`.

### 3. UCP discovery: `/.well-known/ucp` (VERIFIED LIVE)

Spec: https://ucp.dev (versions `2026-01-23`, `2026-04-08`, and live Shopify uses **`2026-08-25`**). Repo: https://github.com/universal-commerce-protocol/ucp. Co-developed by Google, Shopify, Etsy, Wayfair, Target and Walmart. The profile must be public with no auth.

Live Allbirds profile, trimmed:
```json
{ "ucp": {
  "version": "2026-08-25",
  "supported_versions": { "2026-04-08": "https://…/.well-known/ucp/2026-04-08" },
  "services": { "dev.ucp.shopping": [
    { "version": "2026-08-25", "spec": "https://ucp.dev/2026-08-25/specification/overview/",
      "transport": "mcp", "endpoint": "https://weareallbirds.myshopify.com/api/ucp/mcp",
      "schema": "https://ucp.dev/2026-08-25/services/shopping/mcp.openrpc.json" } ] },
  "capabilities": {
    "dev.ucp.shopping.catalog.search": [{ "version": "2026-08-25", "spec": "…", "schema": "https://ucp.dev/2026-08-25/schemas/shopping/catalog_search.json" }],
    "dev.ucp.shopping.catalog.lookup": [ … ],
    "dev.ucp.shopping.cart": [ … ], "dev.ucp.shopping.checkout": [ … ],
    "dev.ucp.shopping.fulfillment": [{ …, "extends": ["dev.ucp.shopping.checkout","dev.ucp.shopping.cart"] }],
    "dev.ucp.shopping.discount": [ … ], "dev.ucp.shopping.order": [ … ],
    "dev.ucp.common.identity_linking": [ … ] },
  "payment_handlers": { "com.google.pay": [ … ], "dev.shopify.card": [ … ], "dev.shopify.shop_pay": [ … ] }
} }
```
- Transports defined by the spec are `rest`, `mcp`, `a2a` and `embedded`. Over REST, the agent sends its profile in the header `UCP-Agent: profile="https://agent.example/profile.json"`. Over MCP, it goes in `arguments.meta["ucp-agent"].profile`.
- The spec also shows `signing_keys` (JWK) at the top level. We can omit it for the hackathon (UNVERIFIED whether validators require it).
- **For us:** we cannot put a `/.well-known/ucp` at the merchant's own root because we don't control their domain. Serve `/.well-known/ucp` at **our** root for the aggregator, and per store at `/s/{store}/.well-known/ucp`. This path is non-standard, so also link it from `/s/{store}/llms.txt`. Stretch goal: `{store}.shoperzero.app` subdomains rewritten in `src/proxy.ts`, which makes each store's `/.well-known/ucp` spec-correct.
- Our capabilities for the MVP: `dev.ucp.shopping.catalog.search` and `dev.ucp.shopping.catalog.lookup`, plus `dev.ucp.shopping.checkout` only for stores where the checkout track works. Payment handlers come from the checkout track (Stripe SPT and/or x402). Namespace custom ones as `app.shoperzero.*`.

### 4. ACP product feed (OpenAI / Stripe)

- Spec: https://developers.openai.com/commerce/product-feeds/spec. Protocol repo: https://github.com/agentic-commerce-protocol/agentic-commerce-protocol (latest spec folder **`2026-04-17`**, which adds cart, feed, orders, auth and an MCP binding). Merchant checkout is `POST /checkout_sessions` and related endpoints, which the checkout track covers.
- **9 required fields:** `item_id`, `title` (≤150), `description` (≤5000), `url`, `brand`, `seller_name`, `image_url`, `price` (money string such as `"25.00 USD"`; confirm the exact format on the spec page), and `availability` (`in_stock|out_of_stock|pre_order|backorder|unknown`).
- Useful optional fields: `group_id` (the parent product, since ACP rows are per variant), `offer_id`, `gtin`, `mpn`, `sale_price`, `additional_image_urls`, `product_category`, `color`, `size`, `condition`, `seller_url`, `seller_privacy_policy`, `seller_tos`, `return_deadline_in_days`, `is_eligible_search`, and `is_eligible_checkout`.
- Formats are JSONL, CSV or TSV, optionally `.gz`. Refresh whenever price, stock, title or images change.
- **No ACP `.well-known` discovery exists.** The site says discovery is "being worked on" (UNVERIFIED beyond that statement). ACP feeds are pushed to OpenAI rather than crawled, so for us it is an **export endpoint**: `/s/{store}/feed.acp.jsonl`, with one row per variant.

### 5. llms.txt

- Spec: https://llmstxt.org. The format is: an H1 (required), a `>` blockquote summary, optional prose, then H2 sections that each contain `- [name](url): note` lists. A section named `## Optional` holds content agents may skip. Markdown twins of pages live at `page.md`. `llms-full.txt` is a community convention (the whole content inlined) and is not part of the spec.
- Shopify's live `llms.txt` (allbirds.com/llms.txt) is an **agent instruction sheet**. It covers discovery at `/.well-known/ucp`, the MCP endpoint, and the flow search → create_cart → create_checkout → update_checkout → complete_checkout ("buyer must approve payment"). It also advertises `https://shop.app/SKILL.md`. **Copy this pattern.**

### 6. Other `/.well-known` and agent conventions

| Thing | Path | Status | Verdict |
|---|---|---|---|
| UCP business profile | `/.well-known/ucp` | Live on every Shopify store | **Ship** |
| A2A Agent Card | `/.well-known/agent-card.json` (renamed from `agent.json` in v0.3; v1.0 adds JWS-signed cards) https://a2a-protocol.org/latest/topics/agent-discovery/ | Stable | Ship a static card (cheap) that lists skills `search_products` and `checkout` and points to the MCP URL. We don't need a real A2A server. |
| MCP Server Card | SEP-2127 PR https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127 is **still open** (as of 2026-09-24). The path is contested: `/.well-known/mcp/server-card.json` vs `server-cards.json`, and an AI Catalog at `/.well-known/ai-catalog.json` has been floated. | Draft | Optional. **UNVERIFIED** path, so serve at both `server-card.json` and `server-cards.json` if we bother at all. |
| OAuth protected resource | `/.well-known/oauth-protected-resource` (RFC 9728). `mcp-handler` ships a `protectedResourceHandler`. | Stable | Skip for the MVP. Keep the MCP server public and read-only, and put checkout behind a simple API key if needed. |
| `ai-plugin.json` | `/.well-known/ai-plugin.json` | Dead (ChatGPT plugins were retired in 2024) | **Skip** |
| OpenAPI for GPT Actions | `/openapi.json` (OpenAPI 3.1, `operationId`s, ≤30 operations) | Stable | Ship, since it is generated from the same REST routes |
| NLWeb | `POST /ask` `{query}` → Schema.org JSON, plus `/mcp` https://github.com/nlweb-ai/NLWeb | Niche (Microsoft) | Optional 20-minute alias: `/s/{store}/ask?query=` that calls hybrid search and returns `ItemList` of `Product`. |
| robots.txt AI directives | `Content-Signal: search=yes, ai-input=yes, ai-train=no` https://contentsignals.org | Advisory | Ship on our domain. Also **respect** it (and `Disallow`) when crawling merchants. |
| schema.org | `Product`, `ProductGroup` (variants via `hasVariant`), `Offer` (`price`, `priceCurrency`, `availability`: `https://schema.org/InStock`), `ItemList` | Stable | Emit JSON-LD on our human product pages (`/s/{store}/p/{handle}`). This is also the #1 crawl source for non-Shopify stores. |

Shopify's robots.txt has no AI-specific lines (it disallows `/checkout`, `/cart`, `/search` and similar for all bots). Checkout crawling is disallowed by convention, so agents must check out through protocols, not page scraping.

### 7. Search infra on Supabase

- The pattern follows https://supabase.com/docs/guides/ai/hybrid-search: a `tsvector` **generated stored column** with GIN, plus `vector(N)` with HNSW, fused with **RRF** (`rrf_k=50`, `full_text_weight`, `semantic_weight`) inside a SQL function called with `supabase.rpc('search_products', {...})`.
- **Embedding model: OpenAI `text-embedding-3-small`**, $0.02 per 1M tokens ($0.01 through the Batch API). It supports shortening via `dimensions`, so request **512** to get smaller indexes and faster HNSW for little quality loss. At about 150 tokens per product (title + brand + type + tags + 400 chars of description), 100k products is about 15M tokens, or roughly $0.30. The zero-key alternative is Supabase's built-in `gte-small` (384-d) in Edge Functions (`new Supabase.ai.Session('gte-small')`). It is free but English-only and weaker. `text-embedding-3-large` is not worth it for a hackathon.
- **What to embed:** one vector per **product**, not per variant. Text is `title | brand | product_type | tags | first ~500 chars of plain-text description`. Embed the query with the same model and dimensions.
- **Filters:** put them inside **both** CTEs, not after the fusion. HNSW with a selective `WHERE` can return too few rows. Either raise `hnsw.ef_search`, or on pgvector ≥0.8 use `set hnsw.iterative_scan = relaxed_order` (UNVERIFIED which pgvector version the project runs; check with `select extversion from pg_extension where extname='vector'`). For small catalogs (<50k rows) exact scan is fine, so don't over-tune.
- `websearch_to_tsquery('english', q)` accepts Google-style syntax (`"red shoes" -kids`). Use the `'simple'` config for SKU and brand exact matches, or add a trigram index (`pg_trgm`) on `title` for typo tolerance (optional).
- The existing migration `supabase/migrations/20260926000000_init.sql` already has `stores`, `products` (prices as `numeric(12,2)`, `variants jsonb`), `crawl_runs` and a GIN **expression** index. The sketch below **extends** it rather than replacing it.

### 8. Remote MCP server in Next.js 16 (VERIFIED on npm 2026-09-26)

| Package | Latest | Note |
|---|---|---|
| `mcp-handler` | **2.2.0** (2026-09-18) | peer: `next >=13`, `@modelcontextprotocol/server ^2.0.0`. Serves MCP spec **2026-07-28** (stateless, `server/discover`) and falls back to 2025 streamable HTTP. **SSE was removed in v2.** No Redis needed. |
| `@modelcontextprotocol/server` | 2.1.0 | SDK v2 (server half) |
| `@modelcontextprotocol/sdk` | 1.30.1 | v1 SDK. Only needed if you use `mcp-handler@1` |
| `@vercel/mcp-adapter` | 0.3.2 | **Legacy name, do not use** |
| `zod` | 4.6.5 | mcp-handler 2 needs `^4.2` |

Install (for whoever owns package.json): `npm i mcp-handler@^2 @modelcontextprotocol/server@^2 zod@^4`

Minimal route. There is no `[transport]` segment in v2, so mount it wherever you want (README: https://github.com/vercel/mcp-handler):
```ts
// src/app/api/mcp/route.ts
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { searchProducts } from "@/lib/index/search"; // our RPC wrapper

export const maxDuration = 60; // Vercel function timeout (Next route segment config)

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "search_catalog",
      {
        title: "Search products",
        description: "Hybrid keyword+semantic search over indexed non-Shopify stores. Prices are integer minor units.",
        inputSchema: z.object({
          catalog: z.object({
            query: z.string().optional(),
            store: z.string().optional().describe("store slug or domain; omit to search all stores"),
            filters: z.object({
              price: z.object({ min: z.number().int().optional(), max: z.number().int().optional() }).optional(),
              available: z.boolean().default(true),
              brands: z.array(z.string()).optional(),
              categories: z.array(z.string()).optional(),
            }).optional(),
            pagination: z.object({ cursor: z.string().optional(), limit: z.number().int().min(1).max(50).default(10) }).optional(),
          }),
          meta: z.any().optional(), // accept UCP meta.ucp-agent but don't require it
        }),
      },
      async ({ catalog }) => {
        const result = await searchProducts(catalog);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      },
    );
  },
  { serverInfo: { name: "shoperzero", version: "0.1.0" } },
);

export { handler as GET, handler as POST };
```
- **Next 16 notes.** Dynamic route params are async (`const { store } = await ctx.params` with `RouteContext<'/s/[store]/products.json'>`), per `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`. GET route handlers are **not cached by default**, so for `products.json` use a `'use cache'` + `cacheLife('minutes')` helper, which cannot be used directly in the handler body.
- **`src/proxy.ts` matcher currently excludes only `api/agent`.** Add `api/mcp`, `s/`, `.well-known`, `llms.txt`, `openapi.json` and `robots.txt` to the negative lookahead. That skips the Supabase session refresh on agent traffic, which avoids latency and cookie noise.
- Add CORS (`Access-Control-Allow-Origin: *`) on the public JSON routes, and on `/api/mcp` for browser-based MCP inspectors.
- Test with `npx @modelcontextprotocol/inspector` against `http://localhost:3000/api/mcp`, or with `curl -X POST … -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`. Claude, ChatGPT and Cursor all accept remote streamable-HTTP MCP URLs.
- Next app-dir folders starting with `.` (`app/.well-known/ucp/route.ts`) work as normal routes (UNVERIFIED on 16.3; if not, add a `rewrites()` entry in `next.config.ts` from `/.well-known/:path*` to `/api/well-known/:path*`).

---

## Concrete recommendations for the hackathon build

### A. Public URL surface

Root (aggregator):

| Path | What |
|---|---|
| `GET /llms.txt` | What ShoperZero is, MCP URL, how to search and check out, and a list of indexed stores linking to `/s/{store}/llms.txt` |
| `GET /robots.txt` | `Allow: /`, `Content-Signal: search=yes, ai-input=yes, ai-train=no`, `Sitemap:` |
| `GET /.well-known/ucp` | UCP profile for the aggregator: service `dev.ucp.shopping`, transport `mcp`, endpoint `/api/mcp` |
| `GET /.well-known/agent-card.json` | A2A card (static) |
| `GET /.well-known/mcp/server-card.json` | Optional, draft spec |
| `GET /openapi.json` | OpenAPI 3.1 for `/api/v1/*` (GPT Actions) |
| `POST /api/mcp` (+GET) | **MCP server** (tools below) |
| `GET /api/v1/search?q=&store=&min_price=&max_price=&available=&brand=&limit=&cursor=` | REST twin of `search_catalog` |
| `GET /api/v1/products/{id}` | REST twin of `get_product` |
| `POST /api/v1/stores` `{url}` | Submit a store for indexing (returns `crawl_run_id`) |
| `GET /api/v1/stores/{store}` | Store status, platform, product count, last crawl, checkout methods |

Per store (`{store}` = slug derived from the domain, e.g. `example-shop-com`):

| Path | What |
|---|---|
| `GET /s/{store}/products.json?limit=≤250&page=N` | **Shopify-compatible** list (exact shape from §1) |
| `GET /s/{store}/products/{handle}.json` | `{product:{…}}` single (Shopify shape) |
| `GET /s/{store}/collections/{handle}/products.json` | Optional; map `all` → everything, others → our categories |
| `GET /s/{store}/llms.txt` | Store name, source domain, platform, product count, links to `products.json`, the feed, MCP (with `store` param), and checkout support |
| `GET /s/{store}/feed.acp.jsonl` | ACP product feed, one row per variant (`?gzip=1` optional) |
| `GET /s/{store}/.well-known/ucp` | Per-store UCP profile (non-standard location, linked from llms.txt) |
| `GET /s/{store}/ask?query=` | Optional NLWeb-ish; returns schema.org `ItemList` |
| `GET /s/{store}` and `/s/{store}/p/{handle}` | Human pages with JSON-LD `Product`/`Offer` (demo UI) |

### B. Postgres schema sketch (extends `20260926000000_init.sql`)

```sql
-- 20260926xxxxxx_index_search.sql  (sketch: reconcile with whoever owns migrations)
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- stores: add slug + agent-facing metadata
alter table public.stores
  add column slug text unique,                 -- /s/{slug}
  add column seq bigint generated always as identity, -- numeric id for Shopify-compat
  add column country text,
  add column robots jsonb not null default '{}', -- parsed robots / content-signal of the merchant
  add column product_count int not null default 0;

-- products: move to minor units + Shopify-compat fields + search columns
alter table public.products
  add column seq bigint generated always as identity,  -- numeric "id" in products.json
  add column handle text,
  add column product_type text,
  add column category text,                             -- normalized (Google taxonomy-ish) for filters
  add column tags text[] not null default '{}',
  add column options jsonb not null default '[]',       -- [{name, position, values[]}]
  add column price_min_minor bigint,                    -- denormalized from variants for filters/sort
  add column price_max_minor bigint,
  add column available boolean not null default false,  -- any variant available
  add column content_hash text,                         -- skip re-embedding if unchanged
  add column fts tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('simple',  coalesce(brand,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(product_type,'') || ' ' || array_to_string(tags,' ')), 'B') ||
    setweight(to_tsvector('english', left(coalesce(description,''), 2000)), 'C')
  ) stored,
  add column embedding extensions.vector(512);

create unique index products_store_handle_uq on public.products (store_id, handle);
create index products_fts_idx   on public.products using gin (fts);
create index products_emb_idx   on public.products using hnsw (embedding extensions.vector_cosine_ops);
create index products_filter_idx on public.products (store_id, available, price_min_minor);
create index products_brand_idx on public.products (lower(brand));
create index products_title_trgm on public.products using gin (title extensions.gin_trgm_ops);
drop index if exists products_search_idx; -- replaced by products_fts_idx

-- variants (= offers): one row per purchasable SKU
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,           -- numeric id for Shopify-compat
  product_id uuid not null references public.products(id) on delete cascade,
  external_id text,                                   -- source variant id / sku
  title text not null default 'Default Title',
  option1 text, option2 text, option3 text,
  sku text, gtin text, mpn text,
  price_minor bigint not null,
  compare_at_minor bigint,
  currency text not null,
  available boolean not null default false,
  inventory_quantity int,
  grams int,
  image_url text,
  url text,                                           -- PDP URL with variant selected
  checkout jsonb not null default '{}',               -- how to buy: {method:'woo_store_api'|'stripe_link'|'x402'|..., ref:...}
  position int not null default 1,
  updated_at timestamptz not null default now(),
  unique (product_id, external_id)
);
create index variants_product_idx on public.product_variants (product_id);
create index variants_gtin_idx on public.product_variants (gtin) where gtin is not null;

-- crawl_runs: add stats
alter table public.crawl_runs add column pages_fetched int not null default 0,
                              add column log jsonb not null default '[]';

alter table public.product_variants enable row level security;
create policy "variants are publicly readable" on public.product_variants for select using (true);

-- Hybrid search with filters inside both CTEs
create or replace function public.search_products(
  query_text text,
  query_embedding extensions.vector(512),
  match_count int default 10,
  p_store_id uuid default null,
  p_min_minor bigint default null,
  p_max_minor bigint default null,
  p_available boolean default true,
  p_brands text[] default null,
  p_categories text[] default null,
  full_text_weight float default 1,
  semantic_weight float default 1,
  rrf_k int default 50
) returns table (id uuid, score float)
language sql stable as $$
with base as (
  select p.id, p.fts, p.embedding from public.products p
  where (p_store_id is null or p.store_id = p_store_id)
    and (p_available is null or p.available = p_available)
    and (p_min_minor is null or p.price_max_minor >= p_min_minor)
    and (p_max_minor is null or p.price_min_minor <= p_max_minor)
    and (p_brands is null or lower(p.brand) = any (select lower(unnest(p_brands))))
    and (p_categories is null or p.category = any(p_categories))
),
full_text as (
  select id, row_number() over (order by ts_rank_cd(fts, websearch_to_tsquery('english', query_text)) desc) as r
  from base where query_text is not null and fts @@ websearch_to_tsquery('english', query_text)
  limit least(match_count, 50) * 2
),
semantic as (
  select id, row_number() over (order by embedding <=> query_embedding) as r
  from base where query_embedding is not null and embedding is not null
  order by embedding <=> query_embedding
  limit least(match_count, 50) * 2
)
select coalesce(f.id, s.id) as id,
       coalesce(1.0/(rrf_k + f.r), 0) * full_text_weight + coalesce(1.0/(rrf_k + s.r), 0) * semantic_weight as score
from full_text f full outer join semantic s on f.id = s.id
order by score desc
limit least(match_count, 50);
$$;
```
- Call it with `supabase.rpc('search_products', { query_text, query_embedding, match_count, p_store_id, … })`, then fetch rows and variants with `.in('id', ids)`. If the query is empty (filter-only browse), skip embedding and order by `updated_at`.
- For cursor pagination on search, use `offset` encoded in an opaque base64 cursor. That is good enough for the hackathon.
- If a separate `embeddings` table is wanted later (multiple models), use `product_embeddings(product_id, model, dims, embedding)`. For the MVP a single column is simpler.
- Keep `products.price numeric` for back-compat or drop it later. New code should use `*_minor` integers.

### C. MCP tool definitions (`/api/mcp`)

The names **mirror Shopify/UCP** so existing agent prompts transfer. Every tool accepts optional `meta` (UCP `ucp-agent`) and ignores it. All money uses `{amount:int(minor), currency}`.

| Tool | Input schema | Returns |
|---|---|---|
| `list_stores` | `{ query?: string, platform?: string, has_checkout?: boolean, limit?: 1-50 }` | `[{store, domain, name, platform, currency, product_count, checkout_methods, last_crawled_at, urls:{products_json, llms_txt, feed}}]` |
| `search_catalog` | `{ catalog: { query?: string, store?: string, filters?: { price?: {min?:int,max?:int}, available?: boolean=true, brands?: string[], categories?: string[] }, context?: { currency?, address_country?, language? }, pagination?: { cursor?, limit?: 1-50 = 10 } } }` (at least one of query and filters) | `{ products: [{ id, store, title, brand, url, image, price_range:{min,max}, available, variants_count }], pagination:{ cursor, has_next_page, total_count } }` |
| `lookup_catalog` | `{ catalog: { ids: string[] (≤10) } }` (product or variant ids) | `{ products:[…full…], not_found:[id] }` |
| `get_product` | `{ catalog: { id: string, selected?: [{name, label}] } }` | full product: `description`, `options` (with `available`/`exists`), `variants[{id, title, options, price, compare_at, available, sku, gtin, image}]`, `source_url`, `checkout_methods` |
| `index_store` | `{ url: string (store homepage) }` | `{ store, crawl_run_id, status }`. Kicks off a crawl, so demo-friendly |
| `get_crawl_status` | `{ crawl_run_id: string }` | `{ status, products_found, error? }` |
| `create_checkout` | `{ checkout: { line_items: [{ item:{ id: variantId }, quantity:int≥1 }], buyer?: { email?, name?, phone? }, fulfillment?: { address: {…} }, payment_method?: 'stripe_spt'|'x402'|'handoff' } }` | `{ id, status:'ready_for_payment'|'requires_escalation', line_items, totals:[{type,amount}], currency, payment:{ handlers:[…] }, continue_url }` |
| `update_checkout` | `{ id, checkout: { line_items?, buyer?, fulfillment? } }` | same as above |
| `complete_checkout` | `{ id, checkout: { payment: { instruments: [{ handler_id, type, credential }] } } }` | `{ id, status:'completed'|'requires_escalation', order?:{ id, url }, continue_url? }` |
| `get_checkout` / `cancel_checkout` | `{ id }` | checkout |

Implementation order: `search_catalog` → `get_product` → `list_stores` → `lookup_catalog` → `index_store` → checkout tools (stub them to return `continue_url` = merchant PDP or cart permalink until the checkout track lands; `requires_escalation` is UCP's "hand to human" status).

### D. Normalized field mapping (one DB → three outputs)

| DB | Shopify `products.json` | ACP feed row (per variant) | UCP/MCP |
|---|---|---|---|
| `products.seq` / `variants.seq` | `id` / `variants[].id` | `group_id` / `item_id` = `variants.id` | `id` = `sz:product:{uuid}` / `sz:variant:{uuid}` |
| `title` | `title` | `title` | `title` |
| `description` (HTML) | `body_html` | `description` (strip HTML) | `description` |
| `brand` | `vendor` | `brand` | `brand` / metadata |
| `product_type` / `category` | `product_type` | `product_category` | `categories` |
| `variants.price_minor` | `"25.00"` string | `price: "25.00 USD"` | `{amount:2500,currency}` |
| `variants.compare_at_minor` | `compare_at_price` | `price` = compare_at, `sale_price` = price | `list_price` |
| `variants.available` | `available` | `in_stock`/`out_of_stock` | `availability` |
| `images[]` | `images[].src` | `image_url` + `additional_image_urls` | `media[]` |
| `stores.name` | n/a | `seller_name`, `seller_url` | business |
| `variants.url` / `products.url` | (derive from handle) | `url` | `url` |

---

## Open questions / risks

1. **Legal and ToS.** Republishing merchant catalogs (images especially) under our domain carries risk. Mitigations: link out to the source, respect `robots.txt` and `Content-Signal`, hotlink images rather than copying them, and offer merchant opt-out and claim.
2. **Staleness.** Price and stock drift between crawls. Show `updated_at` in every response, and make `get_product` and `create_checkout` do a **live re-fetch** of the source PDP/JSON-LD (or the Woo Store API) before quoting a price.
3. **UCP conformance.** We are borrowing UCP tool names and shapes, not passing a validator. Agents that strictly validate `ucp.version` and schemas may reject us. Decide whether to claim `version: "2026-08-25"` or only `2026-04-08`, and whether to publish `signing_keys` (UNVERIFIED as required).
4. **Per-store `/.well-known` location.** A spec-correct location needs host-level routing (subdomain per store). Path-prefixed `/s/{store}/.well-known/ucp` will not be auto-discovered, so we rely on llms.txt, our root profile and the `list_stores` tool.
5. **MCP Server Card** is not final (PR #2127 open). Don't block on it.
6. **mcp-handler v2 + Next 16.3.** The package declares `next >=13`, but I did not run it here. Test the route on the first day. The fallback is `mcp-handler@1` + `@modelcontextprotocol/sdk@1` (v1 API: `server.tool(name, zodRawShape, handler)` under `app/api/[transport]/route.ts`).
7. **Embeddings key.** An OpenAI key is needed server-side. If we don't have one, use Supabase `gte-small` (384-d); the migration then needs `vector(384)`.
8. **Numeric ids for Shopify compat.** `seq bigint identity` columns are added. Confirm that nobody downstream relies on uuid ids in `products.json`.
9. **Checkout via Shopify-style `complete_checkout`** needs a payment handler story (Stripe SPT / x402). That belongs to the checkout research track.

---

## Sources

- Live checks (2026-09-26): `https://www.allbirds.com/products.json`, `/products/{handle}.json`, `/products/{handle}.js`, `/collections/all/products.json`, `/.well-known/ucp`, `/llms.txt`, `/robots.txt`, and `POST https://weareallbirds.myshopify.com/api/ucp/mcp` (`tools/list`, `tools/call`)
- Shopify Storefront Catalog MCP: https://shopify.dev/docs/agents/catalog/storefront-mcp
- UCP spec overview (profile example, transports, UCP-Agent header): https://ucp.dev/2026-04-08/specification/overview/ · https://ucp.dev · https://github.com/universal-commerce-protocol/ucp
- Google UCP profile guide: https://developers.google.com/merchant/ucp/guides/ucp-profile
- ACP product feed spec: https://developers.openai.com/commerce/product-feeds/spec · ACP repo: https://github.com/agentic-commerce-protocol/agentic-commerce-protocol · https://www.agenticcommerce.dev/
- llms.txt: https://llmstxt.org
- A2A agent discovery: https://a2a-protocol.org/latest/topics/agent-discovery/ · https://a2a-protocol.org/latest/specification/
- MCP Server Cards: https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127 · https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1649 · https://modelcontextprotocol.io/community/working-groups/server-card
- NLWeb: https://github.com/nlweb-ai/NLWeb
- Content Signals: https://contentsignals.org
- Supabase hybrid search: https://supabase.com/docs/guides/ai/hybrid-search
- OpenAI embeddings: https://developers.openai.com/api/docs/models/text-embedding-3-small · https://openai.com/index/new-embedding-models-and-api-updates/
- mcp-handler: https://github.com/vercel/mcp-handler · https://www.npmjs.com/package/mcp-handler · https://vercel.com/changelog/latest-mcp-spec-now-supported-in-mcp-handler
- npm registry checks: `registry.npmjs.org/{mcp-handler,@modelcontextprotocol/server,@modelcontextprotocol/sdk,@vercel/mcp-adapter,zod}/latest`
- Next 16 route handlers (local): `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
