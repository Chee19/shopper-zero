# 00 — ShoperZero synthesis: decisions, architecture, contracts, build plan

Lead-architect synthesis of research tracks 01–08 (2026-09-26). **Read this first.** Detail and sources are in the numbered reports; this file resolves their contradictions and sets the contracts so parallel streams can start now.

Scaffold we build on: Next.js 16.3.6 App Router (`src/app`), `src/proxy.ts` (Supabase session refresh; matcher currently excludes `api/agent`), `src/lib/supabase/{client,server,admin,proxy}.ts`, migration `supabase/migrations/20260926000000_init.sql` (`stores`, `products`, `crawl_runs`, public-read RLS). No API routes exist yet.

---

## 1. Product definition and demo story

**ShoperZero makes any non-Shopify store agent-ready in about 60 seconds, with no plugin and no replatforming.** Paste a store URL. We detect the platform (WooCommerce, Magento, BigCommerce, Squarespace, SFCC or custom), pull its catalog through the cheapest path that works (platform API, then sitemap plus JSON-LD, then rendering/LLM), and normalize it. We then host the agent-facing surfaces Shopify stores get for free:
- a Shopify-compatible `products.json`;
- a UCP profile (`/.well-known/ucp`) and an MCP server using the same tool names as Shopify's catalog MCP;
- an ACP/OpenAI product feed;
- `llms.txt`.

Agents can then check out. ShoperZero is the checkout orchestrator: the agent pays us with a Stripe Shared Payment Token or x402 USDC, and we place the order on the merchant through the store's own API. Where headless checkout is impossible, we hand off honestly with a prefilled-cart `continue_url`. Merchants can claim their store (DNS TXT or meta tag) to get a verified badge, opt out, or control their listing.

**Positioning (from 08):** "Cloudflare for agentic commerce. We sit in front of any store and speak UCP/ACP/MCP for it." Don't invent a protocol; emit the existing ones.

**2-minute demo:**
1. **(0:00) Hook.** `curl https://<woo-store>/products.json` returns 404: "Agents can't read this store."
2. **(0:15) Scan.** Paste 3 URLs into ShoperZero:
   - our WooCommerce demo store;
   - `www.bulk.com/uk` (Magento);
   - `hester-demo.squarespace.com`, or a JSON-LD custom store.

   Live: platform detected, product counter ticking up, readiness grade **F → A**.
3. **(0:45) Open the output.** Show `/s/{store}/products.json` (Shopify shape), `/s/{store}/llms.txt` and `/.well-known/ucp`.
4. **(1:00) Claude buys.** Claude Desktop/Code is connected to `https://<app>/api/mcp`. Prompt: "find me a hoodie under $50 across these stores and buy it". Claude calls `search_catalog`, `get_product`, `create_checkout` (live quote from the Woo Store API), then `complete_checkout` with an SPT (Stripe test mode). The checkout timeline streams in our UI.
5. **(1:30) Proof.** The order appears in WooCommerce admin with the payment receipt in its order note. Optional second run with x402 on Base Sepolia shows the tx hash on BaseScan.
6. **(1:45) Merchant claim + honesty slide.** For the Magento store, checkout returns `requires_escalation` with a prefilled cart link. The merchant claims their store for a verified badge. Close: "UCP for the other 80% of the web."

---

## 2. Key decisions

### Contradictions resolved

| Topic | Conflict | **Decision** |
|---|---|---|
| UCP version | 01/04/06 saw `2026-08-25` live on Shopify; 08 suggests `2026-04-08` (from a WooCommerce plugin listing) | Emit **`2026-08-25`** (what Shopify serves live) and list `2026-04-08` in `supported_versions`. Pin it in one constant. |
| x402 placement | 07: `paymentProxy` in `proxy.ts`; 02: `withX402` in a route handler | **`withX402` in a route handler.** `proxy.ts` stays Supabase-only. |
| x402 headers/facilitator | 07 uses v1 `X-PAYMENT` and `facilitator.x402.org` (UNVERIFIED) | **v2 headers** (`PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`), facilitator **`https://x402.org/facilitator`** (checked live in 02), `@x402/*@2.27.0` only. |
| x402 dynamic price | 07 unsure | Verified in 02: `price` can be an async function. We price from the frozen checkout total, and the checkout is immutable once `awaiting_payment`. |
| MCP checkout tool names | 01: ACP names (`create_checkout_session`); 07: `confirm_checkout` / `select_shipping`; 06: Shopify/UCP names | **Shopify/UCP names**: `create_checkout`, `update_checkout` (shipping selection happens here), `get_checkout`, `complete_checkout`, `cancel_checkout`. ACP REST aliases are stretch only. |
| Money | 05 uses float `price`; 06/01 use integer minor units | **Integer minor units everywhere** (`{amount, currency}`). The extractor converts. Decimal strings appear only in the Shopify-compat output. |
| Stripe path | 03: pay the store with an Issuing test card (simulated); 07: SPT charge on us, then place the Woo order with an offline method | **07's model.** Charge an SPT with `capture_method=manual`, place the Woo order (`bacs` + receipt note), then capture, or void on failure. Issuing is shown as a mocked UI card only. |
| Payment rail priority | 08: "one rail well, Stripe"; 02/07: x402 easy on testnet | **Build both behind one `PaymentRail` interface, each gated by a 15-min spike.** Stripe SPT is the demo default (more credible). x402 is the second act; the free facilitator needs no keys. If SPT preview access fails, use a plain PaymentIntent with `pm_card_visa`, labeled "SPT-compatible". |
| Crawl runtime | — | Vercel/Node route handlers with `after()` (`maxDuration=300`). **No Supabase Edge Functions** (2 s CPU limit). |
| Search | 06: hybrid pgvector + FTS | **MVP: FTS + trigram only.** Embeddings are stretch (they need an OpenAI key). The `search_products` RPC signature accepts a nullable embedding from day 1. |
| Route prefix | Scaffold excludes `api/agent`; 02 uses `/api/agent/*`; 06 uses `/api/v1` + `/api/mcp` | **`/api/mcp` + `/api/v1/*`.** WS1 changes the `proxy.ts` matcher to exclude `api/`, `s/`, `.well-known`, `llms.txt`, `robots.txt` and `openapi.json` (no agent route needs a cookie session). |

### Decisions

- **Index formats: all three from one DB.**
  - (a) Shopify-compatible `/s/{store}/products.json` with numeric `seq` ids and `_shoperzero` extras. It is the literal pitch.
  - (b) UCP catalog shape for MCP and REST. This is what agents use.
  - (c) ACP/OpenAI feed `/s/{store}/feed.acp.jsonl`, one row per variant. It is an export, since we can't push to ChatGPT without merchant approval.
- **Agent interface:** one MCP server at `/api/mcp` (`mcp-handler@2` + `@modelcontextprotocol/server@2`) with Shopify/UCP tool names, REST twins under `/api/v1`, and discovery files: root and per-store `llms.txt`, `/.well-known/ucp`, `/.well-known/agent-card.json` and `/openapi.json`.
  - Per-store `.well-known` stays path-based (`/s/{slug}/...`); subdomains are stretch.
  - Rationale: MCP is the only partnership-free path to real agents (01).
- **Crawl tiers (per store, strategy locked after sampling about 5 URLs):**
  - **T0** platform API: WooCommerce Store API, Magento GraphQL, Squarespace `?format=json`, SFCC `Product-Variation`, Shopify passthrough.
  - **T2** robots → sitemaps → JSON-LD `Product`/`ProductGroup`. This is the main engine.
  - **T3** microdata/OpenGraph.
  - **T4** Firecrawl render (stretch).
  - **T5** Claude Haiku extraction on markdown (stretch).
  - Skip T1 feeds.
  - Rationale: cheapest-first covers most stores (05).
- **Checkout primary path:** our own WooCommerce store (Docker + `cloudflared`) using the Store API: cart → quote → pay us → `POST /checkout` with `payment_method=bacs` and `expected_total` → order.
  - Fallback for every other store: UCP `requires_escalation` with a `continue_url`:
    - WooCommerce: `/?add-to-cart={id}`;
    - BigCommerce: `/cart.php?action=add&product_id=X`;
    - everything else: the product page.
  - Rationale: cards can't be completed headlessly on stores without an agent API (07).
- **Payment rails:**
  - Stripe test mode, SPT via `POST /v1/test_helpers/shared_payment/granted_tokens` (`Stripe-Version: 2026-04-22.preview`), then a PaymentIntent with `payment_method_data[shared_payment_granted_token]`.
  - x402 v2 `exact` on **Base Sepolia (`eip155:84532`)** USDC, `paymentFlow:"upfront"`.
  - Payment handler ids: `app.shoperzero.stripe_spt` and `app.shoperzero.x402`.
- **Demo buyer wallet:** Claude has no wallet, so we ship a separate **demo wallet MCP** (`/api/demo-wallet/mcp`, test mode only). Its tools are `wallet_issue_spt` (calls the Stripe test helper) and `wallet_pay_x402` (server-held Base Sepolia key plus `@x402/fetch`). It stands in for Link Agent Wallet / CDP wallet and is clearly labeled as the buyer side.
- **Mocked:** x402 refunds (state + log only), Stripe Issuing virtual card (UI card from test data), 3DS `requires_action` (canned event), real third-party orders (never; handoff only), Visa TAP / Web Bot Auth (slide), AP2 (roadmap slide).
- **Skipped:** Rye and Crossmint (paid or prod-only), Stagehand browser checkout (stretch), MPP (slide), ACP MCP tool names, AP2, the `@x402/mcp` paywall, pgmq (stretch), embeddings (stretch).

---

## 3. Architecture

```mermaid
flowchart LR
  subgraph Agents
    CL[Claude / Cursor / ChatGPT dev mode<br/>MCP client]
    HTTPAG[Any HTTP agent<br/>curl / GPT Actions]
    WAL[Demo wallet MCP<br/>/api/demo-wallet/mcp]
  end

  subgraph ShoperZero["ShoperZero (Next.js 16 on Vercel)"]
    MCP[/api/mcp<br/>mcp-handler/]
    REST[/api/v1/*<br/>search, products, stores, checkouts/]
    PUB[/s/:store/products.json<br/>feed.acp.jsonl, llms.txt,<br/>.well-known/ucp/]
    UI[Web UI<br/>scan, store page, checkout timeline, claim]
    CRAWL[lib/crawl<br/>detect → adapter → JSON-LD → normalize]
    CO[lib/checkout<br/>state machine + connectors]
    PAY[lib/payments<br/>stripe_spt | x402]
  end

  subgraph Supabase
    DB[(stores, products, product_variants,<br/>crawl_runs, checkouts, checkout_events,<br/>orders, agent_requests)]
    RT((Realtime))
  end

  subgraph External
    STORES[Merchant stores<br/>Woo / Magento / BC / SQSP / custom]
    WOO[Our Woo demo store<br/>Docker + cloudflared]
    STRIPE[Stripe test mode]
    FAC[x402.org facilitator<br/>Base Sepolia]
  end

  CL --> MCP
  CL --> WAL
  HTTPAG --> REST
  HTTPAG --> PUB
  WAL -->|x402 pay| REST
  WAL -->|SPT test helper| STRIPE
  MCP --> DB
  REST --> DB
  PUB --> DB
  UI -->|POST /api/v1/stores| CRAWL
  MCP -->|index_store| CRAWL
  CRAWL -->|fetch 1-2 rps| STORES
  CRAWL --> DB
  MCP --> CO
  REST --> CO
  CO -->|Store API cart / quote / place order| WOO
  CO --> PAY
  PAY --> STRIPE
  PAY --> FAC
  DB --> RT --> UI
```

### Public URL surface

| Method + path | Owner | Purpose |
|---|---|---|
| `POST,GET /api/mcp` | WS3 | MCP server (tools in §6) |
| `GET /api/v1/search?q=&store=&min=&max=&available=&brand=&limit=&cursor=` | WS3 | REST twin of `search_catalog` |
| `GET /api/v1/products/{id}` | WS3 | REST twin of `get_product` (`?verify=1` forces a live re-check) |
| `GET /api/v1/stores` · `GET /api/v1/stores/{slug}` | WS3 | Store list and status (platform, count, readiness, checkout methods) |
| `POST /api/v1/stores` `{url}` | WS2 | Submit a store and start the crawl. Returns `{store, crawl_run_id}` (202) |
| `GET /api/v1/crawl-runs/{id}` | WS2 | Crawl progress |
| `POST /api/v1/checkouts` · `GET/PUT /api/v1/checkouts/{id}` · `POST .../complete` · `POST .../cancel` | WS4 | UCP-style checkout REST (`Idempotency-Key` honored) |
| `POST /api/v1/checkouts/{id}/pay` | WS4 | **x402-protected** (`withX402`, upfront), priced from `checkout.total` |
| `GET /api/v1/orders/{id}` | WS4 | Order status |
| `POST,GET /api/demo-wallet/mcp` | WS4 | Demo buyer wallet (test mode only) |
| `GET /s/{slug}/products.json?limit=≤250&page=N` | WS3 | Shopify-compatible list |
| `GET /s/{slug}/products/{handle}.json` | WS3 | `{product:{…}}` |
| `GET /s/{slug}/feed.acp.jsonl` | WS3 | ACP/OpenAI feed, one row per variant |
| `GET /s/{slug}/llms.txt` · `GET /s/{slug}/.well-known/ucp` | WS3 | Per-store agent docs and UCP profile |
| `GET /llms.txt` · `/.well-known/ucp` · `/.well-known/agent-card.json` · `/openapi.json` · `/robots.txt` | WS3 | Root discovery (`robots.txt` carries `Content-Signal: search=yes, ai-input=yes, ai-train=no`) |
| `/` · `/scan` · `/stores/{slug}` · `/checkouts/{id}` · `/claim/{slug}` | WS5 | Human UI |

All public JSON routes send `Access-Control-Allow-Origin: *`. Route params are async in Next 16 (`const { slug } = await ctx.params`). **Read `node_modules/next/dist/docs/` before writing route handlers** (AGENTS.md).

---

## 4. Supabase schema and jobs

One migration, **`supabase/migrations/20260926010000_core.sql`**, written by WS1 in the first 30 minutes from this sketch. It extends `init.sql` and does not replace it. Later changes go in new files, one per stream (`2026092602xxxx_<stream>_*.sql`). Never edit a pushed migration.

```sql
create extension if not exists pg_trgm with schema extensions;
-- stretch: create extension if not exists vector with schema extensions;

-- STORES
alter table public.stores
  add column slug text unique,                         -- /s/{slug}, from domain: "bulk-com-uk"
  add column seq bigint generated always as identity,
  add column country text,
  add column product_count int not null default 0,
  add column strategy jsonb not null default '{}',     -- {tier:'platform_api'|'jsonld'|..., adapter:'woocommerce', sampled_at}
  add column readiness jsonb not null default '{}',    -- ReadinessReport {before, after}
  add column checkout_connector text,                  -- 'woo_store_api' | 'handoff' | ...
  add column claim_token text,
  add column claimed_at timestamptz,
  add column opted_out boolean not null default false;
-- stores.status values: pending | crawling | indexed | failed | blocked

-- PRODUCTS (keep legacy price/variants cols; new code writes *_minor + product_variants and stops writing products.variants)
alter table public.products
  add column seq bigint generated always as identity,  -- Shopify-compat numeric id
  add column handle text,
  add column description_html text,
  add column product_type text,
  add column category text,
  add column tags text[] not null default '{}',
  add column options jsonb not null default '[]',      -- [{name, values[]}]
  add column price_min_minor bigint,
  add column price_max_minor bigint,
  add column available boolean not null default false,
  add column source text,                              -- ExtractionSource
  add column gtin text,
  add column content_hash text,
  add column last_seen_at timestamptz,
  add column fts tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('simple',  coalesce(brand,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(product_type,'') || ' ' || array_to_string(tags,' ')), 'B') ||
    setweight(to_tsvector('english', left(coalesce(description,''), 2000)), 'C')) stored;
  -- stretch: add column embedding extensions.vector(512)
create unique index products_store_handle_uq on public.products (store_id, handle);
create index products_fts_idx on public.products using gin (fts);
create index products_title_trgm on public.products using gin (title extensions.gin_trgm_ops);
create index products_filter_idx on public.products (store_id, available, price_min_minor);
drop index if exists products_search_idx;

-- VARIANTS (= offers)
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  product_id uuid not null references public.products(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  external_id text,                 -- Woo variation id, Magento sku, JSON-LD sku...
  title text not null default 'Default Title',
  options jsonb not null default '{}',   -- {"Size":"M","Color":"Blue"}
  sku text, gtin text,
  price_minor bigint not null,
  compare_at_minor bigint,
  currency text not null,
  available boolean not null default false,
  inventory_quantity int,
  image_url text,
  url text,
  position int not null default 1,
  checked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, external_id)
);
create index variants_product_idx on public.product_variants (product_id);

-- CRAWL RUNS (existing) + stats
alter table public.crawl_runs
  add column pages_fetched int not null default 0,
  add column pages_failed int not null default 0,
  add column log jsonb not null default '[]';

-- CHECKOUT
create table public.checkouts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  connector text not null,               -- CheckoutConnectorId
  state text not null default 'quoting', -- CheckoutState (internal)
  line_items jsonb not null,             -- LineItem[]
  buyer jsonb, fulfillment jsonb,
  totals jsonb not null default '[]',    -- Total[]
  currency text,
  total_minor bigint,                    -- frozen once state=awaiting_payment (x402 price source)
  connector_state jsonb not null default '{}',  -- e.g. {cart_token, woo_order_id}  (never exposed)
  payment jsonb not null default '{}',   -- {rail, reference, status}
  continue_url text,
  idempotency_key text unique,
  agent_profile text,
  error jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.checkout_events (
  id bigint generated always as identity primary key,
  checkout_id uuid not null references public.checkouts(id) on delete cascade,
  from_state text, to_state text not null,
  message text,                          -- human-readable, NO PII (shown in public timeline)
  data jsonb not null default '{}',      -- tx hash, pi id, merchant order id
  created_at timestamptz not null default now()
);
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  checkout_id uuid not null unique references public.checkouts(id),  -- one order per checkout = idempotency
  store_id uuid not null references public.stores(id),
  merchant_order_id text, merchant_order_url text,
  status text not null,                  -- placed | confirmed | failed | refunded
  rail text not null,                    -- stripe_spt | x402
  payment_reference text,                -- pi_... | 0x tx hash
  payer text,                            -- wallet address (x402)
  amount_minor bigint not null, currency text not null,
  created_at timestamptz not null default now()
);

-- METRICS (cheap, shows "agent queries served")
create table public.agent_requests (
  id bigint generated always as identity primary key,
  surface text not null,       -- mcp | rest | products_json | feed | llms_txt | ucp
  tool text, store_id uuid, user_agent text,
  created_at timestamptz not null default now()
);

-- RLS: public read for index + timeline; checkouts/orders/agent_requests service-role only
alter table public.product_variants enable row level security;
alter table public.checkouts enable row level security;
alter table public.checkout_events enable row level security;
alter table public.orders enable row level security;
alter table public.agent_requests enable row level security;
create policy "variants public read" on public.product_variants for select using (true);
create policy "checkout events public read" on public.checkout_events for select using (true);

alter publication supabase_realtime add table public.crawl_runs, public.checkout_events, public.stores;

-- triggers
create trigger variants_updated_at before update on public.product_variants for each row execute function public.set_updated_at();
create trigger checkouts_updated_at before update on public.checkouts for each row execute function public.set_updated_at();

-- search RPC (FTS + trigram now; embedding param reserved)
create or replace function public.search_products(
  query_text text default null, match_count int default 10, match_offset int default 0,
  p_store_id uuid default null, p_min_minor bigint default null, p_max_minor bigint default null,
  p_available boolean default true, p_brands text[] default null
) returns table (id uuid, score real) language sql stable as $$
  select p.id,
    (case when query_text is null then 0
          else ts_rank_cd(p.fts, websearch_to_tsquery('english', query_text))
               + similarity(p.title, query_text) end)::real as score
  from public.products p join public.stores s on s.id = p.store_id and not s.opted_out
  where (p_store_id is null or p.store_id = p_store_id)
    and (p_available is null or p.available = p_available)
    and (p_min_minor is null or p.price_max_minor >= p_min_minor)
    and (p_max_minor is null or p.price_min_minor <= p_max_minor)
    and (p_brands is null or lower(p.brand) = any (select lower(unnest(p_brands))))
    and (query_text is null or p.fts @@ websearch_to_tsquery('english', query_text)
         or p.title % query_text)
  order by score desc, p.updated_at desc
  limit least(match_count, 50) offset match_offset;
$$;
```
(Hybrid pgvector version with RRF: 06 §B. Swap it in if embeddings land.)

### Jobs / queue

- **MVP (build this):**
  - `POST /api/v1/stores` inserts a `stores` row and a `crawl_runs` row (`queued`), returns 202, then runs the crawl inside **`after()`** with `export const maxDuration = 300`.
  - It caps at about 150 products per run. The crawler updates `crawl_runs.products_found`/`pages_fetched` every 10 products, and the UI shows it through Realtime.
  - A re-crawl is the same call. There is no cron.
- **Stretch:** Supabase Queues (pgmq): a `crawl` queue plus `POST /api/worker` (drain 240 s, self-chain via `after()`) and `pg_cron` + `pg_net` every minute (05 §6).
- **Checkout** is synchronous per request. It holds no queue, and every transition is written to `checkout_events`.

---

## 5. Parallel workstreams

Rules:
- Each stream owns its directories; touch another stream's files only by agreement.
- `src/lib/contracts/**` is **frozen after T+30 min**. Change it only with a heads-up to everyone.
- **One person (WS1) installs the union of packages in a single commit at T+0** to avoid `package-lock.json` conflicts:
  ```bash
  npm i zod@^4 cheerio fast-xml-parser robots-parser p-queue mcp-handler@2.2.0 @modelcontextprotocol/server@2.1.0 stripe @x402/core@2.27.0 @x402/next@2.27.0 @x402/evm@2.27.0 @x402/fetch@2.27.0 viem
  # stretch, install when needed: firecrawl @anthropic-ai/sdk @browserbasehq/stagehand@4.1.0
  ```
- Env: WS1 adds these to `.env.example`:
  - `STRIPE_SECRET_KEY`, `STRIPE_PREVIEW_VERSION=2026-04-22.preview`
  - `X402_NETWORK=eip155:84532`, `X402_FACILITATOR_URL=https://x402.org/facilitator`, `X402_PAY_TO`, `DEMO_WALLET_PRIVATE_KEY`
  - `WOO_DEMO_URL`, `APP_URL`, `CRAWLER_USER_AGENT`

### WS1: Foundation (data, contracts, repo glue). Short stream; the owner then joins WS3 or WS5.
- **Scope:** migration §4, contracts §6, DB helpers, proxy matcher, package install, env, seeds.
- **Owns:** `supabase/migrations/20260926010000_core.sql`, `src/lib/contracts/**`, `src/lib/db/**` (typed repo functions: `upsertStoreProducts`, `getProduct`, `searchProducts`, `getStoreBySlug`, `logAgentRequest`), `src/lib/money.ts`, `src/lib/slug.ts`, `src/proxy.ts` (matcher only), `.env.example`, `supabase/seed.sql`.
- **Contracts provided:** everything in §6 plus the `src/lib/db` function signatures. Stub bodies are fine at first.
- **Milestones:**
  - [ ] Packages installed and pushed (T+15)
  - [ ] Contracts pushed (T+30)
  - [ ] Migration applied locally and remotely, then `supabase gen types typescript` → `src/lib/db/types.gen.ts`
  - [ ] db helpers implemented
  - [ ] Seed with 1 fake store and 3 products so WS3 and WS5 can build before the crawler works
  - [ ] Stretch: pgvector + embeddings + hybrid RPC

### WS2: Ingestion (detect, crawl, normalize, readiness)
- **Scope:** platform detection, T0 adapters, sitemap + JSON-LD engine, normalization into `NormalizedProduct`, upsert via `src/lib/db`, crawl-run progress, readiness scoring, live offer re-verification.
- **Owns:** `src/lib/crawl/**` (`fetch.ts` polite fetch + robots, `detect.ts`, `adapters/{woocommerce,magento,squarespace,sfcc,shopify}.ts`, `sitemap.ts`, `jsonld.ts`, `normalize.ts`, `run.ts`), `src/lib/readiness/**`, `src/app/api/v1/stores/route.ts` (POST only), `src/app/api/v1/crawl-runs/**`.
- **Interfaces:** implements `PlatformAdapter` and exports `crawlStore(storeId, {maxProducts})`, `verifyOffer(variantId): Promise<Offer>` (used by WS3 `?verify=1` and by WS4 before quoting) and `computeReadiness(domain)`.
- **Milestones:**
  - [ ] `detect()` on the 6 demo domains (04's rule array)
  - [ ] WooCommerce Store API adapter, which also feeds our demo store
  - [ ] Sitemap + JSON-LD engine (05 §C sketch) working on BigCommerce and one custom store
  - [ ] `POST /api/v1/stores` end to end with progress
  - [ ] Magento GraphQL + Squarespace adapters
  - [ ] Readiness before/after
  - [ ] `verifyOffer`
  - [ ] Stretch: microdata/OG, Firecrawl T4, Claude Haiku T5 (confirm the model id and SDK structured-output API first), pgmq worker, Web Bot Auth signing
- **Packages:** cheerio, fast-xml-parser, robots-parser, p-queue (stretch: firecrawl, @anthropic-ai/sdk).

### WS3: Agent surface (MCP, REST read API, index outputs, discovery)
- **Scope:** everything an agent reads.
- **Owns:** `src/app/api/mcp/route.ts`, `src/lib/mcp/**` (tool registry: catalog tools implemented here, checkout tools delegating to WS4's `src/lib/checkout` service), `src/app/api/v1/{search,products}/**`, `src/app/api/v1/stores/[slug]/route.ts` + GET list, `src/app/s/[slug]/**` (route handlers: `products.json`, `products/[handle].json`, `feed.acp.jsonl`, `llms.txt`, `.well-known/ucp`), `src/app/llms.txt/`, `src/app/.well-known/**`, `src/app/openapi.json/`, `src/app/robots.ts`, `src/lib/formats/{shopify,ucp,acp}.ts` (serializers from `IndexedProduct`).
- **Interfaces:** consumes `src/lib/db`, `verifyOffer` (WS2) and the checkout service (WS4: `createCheckout`, `updateCheckout`, `getCheckout`, `completeCheckout`, `cancelCheckout`, all returning `CheckoutSession`). Until WS4 lands, stub the checkout tools to return `requires_escalation` + `continue_url`.
- **Milestones:**
  - [ ] MCP route alive (smoke test with MCP Inspector and Claude)
  - [ ] `search_catalog`, `get_product`, `list_stores`
  - [ ] `/s/{slug}/products.json` byte-compatible with Shopify's shape (diff it against allbirds)
  - [ ] llms.txt (root and per store)
  - [ ] `/.well-known/ucp` (mirror a live Shopify profile's structure)
  - [ ] `lookup_catalog`, `index_store`, `get_crawl_status`
  - [ ] ACP feed
  - [ ] openapi.json + agent-card
  - [ ] `agent_requests` logging
  - [ ] Stretch: `{slug}.shoperzero.app` subdomain rewrite in `proxy.ts`, NLWeb `/ask`, ACP REST aliases
- **Packages:** mcp-handler@2.2.0, @modelcontextprotocol/server@2.1.0. Fallback: `mcp-handler@1` + `@modelcontextprotocol/sdk@1` under `app/api/[transport]`.

### WS4: Checkout and payments
- **Scope:**
  - checkout state machine;
  - connectors: `woo_store_api` (primary), `handoff` (everyone else), `magento_guest` (stretch);
  - payment rails: `stripe_spt`, `x402`;
  - checkout REST and the x402 pay route;
  - demo wallet MCP;
  - Woo demo store infrastructure.
- **Owns:** `src/lib/checkout/**` (`service.ts`, `state.ts` with `transition()`, `connectors/{woo,handoff}.ts`), `src/lib/payments/**` (`stripe.ts` using `fetch` + a `Stripe-Version` header for preview endpoints, `x402.ts`), `src/app/api/v1/checkouts/**`, `src/app/api/v1/orders/**`, `src/app/api/demo-wallet/**`, `infra/woo/` (`docker-compose.woo.yml`, setup script), `scripts/agent-*.ts`.
- **Interfaces:** exports the checkout service (above) plus `CheckoutConnector` and `PaymentRail` implementations. Reads variants through `src/lib/db` and writes `checkouts`, `checkout_events` and `orders`.
- **Milestones:**
  - [ ] **T+15 spikes:** (a) the SPT test helper works on our account, (b) the x402.org facilitator `/supported` responds and the wallet is funded (faucet.circle.com)
  - [ ] Woo demo store up behind a tunnel with sample products, `bacs` enabled and flat-rate shipping
  - [ ] Woo connector: cart → quote (`expected_total`) → place
  - [ ] State machine + events
  - [ ] SPT rail: manual capture, void on failure
  - [ ] REST checkout endpoints
  - [ ] `handoff` connector
  - [ ] x402 pay route (`withX402`, upfront) plus a test that an unpaid call gets 402
  - [ ] Demo wallet MCP
  - [ ] `scripts/agent-x402.ts`
  - [ ] Stretch: ShoperZero Agent Pay Woo plugin (07 §5.6), Magento guest checkmo, Stagehand dry-run, Link CLI buyer
- **Packages:** stripe, @x402/core, @x402/next, @x402/evm, @x402/fetch, viem (stretch: @browserbasehq/stagehand@4.1.0).

### WS5: Web UI, demo and pitch
- **Scope:**
  - landing page with URL input;
  - scan page with live Realtime progress and the readiness F→A grade;
  - store page (products grid, links to every agent surface, "connect to Claude" snippet);
  - checkout timeline (Realtime on `checkout_events`, tx/pi links);
  - claim page (DNS TXT / meta-tag check);
  - metrics strip;
  - demo script, pre-caching and a recorded fallback video.
- **Owns:** `src/app/page.tsx`, `src/app/(site)/**`, `src/components/**`, `src/app/layout.tsx`/`globals.css`, `src/app/api/v1/claims/**`, `docs/demo/**`, `mock/`.
- **Interfaces:** reads via `src/lib/supabase/client.ts` (public RLS) and REST GETs, triggers crawls through `POST /api/v1/stores`, and uses the `ReadinessReport` and `CheckoutSession` types.
- **Milestones:**
  - [ ] Landing + scan against seed data
  - [ ] Live crawl progress
  - [ ] Store page with agent-surface links
  - [ ] Checkout timeline
  - [ ] Metrics
  - [ ] Claim flow
  - [ ] Rehearse the demo twice, record a backup
  - [ ] Stretch: "copy MCP config" button, before/after `curl` split screen
- **Packages:** none beyond the base install.

---

## 6. Contracts first (`src/lib/contracts/`)

Copy verbatim into `src/lib/contracts/index.ts` (WS1). All money is **integer minor units**.

```ts
// ---------- primitives ----------
export type Money = { amount: number; currency: string };      // amount in minor units (cents), ISO 4217
export type Availability = "in_stock" | "out_of_stock" | "preorder" | "unknown";
export type Platform =
  | "woocommerce" | "magento" | "bigcommerce" | "squarespace" | "sfcc"
  | "prestashop" | "wix" | "shopify" | "custom" | "unknown";
export type ExtractionSource = "platform_api" | "jsonld" | "microdata" | "opengraph" | "render" | "llm";
export type CheckoutConnectorId = "woo_store_api" | "magento_guest" | "handoff" | "browser";
export type PaymentRailId = "stripe_spt" | "x402";
export const UCP_VERSION = "2026-08-25";
export const ACP_VERSION = "2026-04-17";
export const PAYMENT_HANDLER_IDS = { stripe_spt: "app.shoperzero.stripe_spt", x402: "app.shoperzero.x402" } as const;

// ---------- catalog: crawler output (WS2 produces) ----------
export interface Offer {
  price: Money;
  compare_at: Money | null;          // strikethrough/list price
  availability: Availability;
  url: string | null;                // PDP URL with this variant selected
  checked_at: string;                // ISO; when price/stock was last observed
}
export interface NormalizedVariant {
  external_id: string | null;        // source variant id / sku; stable across crawls
  title: string;                     // "M / Blue" or "Default Title"
  options: Record<string, string>;   // { Size: "M", Color: "Blue" }
  sku: string | null;
  gtin: string | null;
  image_url: string | null;
  inventory_quantity: number | null;
  offer: Offer;
}
export interface NormalizedProduct {
  external_id: string | null;        // productGroupID ?? productID ?? sku
  url: string;                       // canonical PDP on the merchant site
  handle: string;                    // url slug, unique per store
  title: string;
  description_html: string | null;
  description_text: string | null;
  brand: string | null;
  product_type: string | null;
  category: string | null;
  tags: string[];
  images: { url: string; alt?: string }[];   // hotlinked, never re-hosted
  options: { name: string; values: string[] }[];
  variants: NormalizedVariant[];     // ALWAYS >= 1 (synthesize "Default Title" when none)
  source: ExtractionSource;
  raw?: unknown;                     // source payload -> products.raw
}

// ---------- catalog: indexed (DB/API shape, WS1/WS3) ----------
export interface IndexedVariant extends NormalizedVariant { id: string; seq: number; product_id: string }
export interface IndexedProduct extends Omit<NormalizedProduct, "variants" | "raw"> {
  id: string;                        // uuid, used by MCP/REST
  seq: number;                       // numeric id, used by products.json
  store: { id: string; slug: string; name: string | null; domain: string; platform: Platform };
  price_range: { min: Money; max: Money };
  available: boolean;
  variants: IndexedVariant[];
  checkout_methods: CheckoutConnectorId[];
  updated_at: string;
}

// ---------- store ----------
export type StoreStatus = "pending" | "crawling" | "indexed" | "failed" | "blocked";
export interface ReadinessCheck { id: string; label: string; pass: boolean; weight: number; detail?: string }
export interface ReadinessReport {
  score: number; grade: "A" | "B" | "C" | "D" | "F"; checks: ReadinessCheck[]; computed_at: string;
}
// Checks: products_json, well_known_ucp, mcp_endpoint, llms_txt, jsonld_product_coverage, sitemap, robots_allows_agents, agent_checkout
export interface Store {
  id: string; slug: string; domain: string; name: string | null;
  platform: Platform; currency: string | null; country: string | null;
  status: StoreStatus;
  product_count: number;
  strategy: { tier: ExtractionSource; adapter?: Platform; sampled_at?: string } | null;
  checkout_connector: CheckoutConnectorId;         // "handoff" unless a real connector works
  readiness: { before?: ReadinessReport; after?: ReadinessReport };
  claimed: boolean;
  last_crawled_at: string | null;
  urls: { products_json: string; llms_txt: string; feed: string; ucp: string; mcp: string };
}
export interface CrawlRun {
  id: string; store_id: string; status: "queued" | "running" | "succeeded" | "failed";
  strategy: string | null; products_found: number; pages_fetched: number; pages_failed: number;
  error: string | null; started_at: string | null; finished_at: string | null;
}

// ---------- crawler plug-in (WS2) ----------
export interface CrawlContext { domain: string; baseUrl: string; homepageHtml: string; headers: Headers; fetch: typeof fetch }
export interface PlatformAdapter {
  platform: Platform;
  detect(ctx: CrawlContext): Promise<number>;      // confidence 0..1
  listProducts(ctx: CrawlContext, opts: { max: number }): AsyncIterable<NormalizedProduct>;
  fetchOffer?(ctx: CrawlContext, product: { url: string; external_id: string | null }, variantExternalId: string | null): Promise<Offer>;
}

// ---------- checkout (WS4; UCP-shaped externally) ----------
export type CheckoutStatus =                       // UCP status, what agents see
  | "incomplete" | "requires_escalation" | "ready_for_complete"
  | "complete_in_progress" | "completed" | "canceled";
export type CheckoutState =                        // internal state machine (07 §5.4)
  | "quoting" | "awaiting_payment" | "requires_action" | "payment_authorized"
  | "placing_order" | "order_placed" | "completed" | "refunding" | "failed" | "expired" | "canceled";
export const STATE_TO_STATUS: Record<CheckoutState, CheckoutStatus> = {
  quoting: "incomplete", awaiting_payment: "ready_for_complete", requires_action: "requires_escalation",
  payment_authorized: "complete_in_progress", placing_order: "complete_in_progress",
  order_placed: "completed", completed: "completed", refunding: "complete_in_progress",
  failed: "canceled", expired: "canceled", canceled: "canceled",
};
export interface Address {
  name: string; line1: string; line2?: string; city: string; region?: string;
  postal_code: string; country: string;            // ISO-3166 alpha-2
}
export interface Buyer { email: string; name?: string; phone?: string }
export interface LineItem {
  id: string; variant_id: string; product_id: string; title: string;
  quantity: number; unit_price: Money; total: Money; image_url?: string | null;
}
export interface ShippingOption { id: string; title: string; amount: Money }
export type TotalType = "subtotal" | "shipping" | "tax" | "discount" | "total";
export interface PaymentHandler {
  id: (typeof PAYMENT_HANDLER_IDS)[PaymentRailId];
  rail: PaymentRailId;
  config:
    | { rail: "stripe_spt"; profile?: string; accepted: ["card"] }
    | { rail: "x402"; pay_url: string; network: "eip155:84532" | "eip155:8453"; asset: "USDC"; amount: string /* "$42.17" */ };
}
export interface Message { type: "error" | "warning" | "info"; code: string; content: string }
export interface CheckoutSession {
  id: string;
  ucp_version: typeof UCP_VERSION;
  store: { id: string; slug: string; domain: string };
  connector: CheckoutConnectorId;
  state: CheckoutState;
  status: CheckoutStatus;
  line_items: LineItem[];
  buyer?: Buyer;
  fulfillment?: { address?: Address; options: ShippingOption[]; selected_option_id?: string };
  totals: { type: TotalType; amount: number }[];  // minor units, in `currency`
  currency: string;
  payment: { handlers: PaymentHandler[] };
  continue_url?: string;                          // handoff / escalation URL
  messages?: Message[];
  order?: Order;
  expires_at: string | null;
  created_at: string; updated_at: string;
}
export interface CreateCheckoutInput {
  line_items: { variant_id: string; quantity: number }[];
  buyer?: Buyer;
  fulfillment?: { address: Address };
}
export interface UpdateCheckoutInput extends Partial<CreateCheckoutInput> { selected_shipping_option_id?: string }
export interface PaymentInstrument {
  handler_id: PaymentHandler["id"];
  type: "card" | "x402";
  credential: { type: "spt"; token: string } | { type: "x402_receipt"; tx_hash: string };
}
export interface CompleteCheckoutInput { payment: { instruments: [PaymentInstrument] }; idempotency_key?: string }
export interface Order {
  id: string; checkout_id: string; store_id: string;
  status: "placed" | "confirmed" | "failed" | "refunded";
  merchant_order_id: string | null; merchant_order_url: string | null;
  payment: { rail: PaymentRailId; reference: string; amount: Money; payer?: string };
  created_at: string;
}

// ---------- checkout plug-ins (WS4) ----------
export interface Quote { line_items: LineItem[]; shipping_options: ShippingOption[]; totals: CheckoutSession["totals"]; currency: string; connector_state: Record<string, unknown> }
export interface CheckoutConnector {
  id: CheckoutConnectorId;
  quote(store: Store, input: CreateCheckoutInput & { selected_shipping_option_id?: string }, prev?: Record<string, unknown>): Promise<Quote>;
  placeOrder(checkout: CheckoutSession, connectorState: Record<string, unknown>, receipt: PaymentReceipt): Promise<{ merchant_order_id: string; merchant_order_url: string | null }>;
  continueUrl(store: Store, input: CreateCheckoutInput): string;   // always available for handoff
}
export interface PaymentReceipt { rail: PaymentRailId; reference: string; amount: Money; payer?: string; captured: boolean }
export interface PaymentRail {
  id: PaymentRailId;
  authorize(checkout: CheckoutSession, instrument: PaymentInstrument): Promise<PaymentReceipt>;  // SPT: PI manual capture; x402: already settled upfront
  capture(receipt: PaymentReceipt): Promise<PaymentReceipt>;
  voidOrRefund(receipt: PaymentReceipt): Promise<void>;          // x402: log only (mock)
}
```

### MCP tools (`/api/mcp`, WS3; names match Shopify's UCP MCP)

Every tool accepts optional `meta["ucp-agent"].profile` and logs it without requiring it. Every tool returns `structuredContent` plus a short text summary.

| Tool | Input | Output | Stream |
|---|---|---|---|
| `list_stores` | `{query?, platform?, has_checkout?, limit?≤50}` | `Store[]` (trimmed) | WS3 |
| `search_catalog` | `{catalog:{query?, store?, filters?:{price?:{min?,max?}, available?=true, brands?[]}, pagination?:{cursor?, limit?≤50=10}}}` | `{products: IndexedProduct-lite[], pagination:{cursor, has_next_page}}` | WS3 |
| `lookup_catalog` | `{catalog:{ids: string[]≤10}}` (product/variant uuid, or `store:seq`) | `{products: IndexedProduct[], not_found: string[]}` | WS3 |
| `get_product` | `{catalog:{id, verify?:boolean}}` | `IndexedProduct` (with a live `offer` when `verify`) | WS3 + WS2 `verifyOffer` |
| `index_store` | `{url}` | `{store: Store, crawl_run_id}` | WS3 → WS2 `crawlStore` |
| `get_crawl_status` | `{crawl_run_id}` | `CrawlRun` | WS3 |
| `create_checkout` | `{checkout: CreateCheckoutInput}` | `CheckoutSession` (`ready_for_complete`, or `requires_escalation` + `continue_url`) | WS3 → WS4 |
| `update_checkout` | `{id, checkout: UpdateCheckoutInput}` | `CheckoutSession` | WS3 → WS4 |
| `get_checkout` | `{id}` | `CheckoutSession` | WS3 → WS4 |
| `complete_checkout` | `{id, checkout: CompleteCheckoutInput}` | `CheckoutSession` (`completed` + `order`) | WS3 → WS4 |
| `cancel_checkout` | `{id}` | `CheckoutSession` | WS3 → WS4 |
| `get_order` | `{id}` | `Order` | WS3 → WS4 |

**Demo wallet MCP** (`/api/demo-wallet/mcp`, WS4, test only):
- `wallet_issue_spt({amount, currency, checkout_id})` returns `{token:"spt_..."}`.
- `wallet_pay_x402({pay_url})` returns `{tx_hash, payer}`. The agent then calls `complete_checkout` with `credential {type:"x402_receipt", tx_hash}`, and the server matches the tx to the checkout's `orders` row.

---

## 7. Top risks and cut list

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Bot protection** (about 30% of probed stores gave 403/challenges; Vercel datacenter IPs) | Pick demo stores now (04's list, all checked today). Pre-crawl them and cache in the DB; the live demo re-scans only one. Mark challenged stores `blocked`, never bypass. Keep a recorded video. |
| 2 | **SPT preview endpoint not enabled** on our Stripe account | 15-min spike. Fallback: a plain PaymentIntent with `pm_card_visa`, same code path, labeled "SPT-compatible". |
| 3 | **x402 quirks**: route-key mismatch silently disables payment; upfront flow on the free facilitator unverified | Test that an unpaid call gets 402. Fall back to the default flow + `onAfterSettle`, or the hand-rolled 402 route (~40 lines, 02). |
| 4 | **mcp-handler v2 on Next 16.3** not yet run | Smoke-test in the first hour. Fallback: `mcp-handler@1` + `@modelcontextprotocol/sdk@1`. |
| 5 | **Woo demo store / tunnel flakiness** (site URL must equal the tunnel URL) | Named tunnel, or a hosted sandbox (07 §5.5 Option B). Take a DB snapshot after setup. |
| 6 | **Stale price → failed checkout** | `verifyOffer` before quoting, Woo `expected_total`, 10-min quote TTL, immutable total for x402. |
| 7 | **UCP conformance**: strict agents may reject our profile | Mirror a live Shopify profile's structure exactly. Claim only the catalog + checkout capabilities we implement. |
| 8 | **Merchant-of-record / legal** (reselling, image re-hosting, consent) | Hotlink images, honor robots + Content-Signal, identifiable UA, opt-out + claim flow. Say "demo; production = plugin/Connect settlement" in the pitch. |
| 9 | **"Why not Shopify's Agentic plan?"** | Answer: it needs merchant sign-up and sync. We're zero-touch, open, merchant-owned endpoints, and we cover Woo/Magento/custom now. |
| 10 | **Contract drift between streams** | Contracts frozen at T+30. Seed data lets UI and API build without the crawler. |

**Cut list, in order (cut from the top when behind):**
1. Stagehand/browser connector, Rye, Magento guest checkout
2. pgmq worker/cron (keep `after()`)
3. Embeddings/hybrid search (FTS is enough)
4. Firecrawl T4 and Claude T5 extraction
5. Subdomain-per-store `.well-known`
6. openapi.json, agent-card, NLWeb `/ask`
7. ACP feed (keep products.json + MCP)
8. Merchant claim flow (keep as a slide)
9. x402 rail (keep Stripe SPT); or cut Stripe and keep x402 if the SPT spike fails and x402 works

**Never cut:** Woo adapter + JSON-LD engine, `products.json`, MCP `search_catalog`/`get_product`/`create_checkout`/`complete_checkout`, the Woo connector with one payment rail, scan UI with live progress.
