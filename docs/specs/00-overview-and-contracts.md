# 00 — Overview and canonical contracts

Status: **canonical**. Specs 01–05 build on this file. Where this file and `docs/research/00-SYNTHESIS.md` disagree, this file wins; §8 lists every deviation from synthesis §6. The TypeScript in §6 was type-checked (TypeScript 5, zod 4.6.5, strict), and the SQL it depends on (spec 01 §4) was applied and exercised on Postgres 17 before this spec was written.

Read `AGENTS.md` first. Next.js 16.3.6 differs from older versions. Check `node_modules/next/dist/docs/` before writing any route handler, `proxy.ts` change, `after()` call or segment config.

## MVP scope

Stripe test payments are the only payment rail. See DECISIONS.md for the current scope and TEAM-SPLIT.md for the event deadlines.

## Round-2 changes

`docs/specs/DECISIONS.md` is binding and overrides any text here that disagrees with it. This file folds it in as follows:

- **Scan and score (DECISIONS §A).** New contract file `src/contracts/scan.ts` (§6.5a), exported from the barrel. `Store` gains `best_method`, `dom_recipe`, `latest_scan_id` (and `claimed_at`, WS5 CCR-8). New `scans` table, `stores` columns and the public `scan-screenshots` storage bucket (spec 01 §4). New routes `POST /api/v1/scans`, `GET /api/v1/scans/{id}` and MCP tools `scan_store`, `get_scan` (all WS2). New env vars (§4.7). The demo now opens with scan and score (§2).
- **Ownership (B1, B4, WS3 CR-3, WS5 CCR-9).** WS2 owns `src/features/scan/**`, `src/app/api/v1/scans/**`, and both `GET` and `POST` in `src/app/api/v1/stores/route.ts`. Registrars are per stream and `/api/mcp` composes them behind WS3's `instrumentServer` (§3.3, §6.9).
- **Contract changes (B5, B7, B9, B11, B14, WS4 CCR-W4-8).** `CheckoutEventData` (§6.6); `timeline_url` message code; `CrawlLogEntry` is `{at, step?, level, msg, data?}` (capped at 50); MCP/REST catalog outputs use the UCP product shape (`?format=indexed` for `IndexedProduct`); `get_product` accepts `catalog.selected`; Woo id mapping is pinned (§4.2). `CheckoutState` already had `handoff` and `quote()` already took `QuoteInput`.
- **db helpers (B12, 02 §15.3).** Adds `rowToStore`, `findProducts`, `getIndexStats`, `getScan`, `upsertScan`, `claimScan`, `getLatestScanForStore`, `getActiveScanForStore`, `countActiveScans`, `supersedeScans`, `uploadScanScreenshot`, `claimCrawlRun`, `getActiveCrawlRun`, `countActiveCrawlRuns`, `getVariantForVerify`, `getOrCreateClaim`, and WS2 CCR-1's `upsertStoreProducts` semantics (variants are never deleted, per-product failures are reported, unchanged products are skipped) (§6.10).
- **Error envelope (B11).** Unchanged: `{error: {code, message, details?}}` with the §4.4 code table. Stream-specific reasons go in `details.reason` (§4.4).

---

## 1. Product summary

1. ShoperZero makes any non-Shopify store agent-ready in about 60 seconds, with no plugin and no replatforming.
2. Paste a store URL and hit **Scan**. A discovery agent tries three access methods in order (`api` → `dom` → `computer_use`), stops at the first that works, and shows an **Agent Readiness Score** with the cost and time per agent task. "Make it agent-ready" then indexes the store with the best method found: we detect the platform, pull the catalog the cheapest way that works (platform API, then sitemap + JSON-LD / DOM recipe), and normalize it into Supabase.
3. From that single index we serve what Shopify stores get for free: a Shopify-compatible `products.json`, a UCP profile (`/.well-known/ucp`), an MCP server that uses Shopify's catalog tool names, an ACP feed, and `llms.txt`.
4. Agents can also buy. They pay ShoperZero with a Stripe Shared Payment Token (test mode), and we place the order through the store's own API (WooCommerce Store API). Stores we can't transact against headlessly get an honest `requires_escalation` hand-off with a prefilled-cart `continue_url`.
5. Merchants can claim a store (DNS TXT or meta tag) for a verified badge, or opt out. Positioning: "Cloudflare for agentic commerce: UCP for the other 80% of the web."

## 2. The 2-minute demo

| Time | Beat | What must work |
|---|---|---|
| 0:00 | **Hook.** `curl https://<woo-store>/products.json` returns 404: "Agents can't read this store." | nothing of ours |
| 0:10 | **Scan and score.** Paste a store URL on `/` and hit Scan. `/scan/{id}` shows one card per access method: `api` fails, `dom` passes or is partial, `computer_use` streams screenshots when it is reached. The score report lands (e.g. **D**), with the headline "API ≈ 1 s / $0.00 per task vs computer use ≈ 90 s / $0.30". | `POST /api/v1/scans`, scan in `after()`, Realtime on `scans`, `scan-screenshots` bucket |
| 0:35 | **Make it agent-ready.** One click on the CTA starts indexing with the best method found. The product counter ticks and the grade goes to **A**. Repeat quickly for `www.bulk.com/uk` (Magento) or a JSON-LD store. | `POST /api/v1/stores {store_id}`, crawl in `after()`, Realtime on `crawl_runs` + `stores` |
| 0:50 | **Outputs.** Open `/s/{slug}/products.json`, `/s/{slug}/llms.txt`, `/.well-known/ucp`. | WS3 index outputs |
| 1:00 | **Claude buys.** Claude is connected to `https://<app>/api/mcp`. Prompt: "find me a hoodie under $50 across these stores and buy it." Claude calls `search_catalog` → `get_product` → `create_checkout` (live Woo quote) → `complete_checkout` with an SPT. The timeline streams in our UI. | MCP + checkout service + Stripe rail + Realtime on `checkout_events` |
| 1:30 | **Proof.** The order is in WooCommerce admin with the payment reference in its note. | Woo connector, Stripe test payment |
| 1:45 | **Honesty + claim.** For the Magento store, checkout returns `requires_escalation` with a prefilled cart link. The merchant claims the store. Close. | `handoff` connector, claim flow |

---

## 3. Repo layout and ownership

### 3.1 Tree (target state; `(WSn)` = owner)

```
.
├── AGENTS.md, CLAUDE.md                     (nobody; do not edit)
├── package.json, package-lock.json          (WS1 only; see 3.4)
├── next.config.ts, tsconfig.json            (WS1 gatekeeper; others request changes)
├── .env.example                             (WS1)
├── docs/research/**                         (frozen)
├── docs/specs/**                            (spec authors)
├── docs/demo/**                             (WS5)
├── infra/woo/                               (WS4: docker-compose.woo.yml, setup script)
├── mock/                                    (WS5)
├── scripts/agent-*.ts                       (WS4)
├── scripts/crawl-*.ts, scripts/scan-*.ts    (WS2)
├── infra/fixtures/js-shop/                  (WS2: JS-only shop for the browser probes)
├── scripts/db/smoke.ts                      (WS1)
├── supabase/
│   ├── config.toml                          (WS1)
│   ├── seed.sql                             (WS1)
│   └── migrations/
│       ├── 20260926000000_init.sql          (frozen, already pushed)
│       ├── 20260926010000_core.sql          (WS1; includes scans, stores scan columns, scan-screenshots bucket)
│       └── 2026092602xxxx_<stream>_<what>.sql  (any stream, add-only, e.g. 20260926024000_ws4_checkout.sql)
└── src/
    ├── proxy.ts                             (WS1: matcher only)
    ├── app/
    │   ├── layout.tsx, globals.css, page.tsx          (WS5; `/` = URL input, scan-first landing)
    │   ├── (site)/scan/[id], stores/[slug], checkouts/[id], claim/[slug], bot   (WS5)
    │   ├── robots.ts                                  (WS3)
    │   ├── llms.txt/route.ts                          (WS3)
    │   ├── openapi.json/route.ts                      (WS3)
    │   ├── .well-known/ucp/route.ts, .well-known/ucp/[version]/route.ts   (WS3)
    │   ├── .well-known/agent-card.json/route.ts       (WS3)
    │   ├── s/[slug]/products.json/route.ts            (WS3)
    │   ├── s/[slug]/products/[handle]/route.ts        (WS3; serves /products/{handle}.json, see 4.12)
    │   ├── s/[slug]/feed.acp.jsonl/route.ts           (WS3)
    │   ├── s/[slug]/llms.txt/route.ts                 (WS3)
    │   ├── s/[slug]/.well-known/ucp/route.ts          (WS3)
    │   └── api/
    │       ├── mcp/route.ts                           (WS3)
    │       ├── demo-wallet/mcp/route.ts               (WS4)
    │       └── v1/
    │           ├── search/route.ts                    (WS3)
    │           ├── products/[id]/route.ts             (WS3)
    │           ├── stores/route.ts                    (WS2: POST and GET, see 3.3)
    │           ├── stores/[slug]/route.ts             (WS3)
    │           ├── crawl-runs/[id]/route.ts           (WS2)
    │           ├── scans/route.ts, scans/[id]/route.ts   (WS2: POST, GET)
    │           ├── checkouts/route.ts, checkouts/[id]/route.ts,
    │           │   checkouts/[id]/{complete,cancel}/route.ts,
    │           ├── orders/[id]/route.ts               (WS4)
    │           ├── claims/**                          (WS5)
    │           └── ui/**                              (WS5: UI-only helpers, not agent-facing)
    ├── components/**                                  (WS5)
    └── lib/
        ├── contracts/**                               (WS1; FROZEN after T+30)
        ├── db/**                                      (WS1)
        ├── supabase/{client,server,admin,proxy}.ts    (WS1 gatekeeper; existing scaffold)
        ├── money.ts, slug.ts                          (WS1)
        ├── errors.ts, http.ts, log.ts, env.ts         (WS1; new shared helpers)
        ├── crawl/** (incl. crawl/mcp-tools.ts)        (WS2)
        ├── scan/** (probes/{api,dom,computer-use}.ts, score.ts, run.ts)   (WS2)
        ├── readiness/**                               (WS2)
        ├── mcp/** (result.ts, types.ts, instrument.ts, instructions.ts, tools/catalog.ts)   (WS3)
        ├── agent/**                                   (WS3)
        ├── formats/{shopify,ucp,acp,llms,permalink,openapi,agent-card,text}.ts   (WS3)
        ├── checkout/** (incl. checkout/mcp-tools.ts)  (WS4)
        └── payments/** (incl. payments/demo-wallet-tools.ts) (WS4)
```

### 3.2 Directory ownership map (synthesis §5, updated by DECISIONS.md)

| Stream | Owns |
|---|---|
| **WS1** Foundation | `supabase/migrations/20260926010000_core.sql` (incl. `scans`, the `stores` scan columns and the `scan-screenshots` bucket), `src/contracts/**` (incl. `scan.ts`), `src/infrastructure/database/**` (typed repo functions, full list in §6.10: `upsertStoreProducts`, `getProduct`, `findProducts`, `searchProducts`, `getStoreBySlug`, `getStoreById`, `rowToStore`, `listStores`, `listStoreProducts`, `getLatestCrawlRun`, `getIndexStats`, `getScan`, `upsertScan`, `getLatestScanForStore`, `logAgentRequest`…), `src/shared/money.ts`, `src/shared/slug.ts`, `src/proxy.ts` (matcher only), `.env.example`, `supabase/seed.sql` |
| **WS2** Ingestion + scan | `infra/fixtures/js-shop/**`, `src/features/crawl/**` (`fetch.ts` polite fetch + robots, `detect.ts`, `adapters/{woocommerce,magento,squarespace,sfcc,shopify}.ts`, `sitemap.ts`, `jsonld.ts`, `normalize.ts`, `run.ts`, `mcp-tools.ts`), **`src/features/scan/**`** (`probes/api.ts`, `probes/dom.ts`, `probes/computer-use.ts`, `score.ts`, `run.ts`; `computer-use.ts` can be handed to a third person), `src/features/scan/readiness/**`, `src/app/api/v1/stores/route.ts` (**GET and POST**), `src/app/api/v1/crawl-runs/**`, **`src/app/api/v1/scans/**`**, `scripts/crawl-*.ts`, `scripts/scan-*.ts` |
| **WS3** Agent surface | `src/app/api/mcp/route.ts` (composes the registrars), `src/infrastructure/mcp/**` (`result.ts`, `types.ts`, `instrument.ts`, `instructions.ts`, `tools/catalog.ts`), `src/features/catalog/**`, `src/app/api/v1/{search,products}/**`, `src/app/api/v1/stores/[slug]/route.ts`, `src/app/s/[slug]/**` (route handlers: `products.json`, `products/[handle].json`, `feed.acp.jsonl`, `llms.txt`, `.well-known/ucp`), `src/app/llms.txt/`, `src/app/.well-known/**` (incl. `ucp/[version]`), `src/app/openapi.json/`, `src/app/robots.ts`, `src/features/catalog/formats/{shopify,ucp,acp,llms,permalink,openapi,agent-card,text}.ts` (serializers from `IndexedProduct`) |
| **WS4** Checkout & payments | `src/features/checkout/**` (`service.ts`, `state.ts` with `transition()`, `connectors/{index,woo,handoff}.ts` incl. `resolveCheckoutConnector()`, `mcp-tools.ts`), `src/features/checkout/payments/**` (`stripe.ts` using `fetch` + a `Stripe-Version` header for preview endpoints), `src/app/api/v1/checkouts/**`, `src/app/api/v1/orders/**`, `src/app/api/demo-wallet/**`, `infra/woo/` (`docker-compose.woo.yml`, setup script), `scripts/agent-*.ts`, `supabase/migrations/20260926024000_ws4_checkout.sql` |
| **WS5** Web UI & demo | `src/app/page.tsx` (scan-first landing), `src/app/(site)/**` (incl. `/scan/[id]` live cascade + score report, `/bot`), `src/components/**`, `src/app/layout.tsx`/`globals.css`, `src/app/api/v1/claims/**`, `src/app/api/v1/ui/**` (UI-only helpers, not in `openapi.json`), `docs/demo/**`, `mock/` |

### 3.3 Clarifications to the map (binding)

1. **WS1 also owns** the new shared helpers `src/shared/errors.ts`, `src/shared/http.ts`, `src/shared/log.ts`, `src/shared/env.ts`, plus `scripts/db/smoke.ts`. It is the gatekeeper for `package.json`, `next.config.ts`, `tsconfig.json`, `supabase/config.toml` and `src/infrastructure/supabase/**`.
2. **MCP registrars live with the stream that owns the logic (B4).** The MCP route (WS3) only composes registrars, all behind WS3's `instrumentServer(server)`:
   - `registerCatalogTools` in `src/infrastructure/mcp/tools/catalog.ts` (WS3): `list_stores`, `search_catalog`, `lookup_catalog`, `get_product`.
   - `registerCrawlTools` in `src/features/crawl/mcp-tools.ts` (WS2): `index_store`, `get_crawl_status`, `scan_store`, `get_scan`. The tool schemas WS3 wrote in round 1 move verbatim into spec 02.
   - `registerCheckoutTools` in `src/features/checkout/mcp-tools.ts` (WS4): `create_checkout`, `update_checkout`, `get_checkout`, `complete_checkout`, `cancel_checkout`, `get_order`. WS3 never registers `get_order` itself (a duplicate name throws at startup).
   - `registerDemoWalletTools` in `src/features/checkout/payments/demo-wallet-tools.ts` (WS4), mounted only on `/api/demo-wallet/mcp`.
   - `instrumentServer(server)` in `src/infrastructure/mcp/instrument.ts` (WS3) runs **first** and wraps every `registerTool` call from all three registrars. It is the **only** place MCP tool calls are logged to `agent_requests` (and rate-limited). WS2 and WS4 registrars must not call `logAgentRequest` themselves. REST routes still log themselves.

   This supersedes the synthesis line "checkout tools delegating to WS4's service" in `src/infrastructure/mcp/**`. Registrar type: `ToolRegistrar` in `src/infrastructure/mcp/types.ts` (see §6.9).
3. **`src/app/api/v1/stores/route.ts` is one file (B1).** WS2 owns it and implements **both** `POST` (submit) and `GET` (list). WS3 does not touch it. GET is a thin call to `db.listStores()` that returns `{ stores: StoreSummary[] }`, the same body as the `list_stores` MCP tool. POST accepts `{ url }` **or** `{ store_id }`, plus `force?: boolean`. It reuses the store's latest scan to pick the indexing method (DECISIONS §A), returns **200** with `IndexStoreResult` (`cached: true`) when the store is `indexed`, was crawled less than 6 h ago and `!force`, and otherwise **202** with `IndexStoreResult` (`{ store, crawl_run_id, status, reused, cached }`, WS5 CCR-3 + 02 §15). A store reachable by computer use only returns **422** `unprocessable`.
3a. **Scan routes (DECISIONS §A).** `POST /api/v1/scans` `{ url, mode? }` → **202** `ScanStartResult` `{ scan_id, store_id, status_url, report_url }` (the scan runs in `after()`; `maxDuration = 300`). `GET /api/v1/scans/{id}` → `ScanReport`. Both WS2. The UI follows the scan via Realtime on `scans`. After a scan, indexing maps `best_method` `api` → platform adapter and `dom` → sitemap + JSON-LD / DOM recipe. `computer_use` does not index a catalog: the store is marked reachable by computer use only.
3b. **Checkout connector choice (B10).** Everyone calls `resolveCheckoutConnector(store)` from `@/features/checkout/connectors` (WS4) to compute `stores.checkout_connector` and `IndexedProduct.checkout_methods`. Only allowlisted Woo stores get `woo_store_api`; all others get `handoff`. The checkout service always resolves again, so `stores.checkout_connector` is display only.
4. **T+30 stub files.** In the contracts commit, WS1 creates compile-ready stubs in other streams' directories so every import path exists from T+30. Ownership passes to the named stream the moment the commit lands. Owners replace the bodies and keep the exported names and types.
   - `src/features/crawl/index.ts` → WS2
   - `src/features/crawl/mcp-tools.ts` → WS2
   - `src/features/scan/index.ts` → WS2
   - `src/features/checkout/index.ts` → WS4
   - `src/features/checkout/mcp-tools.ts` → WS4
   - `src/infrastructure/mcp/result.ts`, `src/infrastructure/mcp/types.ts` → WS3

   Stub code is in spec 01 §3.

### 3.4 Shared-file rules

- **Contracts are frozen after T+30.** Change `src/contracts/**` only additively (a new optional field, a new type), with a heads-up in the team channel **before** pushing. Renaming or removing anything needs agreement from every stream that imports it.
- **Migrations are add-only (B15).** Never edit a migration that has been pushed, including `20260926010000_core.sql` once it's pushed. Streams may add their own migrations with later timestamps, `supabase/migrations/2026092602xxxx_<stream>_<what>.sql` (e.g. WS4's `20260926024000_ws4_checkout.sql`), and never edit the core one. `agent_requests.agent_profile` is now in core, so WS3 does not need its `20260926025000_ws3_agent_requests.sql` (if kept, it must use `add column if not exists`). Every new table must:
  - enable RLS;
  - `grant all ... to service_role`;
  - grant `select` to `anon, authenticated` only if it is meant to be public.

  Announce before `supabase db push`. Never change the schema in Studio.
- **Only WS1 runs `npm install`**, and it installs the union of all packages in one commit (spec 01 §2). Anyone who needs a new package asks WS1. WS1 installs it and pushes `package.json` + `package-lock.json` together.
- **The MCP route imports registrars from each stream** (3.3.2). WS2 and WS4 never edit `src/app/api/mcp/route.ts`. WS3 never implements checkout or crawl logic.
- **`src/proxy.ts`** stays Supabase-session-only. Only WS1 changes the matcher.
- **Commit hygiene:** commit only your own directories. If you must touch a shared file, say so in the commit message.

---

## 4. Conventions

### 4.1 Money
- **Integer minor units everywhere**: `Money = { amount: number /* int */, currency: "USD" }`. This covers the DB (`*_minor bigint`), contracts, MCP and REST.
- Convert only at the edges, with `src/shared/money.ts`:
  - `parsePrice` / `toMinor` / `rescaleMinor` when ingesting;
  - `fromMinor` for Shopify `"25.00"` strings;
  - `acpPrice` for `"25.00 USD"`;
  - `formatMoney` for UI display.
- Never use floats for arithmetic. Use `addMoney` / `multiplyMoney` / `sumMoney`, which throw on currency mismatch.
- Search price filters compare raw minor units in each product's own currency. When an agent passes `filters.price`, WS3 also passes `context.currency` (if given) as the `currency` filter.

### 4.2 IDs
| What | Format | Where |
|---|---|---|
| All DB primary keys (stores, products, variants, crawl runs, scans, checkouts, orders) | uuid v4 (`gen_random_uuid()`) | DB, MCP, REST, UI routes (`/scan/{scan_id}`) |
| WooCommerce external ids (B9) | `product.external_id` = Woo product id; `variant.external_id` = the **Store API purchasable id** (variation id for variable products, product id for simple products; never null); `variant.options` keys = Woo attribute names | WS2 writes, WS4's Woo connector reads (`POST /cart/add-item {id}`) |
| Shopify-compat numeric ids | `products.seq`, `product_variants.seq` (global bigint identity, starts at 1) | `products.json` `id`, `variants[].id`, `variants[].product_id` |
| Shopify-compat image ids | `product.seq * 1000 + position` (position 1-based) | `products.json` `images[].id` |
| Product refs accepted by `get_product` / `lookup_catalog` | product uuid, variant uuid (resolves to its parent product), or `"{store_slug}:{product_seq}"` | MCP, REST |
| Checkout line item ids | `"li_1"`, `"li_2"`… (1-based, stable within a checkout) | `CheckoutSession.line_items[].id` |
| Checkout event ids | bigint identity | `checkout_events.id` |
| Store slug | `storeSlugFromDomain(domain)`, e.g. `bulk-com-uk`; collisions get `-2`, `-3` | `/s/{slug}` |
| Product handle | `NormalizedProduct.handle` (platform slug, else `handleFromUrl(url)`); unique per store | `/s/{slug}/products/{handle}.json` |
| Variant key | `product_variants.external_id`: source id, else `sku:<sku>`, else `opt:<slug of option values>`, else `opt:<slug of title>`, else `default` (duplicates `~2`) | DB upsert key `(product_id, external_id)` |
| Idempotency keys | client string, at most 255 chars | `Idempotency-Key` header / `idempotency_key` arg |

We do **not** use `gid://`-style or `sz:product:` prefixes. Plain uuids are the public ids.

### 4.3 Timestamps
- The DB uses `timestamptz` everywhere, defaulting to `now()`. `updated_at` is maintained by triggers (`public.set_updated_at()`).
- APIs emit ISO 8601 UTC with milliseconds (`new Date(x).toISOString()`, e.g. `2026-09-26T10:00:00.000Z`). Mappers in `src/infrastructure/database/mappers.ts` normalize Postgres strings.
- The Shopify-compat output uses the same ISO strings in `created_at` / `updated_at` / `published_at`.

### 4.4 REST conventions
- **Success bodies** are the contract type directly: `CheckoutSession`, `CrawlRun`, `{ products, pagination }`… No `{ data: … }` wrapper.
- **Error envelope** (`ApiErrorBody`, `src/contracts/api.ts`) on every non-2xx JSON response:
  ```json
  { "error": { "code": "not_found", "message": "Product not found", "details": { "id": "…" }, "request_id": "5b0c…" } }
  ```

  | code | HTTP | when |
  |---|---|---|
  | `bad_request` | 400 | malformed JSON or query |
  | `validation_error` | 400 | zod failure; `details = z.flattenError(err)` |
  | `unauthorized` | 401 | reserved |
  | `forbidden` | 403 | opted-out store; demo wallet disabled |
  | `not_found` | 404 | unknown id / slug |
  | `conflict` | 409 | unique violation race |
  | `invalid_state` | 409 | checkout transition not allowed (`details: { state, allowed }`) |
  | `idempotency_conflict` | 409 | same `Idempotency-Key`, different body |
  | `gone` | 410 | checkout expired |
  | `unprocessable` | 422 | e.g. line items from two stores |
  | `rate_limited` | 429 | reserved |
  | `internal` | 500 | unexpected; message is always "Internal error" |
  | `not_implemented` | 501 | stubbed service or missing env var |
  | `upstream_error` | 502 | merchant / Stripe / facilitator error |
  | `upstream_blocked` | 502 | bot protection; store marked `blocked` |
  | `upstream_timeout` | 504 | merchant timeout |

  **B11:** this table is the only code list. Stream-specific reasons go in `details.reason`, never in `code`. WS5 CCR-3's and WS2's store-submit codes map as follows: `invalid_url` / `invalid_body` / `url_not_allowed` → `validation_error`; `opted_out` → `forbidden`; `blocked` → `upstream_blocked`; `too_many_crawls` → `rate_limited`; `internal` → `internal`. For example: `{ "error": { "code": "forbidden", "message": "Store opted out", "details": { "reason": "opted_out" } } }`. The UI switches on `code` and may refine it with `details.reason`.
- **Checkout business outcomes are not errors.** Out of stock, price changed, declined card and handoff return **HTTP 200** with a `CheckoutSession` whose `messages[]` explains (UCP convention). Protocol errors (validation, not found, invalid state) use the envelope.
- **Headers:**
  - every `/api/**`, `/s/**` and discovery response sends the CORS headers from `src/shared/http.ts`;
  - every response sends `Request-Id` (echoed from the request's `Request-Id` / `X-Request-Id`, else a fresh uuid);
  - every public route file exports `OPTIONS = preflight`.
- **Catalog product shape (B7).** MCP and REST catalog outputs (`search_catalog`, `lookup_catalog`, `get_product`, `GET /api/v1/search`, `GET /api/v1/products/{id}`) use the **UCP product shape** (`toUcpProduct`, WS3, spec 03 §6.4). Raw `IndexedProduct` is available at `GET /api/v1/products/{id}?format=indexed`. `structuredContent` equals the REST body.
- **Idempotency:** `POST /api/v1/checkouts` and `.../complete` honor the `Idempotency-Key` header. A repeat with the same key returns the stored result. The DB guards are `checkouts.idempotency_key unique` and `orders.checkout_id unique`.
- **Pagination:**
  - search uses an opaque `cursor` = base64url of `{"o":<offset>}` and returns `pagination: { cursor, has_next_page, total_count }`;
  - `products.json` uses Shopify's `?limit=&page=` (limit ≤ 250, default 30).
- **Handlers are wrapped** with `route(name, handler)` from `src/shared/http.ts`, which handles the request id, the error envelope and a timing log line.

### 4.5 MCP conventions
- Tool names and input shapes are in §6.8. Validate with the exported zod schemas: pass them as `inputSchema`. mcp-handler 2 accepts a `z.object`. UNVERIFIED on 16.3; fallback: pass `schema.shape`.
- **structuredContent == the REST twin's JSON body.**
  - Return `toolResult(structured, summary)` from `src/infrastructure/mcp/result.ts`. Its text block is a one-line summary **plus the compact JSON**, because some clients only pass `content` to the model.
  - Never throw out of a handler. Catch and return `toolError(err, toolName)`, which gives `isError: true` and `structuredContent: { error: { code, message, details? } }`.
- Do not declare `outputSchema` in the MVP. How SDK v2 validates `outputSchema` against error results is UNVERIFIED.
- Every tool accepts an optional `meta["ucp-agent"].profile`:
  - checkout tools store it in `checkouts.agent_profile`;
  - all tools log it; no tool requires it.
- Tool calls are logged **once**, by WS3's `instrumentServer` (`after(() => logAgentRequest({ surface: "mcp", tool, store_id, agent_profile }))`, with `store_id` taken from `structuredContent.store.id` / `store_id` when present). Registrars never log tool calls themselves (§3.3.2).
- Tool descriptions must say that prices are **integer minor units** ("$50 = 5000") and that the query takes keywords only.

### 4.6 Logging
- Use `log.info|warn|error|debug(event, fields)` from `src/shared/log.ts`: one JSON line on stdout/stderr. `debug` prints only when `LOG_LEVEL=debug`.
- Event names are `area.thing[.verb]`, for example:
  - `crawl.run.started`, `crawl.page.failed`;
  - `checkout.transition`;
  - `payment.spt.authorized`;
  - `mcp.tool.called`, `http.request`.
- Always include ids (`store_id`, `crawl_run_id`, `checkout_id`, `request_id`).
- **Never log:**
  - secrets, SPT tokens, Cart-Tokens or private keys;
  - buyer email, phone or address.

  The logger redacts keys that match `/token|secret|password|authorization|cookie|private_?key|signature|email|phone|address|line1|postal|cart_token/i`, but don't rely on it.
- `checkout_events.message` / `.data` are **public** (timeline). They may carry PI ids, merchant order ids and amounts. They must never carry PII.

### 4.7 Environment variables
Read env lazily through `src/shared/env.ts` (`optionalEnv`, `requireEnv`, `appUrl()`, `flags`), never at module top level, so `next build` works without secrets. A missing optional feature variable becomes `AppError("not_implemented")`. It never crashes the app.

| Variable | Exposure | Needed by | Example / default |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | all | `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | WS5 (browser Realtime / reads), proxy | `sb_publishable_…` |
| `SUPABASE_SECRET_KEY` | server | WS1 `db()` (so WS2, WS3, WS4, WS5 server code) | `sb_secret_…` |
| `SUPABASE_DB_PASSWORD` | CLI only | WS1 (`supabase link` / `db push`) | not read by the app |
| `APP_URL` | server | WS1 (`Store.urls`), WS2 (UA), WS3 (discovery URLs), WS4 (checkout and timeline links) | `http://localhost:3000`; prod `https://<app>.vercel.app` |
| `CRAWLER_USER_AGENT` | server | WS2 | `ShoperZeroBot/0.1 (+https://<app>/bot)` |
| `CRAWL_MAX_PRODUCTS` | server | WS2 | `150` |
| `CRAWL_TIME_BUDGET_MS` | server | WS2 | `240000` |
| `CRAWL_MAX_CONCURRENT_RUNS` | server | WS2 | `3` |
| `CRAWL_TIERS` | server | WS2 | `platform_api,jsonld` |
| `ALLOW_PRIVATE_STORE_HOSTS` | server | WS1 `normalizeStoreUrl`, WS2 | `false` (`true` locally if Woo runs on localhost) |
| `ANTHROPIC_API_KEY` | server | **core**: WS2 scan (DOM agent, computer-use probe); stretch: T5 extraction (WS2) | `sk-ant-…` |
| `BROWSERBASE_API_KEY` | server | WS2 scan (`dom`, `computer_use` probes), optional | empty = local Playwright / Chrome |
| `BROWSERBASE_PROJECT_ID` | server | WS2 scan, optional (with the key) | |
| `SCAN_CU_ENABLED` | server | WS2 scan | `1` (`0` skips the `computer_use` probe; its status becomes `skipped`) |
| `SCAN_CU_MAX_STEPS` | server | WS2 scan | `15` (hard cap on computer-use steps; always stop before payment) |
| `SCAN_MODEL` | server | WS2 scan (DOM recipe agent, computer use) | `claude-opus-5-5`. Cheaper overrides: `claude-sonnet-5`, `claude-haiku-4-5` |
| `SCAN_MAX_CONCURRENT` | server | WS2 scan | `3` (global cap on active scans; 429 `rate_limited` above) |
| `JS_SHOP_FIXTURE_URL` | server | WS2 (JS-only shop fixture for the `dom` / `computer_use` probes, `infra/fixtures/js-shop`) | empty |
| `LOG_LEVEL` | server | all | `info` |
| `STRIPE_SECRET_KEY` | server | WS4 | `sk_test_…` (WS4 refuses non-`sk_test_` keys) |
| `STRIPE_PREVIEW_VERSION` | server | WS4 | `2026-04-22.preview` |
| `STRIPE_SPT_MODE` | server | WS4 | `spt` (`fallback` = `pm_card_visa`) |
| `DEMO_WALLET_ENABLED` | server | WS4 | `true` in the demo deployment only |
| `DEMO_WALLET_TOKEN` | server | WS4 | shared secret for the demo wallet MCP, optional |
| `CHECKOUT_ALLOWED_DOMAINS` | server | WS4 | comma-separated allowlist for `woo_store_api` (empty = only `WOO_DEMO_URL`'s host) |
| `CHECKOUT_BROWSER_ENABLED` | server | WS4, stretch (browser connector) | `false` |
| `CHECKOUT_BROWSER_HOSTS` | server | WS4, stretch | comma-separated hosts the browser connector may drive |
| `CHECKOUT_FORCE_HANDOFF` | server | WS4, **dev only** | `false` |
| `WOO_DEMO_URL` | server | WS4 (connector target), WS2 (demo crawl) | `https://woo-demo.<tunnel-domain>` |
| `WOO_CONSUMER_KEY`, `WOO_CONSUMER_SECRET` | server | WS4, optional (order notes via REST v3; UNVERIFIED need) | `ck_…`, `cs_…` |
| `NEXT_PUBLIC_UI_MOCK` | public | WS5 | empty; `1` = UI runs on `mock/fixtures`, no Supabase |
| `OPENAI_API_KEY` | server | stretch: embeddings (WS1) | |
| `FIRECRAWL_API_KEY` | server | stretch: T4 render (WS2) | |
| `CRON_SECRET` | server | stretch: pgmq worker (WS2) | |

Local values go in `.env.local` (git-ignored). Deploy values go in Vercel project env, for both Production and Preview.

### 4.8 Naming
- **Files:** kebab-case (`crawl-runs.ts`, `mcp-tools.ts`). React components: PascalCase files in `src/components/`.
- **Types:** PascalCase. Zod schemas: `<Type>Schema` (e.g. `CreateCheckoutInputSchema`). Const arrays of enum values: `SCREAMING_CASE` plural (`CHECKOUT_STATES`).
- **Functions:** camelCase verbs. db helpers follow `get*` (returns `T | null`), `list*` (arrays), `insert*` / `update*` / `upsert*`.
- **JSON field names in DB, contracts, MCP and REST are `snake_case`**, including TS object keys of contract types. TS local variables are camelCase.
- **SQL:** snake_case; constraints named `<table>_<what>_check|key`; RPC params prefixed `p_` (except the reserved `query_text`, `match_count`, `match_offset`, `query_embedding`).
- **Routes:** REST under `/api/v1/<plural-noun>`; per-store agent files under `/s/{slug}/…`; UI under `/(site)`.

### 4.9 zod (v4)
- `import { z } from "zod"`. Use v4 APIs:
  - `z.uuid()`, `z.email()`, `z.url()`, `z.iso.datetime()`;
  - `z.record(z.string(), X)` (two args);
  - `z.looseObject({...})` instead of `.passthrough()`;
  - `z.flattenError(err)`, `z.toJSONSchema(schema, { io: "input" })`.
- **Validate every external input** at the boundary. Never trust a cast.
  - REST bodies go through `parseJsonBody(req, Schema)`; queries through `parseSearchParams(req, Schema)` with `z.coerce.number()` / `z.stringbool()`.
  - MCP args are validated by the SDK through `inputSchema`. Re-parse only if you transform.
  - Crawler output: `upsertStoreProducts` validates each product with `NormalizedProductSchema` and skips invalid ones.
  - Third-party API responses (Woo Store API, Stripe preview endpoints, facilitator) get a local zod schema in the owning stream. Parse the fields you use. Use `.catch()` / `.optional()` generously.
  - Webhooks, if any, are verified and then parsed.
- Input types are **inferred** from schemas (`z.infer`) and exported from contracts. Never hand-write a duplicate interface.

### 4.10 Server-only boundaries
- These start with `import "server-only"` and must never be imported from a `"use client"` module:
  - `src/infrastructure/database/**` (except `mappers.ts`)
  - `src/infrastructure/supabase/admin.ts`, `src/shared/http.ts`, `src/shared/env.ts`
  - `src/features/crawl/**`, `src/features/checkout/**`, `src/features/checkout/payments/**`, `src/infrastructure/mcp/**`
- These are isomorphic (safe in client components): `src/contracts/**`, `src/shared/money.ts`, `src/shared/slug.ts`, `src/shared/errors.ts`, `src/shared/log.ts`, `src/infrastructure/database/mappers.ts`.
- Secrets exist only in server env vars without the `NEXT_PUBLIC_` prefix.
- Scripts outside Next that import server-only modules must run with the `react-server` condition:
  ```bash
  node --env-file=.env.local --conditions=react-server --import tsx scripts/<name>.ts
  ```
  Without it, the `server-only` package throws.

### 4.11 Supabase client choice

| Use case | Client | Why |
|---|---|---|
| Any route handler, MCP tool, crawler, checkout code, server component reading index data | `db()` from `@/infrastructure/database` (typed service-role client, memoized) through the db helper functions | Bypasses RLS and needs no cookies. Agent routes must not touch cookies. |
| Browser: Realtime subscriptions (`scans`, `crawl_runs`, `stores`, `checkout_events`) and public reads/RPCs (`search_products`, `get_public_metrics`) | `createClient()` from `@/infrastructure/supabase/client` (publishable key) | Public RLS policies allow it |
| Server Components that need the user session | `createClient()` from `@/infrastructure/supabase/server` | Not needed in the MVP (no auth). Calling `cookies()` makes the route dynamic. |
| Session refresh | `@/infrastructure/supabase/proxy` from `src/proxy.ts` only | Existing scaffold |

Direct `.from(...)` queries outside `src/infrastructure/database/**` are allowed only in WS5 client components (public reads) and in migrations/scripts. Everything else goes through a db helper. If a helper is missing, ask WS1 or add it with a heads-up.

Realtime example (WS5):
```ts
supabase.channel(`crawl:${id}`)
  .on("postgres_changes", { event: "UPDATE", schema: "public", table: "crawl_runs", filter: `id=eq.${id}` }, (p) => setRun(p.new))
  .subscribe();
```

### 4.12 Next.js 16 rules (checked in `node_modules/next/dist/docs/`)
- **Route handler params are async.** Use `RouteContext<'/api/v1/products/[id]'>` (a global type generated by `next dev` / `next build` / `next typegen`) and `const { id } = await ctx.params`.
- `GET` route handlers are **not cached** by default. Leave them dynamic.
- Route segment config:
  - `export const maxDuration = 300` on the crawl-start route (`POST /api/v1/stores`), the scan-start route (`POST /api/v1/scans`), the MCP route (B8: `index_store` and `scan_store` schedule work with `after()`) (`after()` runs within the route's `maxDuration`);
  - `export const runtime = "nodejs"` is the default. **Never use `edge`**, which is deprecated.
- `after()` from `next/server` works in route handlers, including inside functions they call, such as `startStoreCrawl()`. It runs even when the response errored.
- `proxy.ts` replaces `middleware.ts`. Its matcher must be a static constant.
- **Dotted route folders:**
  - `src/app/llms.txt/route.ts`, `src/app/openapi.json/route.ts` and `src/app/s/[slug]/products.json/route.ts` are normal static segments.
  - `/s/{slug}/products/{handle}.json` is served by `src/app/s/[slug]/products/[handle]/route.ts`. The param arrives as `"foo.json"`: strip the `.json` suffix, and return 404 when it is missing.
  - `.well-known` folders (`src/app/.well-known/ucp/route.ts`) are UNVERIFIED on 16.3. Fallback: WS1 adds `rewrites()` in `next.config.ts` from `/.well-known/:path*` to `/api/well-known/:path*`, and from `/s/:slug/.well-known/ucp` to `/s/:slug/well-known/ucp`.

---

## 5. Contract files (`src/contracts/`)

| File | Contents |
|---|---|
| `primitives.ts` | `Money`, `MoneySchema`, `CurrencySchema`, `IsoDateTime`, enum value arrays + union types (`Availability`, `Platform`, `ExtractionSource`, `CheckoutConnectorId`, `PaymentRailId`, `AgentSurface`), protocol constants (`UCP_VERSION`, `UCP_SUPPORTED_VERSIONS`, `ACP_VERSION`, `PAYMENT_HANDLER_IDS`), limits |
| `api.ts` | `API_ERROR_STATUS`, `ApiErrorCode`, `ApiErrorBody` |
| `catalog.ts` | `OfferSchema`/`Offer`, `NormalizedVariantSchema`/`NormalizedVariant`, `NormalizedProductSchema`/`NormalizedProduct`, `StoreRef`, `IndexedVariant`, `IndexedProduct`, `ProductSummary`, `SearchParams`, `SearchResult` |
| `store.ts` | `StoreStatus`, readiness (`ReadinessCheckId`, `READINESS_WEIGHTS`, `gradeFor`, `ReadinessCheck`, `ReadinessReport`), `StoreStrategy`, `StoreUrls`, `Store`, `StoreSummary`, `CrawlRun`, `CrawlStep`, `CrawlLogEntry`, `StoreClaim`, `ClaimMethod`, `PublicMetrics` |
| `crawl.ts` | `CrawlContext`, `PlatformAdapter` |
| `scan.ts` (round 2) | `AccessMethod`, `ProbeStatus`, `Capabilities`, `ProbeSignal`, `DomRecipe`, `AccessProbe`, `ScanMode`, `ScanStatus`, `ScanReport` (DECISIONS §A, verbatim), plus value arrays, `CreateScanInputSchema`, `ScanStartResult` |
| `checkout.ts` | statuses/states + `STATE_TO_STATUS` + `ALLOWED_TRANSITIONS`, input schemas + inferred types (`Address`, `Buyer`, `LineItemInput`, `CreateCheckoutInput`, `UpdateCheckoutInput`, `PaymentCredential`, `PaymentInstrument`, `CompleteCheckoutInput`), outputs (`LineItem`, `ShippingOption`, `Total`, `PaymentHandler`, `Message`, `CheckoutLink`, `Order`, `CheckoutSession`, `CheckoutEvent`, `CheckoutEventData`), persistence (`CheckoutPaymentRecord`, `CheckoutRecord`), plug-ins (`ResolvedLine`, `QuoteInput`, `Quote`, `CheckoutConnector`, `PaymentReceipt`, `PaymentRail`) |
| `mcp.ts` | `UcpMetaSchema`, every tool input schema, output types (incl. the open `UcpProduct`), `MCP_TOOL_INPUTS`, `DEMO_WALLET_TOOL_INPUTS`, `ToolResult` |
| `services.ts` | `RequestContext`, WS2 function types (`StartStoreCrawlFn`, `CrawlStoreFn`, `VerifyOfferFn`, `ComputeReadinessFn`, `StartScanFn`, `RunScanFn`), WS4 `CheckoutService` |
| `index.ts` | barrel. Always `import { … } from "@/contracts"` |

```ts
// src/contracts/index.ts
export * from "./primitives";
export * from "./api";
export * from "./catalog";
export * from "./store";
export * from "./crawl";
export * from "./scan";
export * from "./checkout";
export * from "./mcp";
export * from "./services";
```

Contracts are isomorphic: zod is their only dependency.

---

## 6. Canonical contracts (copy verbatim)

### 6.1 `src/contracts/primitives.ts`
```ts
import { z } from "zod";

// ---------- money ----------
/** amount = INTEGER minor units (cents); currency = ISO 4217, upper-case. */
export type Money = { amount: number; currency: string };
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, "ISO 4217 upper-case code");
export const MoneySchema = z.object({
  amount: z.number().int().min(0),
  currency: CurrencySchema,
});

/** ISO 8601 UTC timestamp string, e.g. "2026-09-26T10:00:00.000Z". */
export type IsoDateTime = string;

// ---------- enumerations (single source of truth; DB CHECK constraints mirror these) ----------
export const AVAILABILITIES = ["in_stock", "out_of_stock", "preorder", "unknown"] as const;
export type Availability = (typeof AVAILABILITIES)[number];

export const PLATFORMS = [
  "woocommerce", "magento", "bigcommerce", "squarespace", "sfcc",
  "prestashop", "wix", "shopify", "custom", "unknown",
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const EXTRACTION_SOURCES = ["platform_api", "jsonld", "microdata", "opengraph", "render", "llm", "dom_recipe"] as const; // dom_recipe: WS2 stretch tier
export type ExtractionSource = (typeof EXTRACTION_SOURCES)[number];

export const CHECKOUT_CONNECTOR_IDS = ["woo_store_api", "magento_guest", "handoff", "browser"] as const;
export type CheckoutConnectorId = (typeof CHECKOUT_CONNECTOR_IDS)[number];

export const PAYMENT_RAIL_IDS = ["stripe_spt"] as const;
export type PaymentRailId = (typeof PAYMENT_RAIL_IDS)[number];

export const AGENT_SURFACES = ["mcp", "rest", "products_json", "feed", "llms_txt", "ucp", "openapi", "agent_card"] as const;
export type AgentSurface = (typeof AGENT_SURFACES)[number];

// ---------- protocol constants (pin here, import everywhere) ----------
export const UCP_VERSION = "2026-08-25" as const;
export const UCP_SUPPORTED_VERSIONS = ["2026-08-25", "2026-04-08"] as const;
export const ACP_VERSION = "2026-04-17" as const;
export const PAYMENT_HANDLER_IDS = {
  stripe_spt: "app.shoperzero.stripe_spt",
} as const;
export type PaymentHandlerId = (typeof PAYMENT_HANDLER_IDS)[PaymentRailId];

// ---------- limits ----------
export const QUOTE_TTL_SECONDS = 600;          // checkout quote validity (10 min)
export const DEFAULT_MAX_PRODUCTS_PER_CRAWL = 150;
export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_LIMIT = 50;
export const LOOKUP_MAX_IDS = 10;
export const LIST_STORES_MAX_LIMIT = 50;
export const PRODUCTS_JSON_DEFAULT_LIMIT = 30;  // Shopify default
export const PRODUCTS_JSON_MAX_LIMIT = 250;
```

### 6.2 `src/contracts/api.ts`
```ts
// REST error envelope + codes. Every non-2xx JSON response from /api/** uses ApiErrorBody.
export const API_ERROR_STATUS = {
  bad_request: 400,          // malformed JSON, bad query string
  validation_error: 400,     // zod failure; details = z.flattenError(err)
  unauthorized: 401,
  forbidden: 403,            // opted-out store, demo wallet disabled
  not_found: 404,
  conflict: 409,             // unique violation (e.g. duplicate store slug race)
  invalid_state: 409,        // checkout transition not allowed from current state
  idempotency_conflict: 409, // same Idempotency-Key, different body
  gone: 410,                 // checkout expired
  unprocessable: 422,        // semantically invalid (e.g. variants from two stores in one checkout)
  rate_limited: 429,
  internal: 500,
  not_implemented: 501,      // stubbed service not landed yet
  upstream_error: 502,       // merchant store / Stripe / facilitator returned an error
  upstream_blocked: 502,     // merchant bot-protection (403/challenge); store marked blocked
  upstream_timeout: 504,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;          // human readable, safe to show to agents (no secrets, no PII)
    details?: unknown;        // e.g. zod flattened errors, {state, allowed}
    request_id?: string;      // echoes the Request-Id response header
  };
}
```

### 6.3 `src/contracts/catalog.ts`
```ts
import { z } from "zod";
import {
  AVAILABILITIES, EXTRACTION_SOURCES, MoneySchema,
  type CheckoutConnectorId, type IsoDateTime, type Money, type Platform,
} from "./primitives";

// ---------- crawler output (WS2 produces; validated by db.upsertStoreProducts) ----------
export const OfferSchema = z.object({
  price: MoneySchema,
  compare_at: MoneySchema.nullable(),            // strikethrough / list price
  availability: z.enum(AVAILABILITIES),
  url: z.url().nullable(),                      // PDP URL with this variant selected
  checked_at: z.iso.datetime({ offset: true }),  // when price/stock was observed
});
export type Offer = z.infer<typeof OfferSchema>;

export const NormalizedVariantSchema = z.object({
  external_id: z.string().min(1).max(255).nullable(), // source variant id / sku; stable across crawls. Woo: Store API purchasable id (B9). WS2 always fills it.
  title: z.string().min(1).max(500),                   // "M / Blue" or "Default Title"
  options: z.record(z.string(), z.string()),           // { Size: "M", Color: "Blue" }
  sku: z.string().max(255).nullable(),
  gtin: z.string().max(64).nullable(),
  image_url: z.url().nullable(),
  inventory_quantity: z.number().int().nullable(),
  offer: OfferSchema,
});
export type NormalizedVariant = z.infer<typeof NormalizedVariantSchema>;

export const NormalizedProductSchema = z.object({
  external_id: z.string().min(1).max(255).nullable(), // productGroupID ?? productID ?? sku. Woo: the Woo product id (B9)
  url: z.url(),                                        // canonical absolute PDP URL on the merchant site
  handle: z.string().min(1).max(255),                  // slug.ts handleFromUrl(url) unless the platform gives one
  title: z.string().min(1).max(500),
  description_html: z.string().nullable(),
  description_text: z.string().nullable(),
  brand: z.string().max(255).nullable(),
  product_type: z.string().max(255).nullable(),
  category: z.string().max(500).nullable(),
  tags: z.array(z.string().max(100)).max(100),
  images: z.array(z.object({ url: z.url(), alt: z.string().optional() })).max(50), // hotlinked, never re-hosted
  options: z.array(z.object({ name: z.string().min(1), values: z.array(z.string()) })).max(10), // products.json emits the first 3
  variants: z.array(NormalizedVariantSchema).min(1).max(250), // ALWAYS >= 1 (synthesize "Default Title")
  source: z.enum(EXTRACTION_SOURCES),
  raw: z.unknown().optional(),                         // source payload -> products.raw (dropped if > 100 KB)
});
export type NormalizedProduct = z.infer<typeof NormalizedProductSchema>;

// ---------- indexed (DB/API shape; WS1 maps, WS3 serializes) ----------
export interface StoreRef {
  id: string;
  slug: string;
  name: string | null;
  domain: string;
  platform: Platform;
}

export interface IndexedVariant extends NormalizedVariant {
  id: string;          // uuid (MCP/REST id, checkout line_items[].variant_id)
  seq: number;         // numeric id (products.json variants[].id)
  product_id: string;  // uuid
  external_id: string; // always set once stored (db derives a key when the source had none)
  position: number;    // 1-based
}

export interface IndexedProduct extends Omit<NormalizedProduct, "variants" | "raw"> {
  id: string;                        // uuid, used by MCP/REST
  seq: number;                       // numeric id, used by products.json
  store: StoreRef;
  price_range: { min: Money; max: Money };
  available: boolean;                // any variant in_stock or preorder
  variants: IndexedVariant[];        // ordered by position
  checkout_methods: CheckoutConnectorId[]; // e.g. ["woo_store_api", "handoff"] or ["handoff"]
  updated_at: IsoDateTime;
}

/** "IndexedProduct-lite": search results and list views. */
export interface ProductSummary {
  id: string;
  seq: number;
  handle: string;
  title: string;
  brand: string | null;
  product_type: string | null;
  url: string;
  image_url: string | null;          // images[0].url
  price_range: { min: Money; max: Money };
  available: boolean;
  variants_count: number;
  store: StoreRef;
  checkout_methods: CheckoutConnectorId[];
  score?: number;                    // search relevance, present only on search results
}

/** Normalized search parameters (db.searchProducts). Defaults applied by the db helper. */
export interface SearchParams {
  query?: string | null;
  store_id?: string | null;
  min_minor?: number | null;
  max_minor?: number | null;
  available?: boolean | null;        // default true; null = any
  brands?: string[] | null;
  categories?: string[] | null;      // matches category or product_type, case-insensitive
  currency?: string | null;
  limit?: number;                    // default 10, clamped 1..50
  offset?: number;                   // default 0
}

export interface SearchResult {
  products: ProductSummary[];
  total_count: number;
  next_offset: number | null;        // null when no more pages
}
```

### 6.4 `src/contracts/store.ts`
```ts
import type {
  CheckoutConnectorId, ExtractionSource, IsoDateTime, Platform,
} from "./primitives";
import type { AccessMethod, DomRecipe } from "./scan"; // type-only cycle with scan.ts is fine

export const STORE_STATUSES = ["pending", "crawling", "indexed", "failed", "blocked"] as const;
export type StoreStatus = (typeof STORE_STATUSES)[number];

// ---------- readiness (WS2 computes, WS5 renders) ----------
export const READINESS_CHECK_IDS = [
  "products_json", "well_known_ucp", "mcp_endpoint", "llms_txt",
  "jsonld_product_coverage", "sitemap", "robots_allows_agents", "agent_checkout",
] as const;
export type ReadinessCheckId = (typeof READINESS_CHECK_IDS)[number];
/** Default weights; they sum to 100. */
export const READINESS_WEIGHTS: Record<ReadinessCheckId, number> = {
  products_json: 15, well_known_ucp: 15, mcp_endpoint: 15, llms_txt: 10,
  jsonld_product_coverage: 15, sitemap: 10, robots_allows_agents: 10, agent_checkout: 10,
};
export type ReadinessGrade = "A" | "B" | "C" | "D" | "F";
/** score >= 90 A, >= 75 B, >= 60 C, >= 40 D, else F. */
export function gradeFor(score: number): ReadinessGrade {
  return score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
}
export interface ReadinessCheck {
  id: ReadinessCheckId;
  label: string;
  pass: boolean;
  weight: number;
  detail?: string;
}
export interface ReadinessReport {
  score: number;              // 0..100; `before` = the latest ScanReport.score (02 §6.8), `after` = the via-ShoperZero score
  grade: ReadinessGrade;
  checks: ReadinessCheck[];
  computed_at: IsoDateTime;
}

// ---------- store ----------
export interface StoreStrategy {
  tier: ExtractionSource;     // chosen extraction tier
  adapter?: Platform;         // platform adapter used when tier = platform_api
  sampled_at?: IsoDateTime;
}

export interface StoreUrls {
  page: string;               // {APP_URL}/stores/{slug}        (human)
  products_json: string;      // {APP_URL}/s/{slug}/products.json
  llms_txt: string;           // {APP_URL}/s/{slug}/llms.txt
  feed: string;               // {APP_URL}/s/{slug}/feed.acp.jsonl
  ucp: string;                // {APP_URL}/s/{slug}/.well-known/ucp
  mcp: string;                // {APP_URL}/api/mcp
}

export interface Store {
  id: string;
  slug: string;
  domain: string;             // identity key: host without "www." + optional locale path, e.g. "bulk.com/uk"
  base_url: string;           // fetch root: "https://www.bulk.com/uk"
  name: string | null;
  platform: Platform;         // "unknown" until detected
  currency: string | null;
  country: string | null;
  status: StoreStatus;
  product_count: number;
  strategy: StoreStrategy | null;
  checkout_connector: CheckoutConnectorId; // "handoff" unless a real connector works
  readiness: { before?: ReadinessReport; after?: ReadinessReport }; // before: derived from the latest ScanReport (B2)
  claimed: boolean;           // stores.claimed_at is not null
  claimed_at: IsoDateTime | null; // WS5 CCR-8
  opted_out: boolean;
  // ---- scan and score (DECISIONS §A) ----
  best_method: AccessMethod | "none" | null; // null = never scanned; copied from the latest finished ScanReport
  dom_recipe: DomRecipe | null;              // from the dom probe; reused by indexing and WS4's browser connector (stretch)
  latest_scan_id: string | null;             // scans.id of the most recent scan (any status)
  last_crawled_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  urls: StoreUrls;
}

/** Trimmed store for list_stores / GET /api/v1/stores. Keeps best_method (WS3 CR-4). */
export type StoreSummary = Omit<Store, "readiness" | "strategy" | "dom_recipe"> & {
  grade_before: ReadinessGrade | null;
  grade_after: ReadinessGrade | null;
};

// ---------- crawl runs ----------
export const CRAWL_RUN_STATUSES = ["queued", "running", "succeeded", "failed"] as const;
export type CrawlRunStatus = (typeof CRAWL_RUN_STATUSES)[number];
/** WS5 CCR-1 (B14), keyed by `at`. WS2 appends one entry per phase; the log keeps the last 50. */
export const CRAWL_STEPS = ["detect", "robots", "discover", "extract", "publish", "readiness", "done", "error"] as const;
export type CrawlStep = (typeof CRAWL_STEPS)[number];
export interface CrawlLogEntry {
  at: IsoDateTime;
  step?: CrawlStep;           // drives the UI stage rail; entries without it are plain log lines
  level: "info" | "warn" | "error";
  msg: string;                // human readable, shown in the UI
  data?: { total_estimate?: number; platform?: Platform; [key: string]: unknown };
}
export interface CrawlRun {
  id: string;
  store_id: string;
  status: CrawlRunStatus;
  strategy: string | null;    // ExtractionSource or adapter label, free text
  products_found: number;
  pages_fetched: number;
  pages_failed: number;
  log: CrawlLogEntry[];       // capped at the last 50 entries (WS5 CCR-1). WS2's CrawlRunView is a superset of CrawlRun.
  error: string | null;
  started_at: IsoDateTime | null;
  finished_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

// ---------- merchant claim (WS5) ----------
export type ClaimMethod = "dns_txt" | "meta_tag";
export interface StoreClaim {
  store_id: string;
  method: ClaimMethod;
  token: string;              // DNS: TXT record at "_shoperzero.<host>" with value "shoperzero-verify=<token>";
                              // meta: <meta name="shoperzero-verify" content="<token>"> on the homepage
  verified_at: IsoDateTime | null;
  created_at: IsoDateTime;
}

// ---------- metrics (WS5 metrics strip) ----------
export interface PublicMetrics {
  stores_total: number;
  stores_indexed: number;
  products: number;
  variants: number;
  agent_requests: number;
  agent_requests_24h: number;
  checkouts: number;
  orders: number;
  gmv_minor: Record<string, number>; // currency -> minor units
  // round 2, optional (WS5): the UI must tolerate their absence
  stores_by_best_method?: Partial<Record<AccessMethod | "none", number>>; // non-opted-out stores with a best_method
  orders_by_rail?: Partial<Record<"stripe_spt", number>>;        // placed + confirmed orders
  median_seconds_to_agent_ready?: number | null; // median (finished_at - created_at) of succeeded crawl runs
}
```

### 6.5 `src/contracts/crawl.ts`
```ts
import type { NormalizedProduct, Offer } from "./catalog";
import type { CrawlLogEntry } from "./store";
import type { Platform } from "./primitives";

// ---------- crawler plug-in (WS2) ----------
export interface CrawlContext {
  domain: string;             // Store.domain
  baseUrl: string;            // Store.base_url, no trailing slash
  homepageHtml: string;       // GET baseUrl body (may be "" if blocked)
  headers: Headers;           // homepage response headers
  fetch: typeof fetch;        // polite fetch: robots-aware, 1-2 rps/host, CRAWLER_USER_AGENT, timeout
  log: (entry: Omit<CrawlLogEntry, "at">) => void; // appends to crawl_runs.log (buffered)
  signal?: AbortSignal;       // aborted when the time budget (~280 s) runs out
}

export interface PlatformAdapter {
  platform: Platform;
  /** Confidence 0..1 that this adapter can list products for the store. Must not throw. */
  detect(ctx: CrawlContext): Promise<number>;
  /** Yields normalized products, at most opts.max. May throw (the runner falls back to the JSON-LD engine). */
  listProducts(ctx: CrawlContext, opts: { max: number }): AsyncIterable<NormalizedProduct>;
  /** Live re-check of one variant's price/stock (used by verifyOffer). */
  fetchOffer?(
    ctx: CrawlContext,
    product: { url: string; external_id: string | null },
    variantExternalId: string | null,
  ): Promise<Offer>;
}
```

### 6.5a `src/contracts/scan.ts` (round 2, DECISIONS §A)
The type block is DECISIONS §A **verbatim**. Fields may be added later (additively); none may be renamed. Everything below the marked line is an addition. DB CHECK constraints on `scans` and `stores.best_method` mirror the value arrays.
```ts
import { z } from "zod";
import type { Platform } from "./primitives";
import type { ReadinessCheck } from "./store";

// ---------- DECISIONS §A (verbatim) ----------
export type AccessMethod = "api" | "dom" | "computer_use";
export type ProbeStatus = "pending" | "running" | "passed" | "partial" | "failed" | "skipped" | "blocked";
export type Capabilities = {
  catalog: boolean; product_detail: boolean; price_availability: boolean;
  variants: boolean; cart: boolean; checkout_reachable: boolean;
};
export type ProbeSignal = { id: string; label: string; ok: boolean; detail?: string; url?: string };
export type DomRecipe = {
  search_input?: string; product_card?: string; product_link?: string; title?: string; price?: string;
  variant_picker?: string; add_to_cart?: string; cart_link?: string; checkout_link?: string;
  notes?: string; verified_at?: string;
};
export type AccessProbe = {
  method: AccessMethod;
  status: ProbeStatus;
  started_at: string | null; finished_at: string | null; duration_ms: number | null;
  signals: ProbeSignal[];
  capabilities: Capabilities;
  sample_products: number;
  est_seconds_per_task: number | null;
  est_usd_per_task: number | null;
  endpoints?: string[];            // api
  recipe?: DomRecipe;              // dom
  screenshots?: string[];          // computer_use: Supabase Storage public URLs, in order
  steps?: { i: number; action: string; reasoning?: string; screenshot?: string }[];  // computer_use
  error?: { code: string; message: string };
};
export type ScanMode = "cascade" | "full";
export type ScanStatus = "queued" | "running" | "done" | "failed";
export type ScanReport = {
  id: string; store_id: string; url: string; mode: ScanMode; status: ScanStatus;
  platform: Platform;
  best_method: AccessMethod | "none";
  probes: AccessProbe[];            // in cascade order; untried methods are "skipped"
  score: number;                    // 0–100
  grade: "A" | "B" | "C" | "D" | "F";
  checks: ReadinessCheck[];         // existing readiness checks, still shown
  after: { score: number; grade: "A" | "B" | "C" | "D" | "F" } | null;  // projected / actual via ShoperZero
  recommendations: string[];
  created_at: string; updated_at: string;
};

// ---------- additions (WS1) ----------
/** Cascade order. DB: scans.best_method / stores.best_method CHECK = these + "none". */
export const ACCESS_METHODS = ["api", "dom", "computer_use"] as const satisfies readonly AccessMethod[];
export const PROBE_STATUSES = [
  "pending", "running", "passed", "partial", "failed", "skipped", "blocked",
] as const satisfies readonly ProbeStatus[];
export const SCAN_MODES = ["cascade", "full"] as const satisfies readonly ScanMode[];
export const SCAN_STATUSES = ["queued", "running", "done", "failed"] as const satisfies readonly ScanStatus[];
export const SCAN_SCREENSHOT_BUCKET = "scan-screenshots" as const; // public bucket; path "{scan_id}/{step}.png"
export const NO_CAPABILITIES: Capabilities = {
  catalog: false, product_detail: false, price_availability: false,
  variants: false, cart: false, checkout_reachable: false,
};

/** Body of POST /api/v1/scans. The MCP tool scan_store takes the same fields. */
export const CreateScanInputSchema = z.object({
  url: z.string().trim().min(3).max(2048).describe('Store homepage URL or domain, e.g. "https://www.bulk.com/uk" or "bulk.com".'),
  mode: z.enum(["cascade", "full"]).optional().describe('Default "cascade": stop at the first access method that works.'),
});
export type CreateScanInput = z.infer<typeof CreateScanInputSchema>;

/** 202 body of POST /api/v1/scans, and structuredContent of scan_store. */
export interface ScanStartResult {       // WS2 02 §15.1(c)
  scan_id: string;
  store_id: string;
  status_url: string;          // {APP_URL}/api/v1/scans/{scan_id}  (JSON ScanReport)
  report_url: string;          // {APP_URL}/scan/{scan_id}           (human page, WS5)
}
```
Rules (DECISIONS §A, restated for implementers): a probe **passes** when an agent could at least list products with price and availability through it, and is **partial** when only some capabilities work. The score reflects the best method achieved plus its capabilities: `api` gets the highest band, `dom` the middle, `computer_use` the lowest, `none` about 0. WS2 owns the weights (spec 02). `grade` uses `gradeFor(score)` from `store.ts`. The computer-use probe always stops before payment and never types real buyer data. Screenshots and step text are public (bucket and table are public-read).

### 6.6 `src/contracts/checkout.ts`
```ts
import { z } from "zod";
import type { IndexedVariant } from "./catalog";
import {
  PAYMENT_HANDLER_IDS, UCP_VERSION,
  type CheckoutConnectorId, type IsoDateTime, type Money, type PaymentRailId,
} from "./primitives";
import type { Store } from "./store";

// ---------- status / state ----------
/** UCP checkout status: what agents see. */
export const CHECKOUT_STATUSES = [
  "incomplete", "requires_escalation", "ready_for_complete",
  "complete_in_progress", "completed", "canceled",
] as const;
export type CheckoutStatus = (typeof CHECKOUT_STATUSES)[number];

/** Internal state machine (07 §5.4 + "handoff"). Stored in checkouts.state. */
export const CHECKOUT_STATES = [
  "quoting", "awaiting_payment", "requires_action", "payment_authorized", "placing_order",
  "order_placed", "completed", "refunding", "failed", "expired", "canceled", "handoff",
] as const;
export type CheckoutState = (typeof CHECKOUT_STATES)[number];

export const STATE_TO_STATUS: Record<CheckoutState, CheckoutStatus> = {
  quoting: "incomplete",
  awaiting_payment: "ready_for_complete",
  requires_action: "requires_escalation",
  payment_authorized: "complete_in_progress",
  placing_order: "complete_in_progress",
  order_placed: "completed",
  completed: "completed",
  refunding: "complete_in_progress",
  failed: "canceled",
  expired: "canceled",
  canceled: "canceled",
  handoff: "requires_escalation",   // no headless connector: continue_url for a human
};

/** Allowed transitions. WS4's transition() must reject anything else with ApiErrorCode "invalid_state". */
export const ALLOWED_TRANSITIONS: Record<CheckoutState, readonly CheckoutState[]> = {
  quoting: ["awaiting_payment", "handoff", "failed", "canceled"],
  awaiting_payment: ["awaiting_payment", "quoting", "requires_action", "payment_authorized", "expired", "canceled"],
  requires_action: ["awaiting_payment", "failed", "canceled"],
  payment_authorized: ["placing_order", "refunding"],
  placing_order: ["order_placed", "refunding", "requires_action"],
  order_placed: ["completed", "failed"],   // failed: capture failure after placement (CCR-W4-R2-4)
  refunding: ["failed"],
  handoff: ["canceled"],
  completed: [],
  failed: [],
  expired: [],
  canceled: [],
};

// ---------- inputs (zod is the source of truth; validate every agent input) ----------
export const AddressSchema = z.object({
  name: z.string().trim().min(1).max(200),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().max(100).optional(),               // state/province code, e.g. "CA"
  postal_code: z.string().trim().min(1).max(20),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/), // ISO 3166-1 alpha-2
});
export type Address = z.infer<typeof AddressSchema>;

export const BuyerSchema = z.object({
  email: z.email(),
  name: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
});
export type Buyer = z.infer<typeof BuyerSchema>;

export const LineItemInputSchema = z.object({
  variant_id: z.uuid().describe("IndexedVariant.id from search_catalog / get_product"),
  quantity: z.number().int().min(1).max(20),
});
export type LineItemInput = z.infer<typeof LineItemInputSchema>;

export const CreateCheckoutInputSchema = z.object({
  line_items: z.array(LineItemInputSchema).min(1).max(20), // all variants must belong to ONE store
  buyer: BuyerSchema.optional(),
  fulfillment: z.object({ address: AddressSchema }).optional(),
});
export type CreateCheckoutInput = z.infer<typeof CreateCheckoutInputSchema>;

/** Partial update: each field present REPLACES that field; absent fields are kept. */
export const UpdateCheckoutInputSchema = CreateCheckoutInputSchema.partial().extend({
  selected_shipping_option_id: z.string().min(1).optional(),
});
export type UpdateCheckoutInput = z.infer<typeof UpdateCheckoutInputSchema>;

export const PaymentCredentialSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("spt"), token: z.string().min(1).max(255) }),            // "spt_..." (fallback: "pm_card_visa")
]);
export type PaymentCredential = z.infer<typeof PaymentCredentialSchema>;

export const PaymentInstrumentSchema = z.object({
  handler_id: z.literal(PAYMENT_HANDLER_IDS.stripe_spt),
  type: z.literal("card"),
  credential: PaymentCredentialSchema,
});
export type PaymentInstrument = z.infer<typeof PaymentInstrumentSchema>;

export const CompleteCheckoutInputSchema = z.object({
  payment: z.object({ instruments: z.array(PaymentInstrumentSchema).length(1) }),
  idempotency_key: z.string().min(1).max(255).optional(),
});
export type CompleteCheckoutInput = z.infer<typeof CompleteCheckoutInputSchema>;

// ---------- outputs ----------
export interface LineItem {
  id: string;                 // "li_1", "li_2" ... stable within a checkout
  variant_id: string;
  product_id: string;
  title: string;              // product title
  variant_title: string;      // "M" or "Default Title"
  quantity: number;
  unit_price: Money;
  total: Money;               // unit_price * quantity (before shipping/tax)
  image_url: string | null;
  url: string | null;         // merchant PDP
}

export interface ShippingOption {
  id: string;                 // connector-specific, e.g. Woo "0:flat_rate:1"
  title: string;
  amount: Money;
}

export const TOTAL_TYPES = ["subtotal", "shipping", "tax", "discount", "total"] as const;
export type TotalType = (typeof TOTAL_TYPES)[number];
export interface Total { type: TotalType; amount: number; display_text?: string } // minor units in CheckoutSession.currency

export type PaymentHandler = {
  id: typeof PAYMENT_HANDLER_IDS.stripe_spt;
  rail: "stripe_spt";
  config: { accepted: "card"[]; test_mode: boolean; profile?: string };
};

export const MESSAGE_CODES = [
  "out_of_stock", "price_changed", "quote_expired", "missing_buyer", "missing_address",
  "shipping_option_required", "merchant_checkout_required", "payment_declined",
  "payment_requires_action", "order_failed_refunded", "unsupported_currency",
  "timeline_url", // WS5 CCR-6: {type:"info", code:"timeline_url", content:"Watch live: {APP_URL}/checkouts/{id}"} on every session
] as const;
export type MessageCode = (typeof MESSAGE_CODES)[number];
export interface Message {
  type: "error" | "warning" | "info";
  code: MessageCode | (string & {});
  content: string;            // human readable, no PII
  path?: string;              // JSONPath into the checkout, e.g. "$.buyer.email"
  severity?: "recoverable" | "requires_buyer_input" | "requires_buyer_review" | "unrecoverable";
}

export interface CheckoutLink { type: "timeline" | "merchant_product" | "terms_of_service"; url: string }

export interface Order {
  id: string;
  checkout_id: string;
  store_id: string;
  status: "placed" | "confirmed" | "failed" | "refunded";
  merchant_order_id: string | null;
  merchant_order_url: string | null;
  payment: { rail: PaymentRailId; reference: string; amount: Money; payer?: string };
  created_at: IsoDateTime;
}

export interface CheckoutSession {
  id: string;
  ucp_version: typeof UCP_VERSION;
  store: { id: string; slug: string; domain: string; name: string | null };
  connector: CheckoutConnectorId;
  state: CheckoutState;
  status: CheckoutStatus;     // = STATE_TO_STATUS[state]
  line_items: LineItem[];
  buyer?: Buyer;
  fulfillment?: { address?: Address; options: ShippingOption[]; selected_option_id?: string };
  totals: Total[];
  currency: string;
  payment: { handlers: PaymentHandler[] }; // empty when state != awaiting_payment
  continue_url?: string;      // handoff / escalation URL (always set for connector "handoff")
  messages?: Message[];
  links: CheckoutLink[];      // always includes {type:"timeline", url:"{APP_URL}/checkouts/{id}"}
  order?: Order;
  expires_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface CheckoutEvent {
  id: number;
  checkout_id: string;
  from_state: CheckoutState | null;
  to_state: CheckoutState;
  message: string | null;     // human readable, NO PII (public timeline)
  data: CheckoutEventData;    // NO PII
  created_at: IsoDateTime;
}

/** WS5 CCR-5 / WS4 CCR-W4-8: WS4 writes exactly these keys, the timeline renders links from them. */
export type CheckoutEventData = {
  rail?: PaymentRailId;
  payment_intent_id?: string;
  merchant_order_id?: string;
  merchant_order_url?: string;
  continue_url?: string;
  amount?: Money;
  error_code?: string;
  simulated?: boolean;
};

// ---------- persistence (internal; never serialize to agents) ----------
export type CheckoutPaymentStatus =
  | "none" | "authorized" | "captured" | "voided" | "refunded" | "failed";
export interface CheckoutPaymentRecord {   // checkouts.payment jsonb
  rail?: PaymentRailId;
  status?: CheckoutPaymentStatus;
  reference?: string;         // Stripe PaymentIntent id (pi_...)
  amount?: Money;
  payer?: string;
  captured?: boolean;
  // WS4 internal fields in the same jsonb (CCR-W4-R2-3)
  lock?: { rail: PaymentRailId; until: IsoDateTime }; // payment lock; updates are rejected (409) while held
  mode?: "spt" | "fallback";                           // STRIPE_SPT_MODE at payment time
  idempotency_key?: string;
}
export interface CheckoutRecord {          // typed checkouts row (db/checkouts.ts)
  id: string;
  store_id: string;
  connector: CheckoutConnectorId;
  state: CheckoutState;
  line_items: LineItem[];
  buyer: Buyer | null;
  fulfillment: CheckoutSession["fulfillment"] | null;
  totals: Total[];
  currency: string | null;
  total_minor: number | null;              // frozen per quote (CCR-W4-6): update_checkout may re-quote until a payment lock is held; after that, updates get 409
  connector_state: Record<string, unknown>;
  payment: CheckoutPaymentRecord;
  continue_url: string | null;
  idempotency_key: string | null;
  agent_profile: string | null;
  messages: Message[];
  error: { code: string; message: string } | null;
  expires_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

// ---------- checkout plug-ins (WS4) ----------
/** A requested line resolved against the index (db.getVariantsForCheckout). */
export interface ResolvedLine {
  variant: IndexedVariant;
  product: { id: string; title: string; url: string; handle: string; external_id: string | null };
  quantity: number;
}
export interface QuoteInput {
  lines: ResolvedLine[];
  buyer?: Buyer;
  address?: Address;
  selected_shipping_option_id?: string;
}
export interface Quote {
  line_items: LineItem[];
  shipping_options: ShippingOption[];
  selected_shipping_option_id?: string;
  totals: Total[];
  currency: string;
  connector_state: Record<string, unknown>; // persisted to checkouts.connector_state, passed back as `prev`
  messages?: Message[];
}
export interface CheckoutConnector {
  id: CheckoutConnectorId;
  quote(store: Store, input: QuoteInput, prev?: Record<string, unknown>): Promise<Quote>;
  placeOrder(
    checkout: CheckoutSession,
    connectorState: Record<string, unknown>,
    receipt: PaymentReceipt,
  ): Promise<{ merchant_order_id: string; merchant_order_url: string | null }>;
  continueUrl(store: Store, lines: ResolvedLine[]): string; // always available (handoff)
}
// B5: every connector implements quote(store, QuoteInput, prev) and continueUrl(store, ResolvedLine[]) as above.
// A store without a headless connector ends in CheckoutState "handoff" (→ status "requires_escalation").
// Connector choice: resolveCheckoutConnector(store) from @/features/checkout/connectors (WS4, B10).

export interface PaymentReceipt {
  rail: PaymentRailId;
  reference: string;          // Stripe PaymentIntent id (pi_...)
  amount: Money;
  captured: boolean;          // false until capture() succeeds
}
export interface PaymentRail {
  id: PaymentRailId;
  /** Stripe PaymentIntent with capture_method=manual. */
  authorize(checkout: CheckoutSession, instrument: PaymentInstrument): Promise<PaymentReceipt>;
  capture(receipt: PaymentReceipt): Promise<PaymentReceipt>;
  /** Cancel the uncaptured PaymentIntent, or refund a captured payment. */
  voidOrRefund(receipt: PaymentReceipt): Promise<void>;
}
```

### 6.7 `src/contracts/services.ts`
```ts
// Cross-stream function signatures. Implementations MUST be typed with these, e.g.
//   export const verifyOffer: VerifyOfferFn = async (variantId) => { ... };
import type { Offer } from "./catalog";
import type {
  CheckoutEvent, CheckoutSession, CompleteCheckoutInput, CreateCheckoutInput, Order, UpdateCheckoutInput,
} from "./checkout";
import type { AgentSurface } from "./primitives";
import type { ScanMode, ScanReport, ScanStartResult } from "./scan";
import type { CrawlRun, ReadinessReport, Store } from "./store";

export interface RequestContext {
  surface: Extract<AgentSurface, "mcp" | "rest">;
  request_id: string;
  idempotency_key?: string;   // REST Idempotency-Key header or MCP idempotency_key arg
  agent_profile?: string;     // UCP-Agent header profile or meta["ucp-agent"].profile
  user_agent?: string;
}

// ---------- WS2: import from "@/features/crawl" (src/features/crawl/index.ts) ----------
/**
 * Normalize rawUrl (or use opts.storeId for POST /api/v1/stores {store_id}), upsert the stores row, reuse the
 * latest ScanReport to pick the method (api → platform adapter, dom → sitemap + JSON-LD / DOM recipe), insert a
 * queued crawl_run, schedule crawlStore() with after(). Returns immediately.
 * reused = an active run (< 6 min) was returned (even with force); cached = indexed, crawled < 6 h ago and !force.
 */
export type StartStoreCrawlFn = (
  rawUrl: string,
  opts?: { maxProducts?: number; force?: boolean; storeId?: string },
) => Promise<{ store: Store; crawl_run: CrawlRun; reused: boolean; cached: boolean }>;
/** Runs the whole crawl synchronously (called inside after()). Never throws: failures end in status "failed". */
export type CrawlStoreFn = (
  storeId: string,
  crawlRunId: string,
  opts?: { maxProducts?: number },
) => Promise<CrawlRun>;
/** Live re-check of one variant; persists the new offer via db.updateVariantOffer. Timeout 8 s. */
export type VerifyOfferFn = (variantId: string) => Promise<Offer>;
/** "before": derived from the store's latest ScanReport (B2; probes the site only if there is none). "after": score with our hosted surfaces. */
export type ComputeReadinessFn = (store: Store, phase: "before" | "after") => Promise<ReadinessReport>;

// ---------- WS2 scan: import from "@/features/scan" (src/features/scan/index.ts) ----------
/** Normalize URL, upsertStoreForUrl, reuse an active scan (< 6 min) or insert a queued one (db.upsertScan), schedule runScan() with after(). Returns immediately. */
export type StartScanFn = (
  rawUrl: string,
  opts?: { mode?: ScanMode },
) => Promise<ScanStartResult & { reused: boolean }>; // reused = an active scan (< 6 min) was returned
/** Runs the cascade (api → dom → computer_use) inside after(). Persists every probe transition via db.upsertScan (Realtime). Never throws: failures end in status "failed". */
export type RunScanFn = (scanId: string) => Promise<ScanReport>;

// ---------- WS4: import from "@/features/checkout" (src/features/checkout/index.ts) ----------
// All throw AppError (src/shared/errors.ts): not_found, validation_error, invalid_state, gone,
// idempotency_conflict, upstream_error. Business outcomes (out of stock, handoff, declined)
// are NOT thrown: they come back as a CheckoutSession with messages[] (HTTP 200).
export interface CheckoutService {
  createCheckout(input: CreateCheckoutInput, ctx: RequestContext): Promise<CheckoutSession>;
  updateCheckout(id: string, input: UpdateCheckoutInput, ctx: RequestContext): Promise<CheckoutSession>;
  getCheckout(id: string): Promise<CheckoutSession>;
  completeCheckout(id: string, input: CompleteCheckoutInput, ctx: RequestContext): Promise<CheckoutSession>;
  cancelCheckout(id: string, ctx: RequestContext): Promise<CheckoutSession>;
  getOrder(id: string): Promise<Order>;
  listCheckoutEvents(checkoutId: string): Promise<CheckoutEvent[]>;
}
```

### 6.8 `src/contracts/mcp.ts` (MCP tool list)
```ts
import { z } from "zod";
import type { IndexedProduct } from "./catalog";
import {
  CompleteCheckoutInputSchema, CreateCheckoutInputSchema, UpdateCheckoutInputSchema,
  type CheckoutSession,
} from "./checkout";
import { PLATFORMS } from "./primitives";
import type { ScanReport, ScanStartResult } from "./scan";
import type { CrawlRun, CrawlRunStatus, Store, StoreSummary } from "./store";

// Rule: a tool's structuredContent === the JSON body of its REST twin.
// B7: catalog outputs use the UCP product shape. Its exact fields are owned by WS3
// (src/features/catalog/formats/ucp.ts toUcpProduct, spec 03 §6.4); contracts keep it open.
export interface UcpProduct { id: string; title: string; [key: string]: unknown }
// Every tool also returns content: [{ type: "text", text: <1-3 line summary> }].

/** Optional UCP agent metadata. Logged to checkouts.agent_profile / never required. */
export const UcpMetaSchema = z
  .looseObject({
    "ucp-agent": z.looseObject({ profile: z.string().max(2048).optional() }).optional(),
  })
  .optional()
  .describe("Optional UCP agent metadata: { 'ucp-agent': { profile } }");

const Id = z.uuid();

// ---------- catalog (WS3: src/infrastructure/mcp/tools/catalog.ts) ----------
export const ListStoresInputSchema = z.object({
  query: z.string().trim().max(200).optional().describe("Matches store name or domain"),
  platform: z.enum(PLATFORMS).optional(),
  has_checkout: z.boolean().optional().describe("true = only stores with a headless checkout connector"),
  limit: z.number().int().min(1).max(50).optional().describe("Default 20"),
  meta: UcpMetaSchema,
});
export interface ListStoresOutput { stores: StoreSummary[] }

export const SearchCatalogInputSchema = z.object({
  catalog: z.object({
    query: z.string().trim().max(500).optional()
      .describe("Keywords only, e.g. 'hoodie'. Put price limits in filters.price, not in the query."),
    store: z.string().trim().max(255).optional()
      .describe("Store slug, domain or id. Omit to search all stores."),
    filters: z.object({
      price: z.object({
        min: z.number().int().min(0).optional(),
        max: z.number().int().min(0).optional(),
      }).optional().describe("Integer minor units (cents), e.g. $50 = 5000"),
      available: z.boolean().optional().describe("Default true (in stock only)"),
      brands: z.array(z.string().max(100)).max(20).optional(),
      categories: z.array(z.string().max(100)).max(20).optional(),
    }).optional(),
    context: z.object({
      currency: z.string().length(3).toUpperCase().optional(),
      address_country: z.string().length(2).toUpperCase().optional(),
      language: z.string().max(35).optional(),
    }).optional(),
    pagination: z.object({
      cursor: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(50).optional().describe("Default 10"),
    }).optional(),
  }),
  meta: UcpMetaSchema,
});
export interface SearchCatalogOutput {
  products: UcpProduct[];     // "summary" mode (B7); built from ProductSummary ids + hydration, score copied over
  pagination: { cursor: string | null; has_next_page: boolean; total_count: number };
  [key: string]: unknown;     // WS3 extras, e.g. ucp envelope, messages
}

export const LookupCatalogInputSchema = z.object({
  catalog: z.object({
    ids: z.array(z.string().trim().min(1).max(100)).min(1).max(10)
      .describe("Product ids, variant ids, or '{store_slug}:{product_seq}'"),
  }),
  meta: UcpMetaSchema,
});
export interface LookupCatalogOutput { products: UcpProduct[]; not_found: string[]; [key: string]: unknown } // + UCP messages

export const GetProductInputSchema = z.object({
  catalog: z.object({
    id: z.string().trim().min(1).max(100).describe("Product id, variant id, or '{store_slug}:{product_seq}'"),
    verify: z.boolean().optional().describe("true = re-check live price/stock on the merchant site first"),
    selected: z.array(z.object({ name: z.string(), label: z.string() })).max(3).optional()
      .describe("Selected options, e.g. [{name:'Size', label:'M'}]; narrows variants and reports option availability"),
  }),
  meta: UcpMetaSchema,
});
export interface GetProductOutput {
  product: UcpProduct;        // "full" mode (B7)
  verification?: { verified_at: string; ok: boolean; changed_variant_ids: string[]; errors: string[] };
}
/** GET /api/v1/products/{id}?format=indexed (REST only, B7). */
export interface GetProductIndexedOutput {
  product: IndexedProduct;
  verification?: GetProductOutput["verification"];
}

// ---------- indexing (WS2: src/features/crawl/mcp-tools.ts) ----------
export const IndexStoreInputSchema = z.object({
  url: z.string().trim().min(3).max(2048).describe("Store homepage URL or domain, e.g. 'www.bulk.com/uk'"),
  meta: UcpMetaSchema,
});
/** = POST /api/v1/stores body (WS2 02 §15.1(c)). reused = an active run (< 6 min) was returned; cached = no new crawl was needed. */
export interface IndexStoreResult {
  store: Store;
  crawl_run_id: string;
  status: CrawlRunStatus;
  reused: boolean;
  cached: boolean;
}
export type IndexStoreOutput = IndexStoreResult;

export const GetCrawlStatusInputSchema = z.object({ crawl_run_id: Id, meta: UcpMetaSchema });
export type GetCrawlStatusOutput = CrawlRun; // WS2 returns getCrawlRunView(id), a superset of CrawlRun

// ---------- scan (WS2: src/features/crawl/mcp-tools.ts, DECISIONS §A) ----------
export const ScanStoreInputSchema = z.object({
  url: z.string().trim().min(3).max(2048).describe('Store homepage URL or domain, e.g. "https://www.bulk.com/uk" or "bulk.com".'),
  mode: z.enum(["cascade", "full"]).optional().describe('Default "cascade": stop at the first access method that works.'),
  meta: UcpMetaSchema,
});
export type ScanStoreOutput = ScanStartResult; // {scan_id, store_id, status_url, report_url} = POST /api/v1/scans 202 body

export const GetScanInputSchema = z.object({ scan_id: z.uuid().describe("From scan_store."), meta: UcpMetaSchema });
export type GetScanOutput = ScanReport;           // = GET /api/v1/scans/{id}

// ---------- checkout (WS4: src/features/checkout/mcp-tools.ts) ----------
export const CreateCheckoutToolInputSchema = z.object({
  checkout: CreateCheckoutInputSchema,
  idempotency_key: z.string().min(1).max(255).optional(),
  meta: UcpMetaSchema,
});
export const UpdateCheckoutToolInputSchema = z.object({ id: Id, checkout: UpdateCheckoutInputSchema, meta: UcpMetaSchema });
export const GetCheckoutToolInputSchema = z.object({ id: Id, meta: UcpMetaSchema });
export const CompleteCheckoutToolInputSchema = z.object({ id: Id, checkout: CompleteCheckoutInputSchema, meta: UcpMetaSchema });
export const CancelCheckoutToolInputSchema = z.object({ id: Id, meta: UcpMetaSchema });
export const GetOrderToolInputSchema = z.object({ id: Id.describe("Order id (CheckoutSession.order.id)"), meta: UcpMetaSchema });
export type CheckoutToolOutput = CheckoutSession; // create/update/get/complete/cancel_checkout
// get_order output: Order
// CCR-W4-R2-6: WS4's registrar registers create_checkout / update_checkout with its own
// CreateCheckoutMcpInputSchema / UpdateCheckoutMcpInputSchema (spec 04 §12.1), which extend the two
// schemas above to ALSO accept Shopify/UCP line items { item: { id }, quantity } (id may carry a
// "sz:variant:" prefix) and normalize them to { variant_id, quantity } before calling the service.
// The contract schemas stay the REST shape; MCP_TOOL_INPUTS keeps them for docs.

// ---------- demo wallet (WS4: /api/demo-wallet/mcp, test mode only) ----------
export const WalletIssueSptInputSchema = z.object({
  checkout_id: Id,
  amount: z.number().int().min(1).describe("Minor units; must equal the checkout total"),
  currency: z.string().length(3).toUpperCase(),
});
export interface WalletIssueSptOutput { token: string; expires_at: string | null; test_mode: true }

// ---------- registry ----------
export const MCP_TOOL_INPUTS = {
  list_stores: ListStoresInputSchema,
  search_catalog: SearchCatalogInputSchema,
  lookup_catalog: LookupCatalogInputSchema,
  get_product: GetProductInputSchema,
  index_store: IndexStoreInputSchema,
  get_crawl_status: GetCrawlStatusInputSchema,
  scan_store: ScanStoreInputSchema,
  get_scan: GetScanInputSchema,
  create_checkout: CreateCheckoutToolInputSchema,
  update_checkout: UpdateCheckoutToolInputSchema,
  get_checkout: GetCheckoutToolInputSchema,
  complete_checkout: CompleteCheckoutToolInputSchema,
  cancel_checkout: CancelCheckoutToolInputSchema,
  get_order: GetOrderToolInputSchema,
} as const;
export type McpToolName = keyof typeof MCP_TOOL_INPUTS;

export const DEMO_WALLET_TOOL_INPUTS = {
  wallet_issue_spt: WalletIssueSptInputSchema,
} as const;

/** Shape every tool handler returns (assignable to the SDK's CallToolResult). */
export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}
```

MCP tool table (`/api/mcp`, `maxDuration = 300`). The route composes three registrars behind `instrumentServer`: catalog (WS3), crawl (WS2: `registerCrawlTools`) and checkout (WS4: `registerCheckoutTools`). 14 tools:

| Tool | Input schema | Output (`structuredContent` = REST twin body) | Registrar (owner) | REST twin |
|---|---|---|---|---|
| `list_stores` | `ListStoresInputSchema` | `{ stores: StoreSummary[] }` | catalog (WS3) | `GET /api/v1/stores` (WS2 file) |
| `search_catalog` | `SearchCatalogInputSchema` | `{ products: UcpProduct[], pagination }` (B7) | catalog (WS3) | `GET /api/v1/search` |
| `lookup_catalog` | `LookupCatalogInputSchema` | `{ products: UcpProduct[], not_found }` (B7) | catalog (WS3) | none |
| `get_product` | `GetProductInputSchema` (incl. optional `catalog.selected`) | `{ product: UcpProduct, verification? }` (B7) | catalog (WS3, uses WS2 `verifyOffer`) | `GET /api/v1/products/{id}?verify=1` (`?format=indexed` → `IndexedProduct`) |
| `index_store` | `IndexStoreInputSchema` | `IndexStoreResult` `{ store, crawl_run_id, status, reused, cached }` | `registerCrawlTools` (WS2) | `POST /api/v1/stores` (202, or 200 when cached) |
| `get_crawl_status` | `GetCrawlStatusInputSchema` | `CrawlRun` (WS2's `CrawlRunView` superset) | `registerCrawlTools` (WS2) | `GET /api/v1/crawl-runs/{id}` |
| `scan_store` | `ScanStoreInputSchema` (`{url, mode?}`) | `{ scan_id, store_id, status_url, report_url }` | `registerCrawlTools` (WS2) | `POST /api/v1/scans` (202) |
| `get_scan` | `GetScanInputSchema` (`{scan_id}`) | `ScanReport` | `registerCrawlTools` (WS2) | `GET /api/v1/scans/{id}` |
| `create_checkout` | `CreateCheckoutToolInputSchema` (MCP also accepts `{item:{id}, quantity}` lines) | `CheckoutSession` | `registerCheckoutTools` (WS4) | `POST /api/v1/checkouts` (201) |
| `update_checkout` | `UpdateCheckoutToolInputSchema` (same alias) | `CheckoutSession` | `registerCheckoutTools` (WS4) | `PUT /api/v1/checkouts/{id}` |
| `get_checkout` | `GetCheckoutToolInputSchema` | `CheckoutSession` | `registerCheckoutTools` (WS4) | `GET /api/v1/checkouts/{id}` |
| `complete_checkout` | `CompleteCheckoutToolInputSchema` | `CheckoutSession` (`completed` + `order`); `destructiveHint: true` | `registerCheckoutTools` (WS4) | `POST /api/v1/checkouts/{id}/complete` |
| `cancel_checkout` | `CancelCheckoutToolInputSchema` | `CheckoutSession` | `registerCheckoutTools` (WS4) | `POST /api/v1/checkouts/{id}/cancel` |
| `get_order` | `GetOrderToolInputSchema` | `Order` | `registerCheckoutTools` (WS4) | `GET /api/v1/orders/{id}` |
| `wallet_issue_spt` (demo wallet MCP) | `WalletIssueSptInputSchema` | `WalletIssueSptOutput` | demo wallet (WS4) | none |

REST bodies for checkout: the body of `POST /api/v1/checkouts` is `CreateCheckoutInput`, of `PUT` is `UpdateCheckoutInput`, and of `.../complete` is `CompleteCheckoutInput`. The idempotency key comes from the `Idempotency-Key` header. The body of `POST /api/v1/scans` is `CreateScanInput`; the body of `POST /api/v1/stores` is `{ url } | { store_id }` plus `force?`.

`search_catalog` → `SearchParams` mapping (WS3):
- `query` → `query`
- `store` → `resolveStore()` → `store_id` (unknown store → `not_found`)
- `filters.price.min|max` → `min_minor|max_minor`
- `filters.available` → `available` (default true)
- `brands`, `categories` → same names
- `context.currency` → `currency`, only when a price filter is present
- `pagination.limit` → `limit`; decoded `cursor` → `offset`

### 6.9 MCP glue (`src/infrastructure/mcp/types.ts`, `src/infrastructure/mcp/result.ts`)
```ts
// src/infrastructure/mcp/types.ts  (WS1 creates at T+30; WS3 owns)
import type { createMcpHandler } from "mcp-handler";
/** The server object mcp-handler passes to its init callback (has registerTool). */
export type McpServer = Parameters<Parameters<typeof createMcpHandler>[0]>[0];
export type ToolRegistrar = (server: McpServer) => void;
// UNVERIFIED against mcp-handler 2.2.0 typings. Fallback:
//   import type { McpServer } from "@modelcontextprotocol/server";
```
```ts
// src/infrastructure/mcp/result.ts  (WS1 creates at T+30; WS3 owns)
import type { ToolResult } from "@/contracts";
import { toAppError } from "@/shared/errors";
import { log } from "@/shared/log";

/**
 * Success result. The text block carries a one-line summary PLUS the compact JSON, because
 * some MCP clients only show `content` to the model (MCP spec: structured results SHOULD
 * also be serialized in a text block).
 */
export function toolResult(structured: object, summary: string): ToolResult {
  return {
    content: [{ type: "text", text: `${summary}\n${JSON.stringify(structured)}` }],
    structuredContent: structured as Record<string, unknown>,
  };
}

/** Error result (never throw out of a tool handler). Same envelope as REST: { error: {code, message, details?} }. */
export function toolError(err: unknown, tool?: string): ToolResult {
  const e = toAppError(err);
  if (e.code === "internal") log.error("mcp.tool.unhandled", err, { tool });
  const body = { error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) } };
  return { isError: true, content: [{ type: "text", text: `${e.code}: ${e.message}` }], structuredContent: body };
}
```
```ts
// src/app/api/mcp/route.ts  (WS3): the composition rule
import { createMcpHandler } from "mcp-handler";
import { instrumentServer } from "@/infrastructure/mcp/instrument";           // WS3: rate limit + agent_requests for EVERY tool
import { registerCatalogTools } from "@/infrastructure/mcp/tools/catalog";   // WS3
import { registerCrawlTools } from "@/features/crawl/mcp-tools";       // WS2: index_store, get_crawl_status, scan_store, get_scan
import { registerCheckoutTools } from "@/features/checkout/mcp-tools"; // WS4: 5 checkout tools + get_order

export const maxDuration = 300; // B8: index_store and scan_store schedule work with after()

const handler = createMcpHandler(
  (server) => {
    instrumentServer(server);  // MUST run first: wraps every registerTool call below
    registerCatalogTools(server);
    registerCrawlTools(server);
    registerCheckoutTools(server);
  },
  { serverInfo: { name: "shoperzero", version: "0.1.0" } }, // options shape per research 06 §8 (UNVERIFIED)
);
export { handler as GET, handler as POST };
```
Registrar pattern (each stream; no `logAgentRequest` here, `instrumentServer` logs):
```ts
export const registerCheckoutTools: ToolRegistrar = (server) => {
  server.registerTool("create_checkout", {
    title: "Create checkout",
    description: "Start a checkout for variants from ONE store. Prices are integer minor units (cents).",
    inputSchema: CreateCheckoutToolInputSchema,
  }, async (args) => {
    try {
      const session = await createCheckout(args.checkout, { surface: "mcp", request_id: crypto.randomUUID(), idempotency_key: args.idempotency_key, agent_profile: args.meta?.["ucp-agent"]?.profile });
      return toolResult(session, `Checkout ${session.id}: ${session.status}`);
    } catch (err) { return toolError(err, "create_checkout"); }
  });
};
```

### 6.10 db helper signatures (`src/infrastructure/database/**`, WS1; behavior in spec 01 §6)
Import everything from `@/infrastructure/database` (the barrel re-exports every file below). All helpers are server-only. Readers exclude opted-out stores unless noted. This is the complete B12 list; WS3 and WS5 do not write private copies.
```ts
import type {
  AccessMethod, AgentSurface, CheckoutConnectorId, CheckoutEvent, CheckoutRecord, CheckoutState, ClaimMethod,
  CrawlLogEntry, CrawlRun, DomRecipe, IndexedProduct, IndexedVariant, NormalizedProduct, Offer, Order, Platform,
  ProductSummary, PublicMetrics, ReadinessReport, ResolvedLine, ScanReport, ScanStatus, SearchParams, SearchResult,
  Store, StoreClaim,
  StoreStatus, StoreStrategy, StoreSummary,
} from "@/contracts";
import type { StoreRow } from "./mappers";

// ---------------- client.ts ----------------
// export function db(): SupabaseClient<Database>   (memoized service-role client; server-only)

// ---------------- stores.ts ----------------
/** WS2 CCR-2 / WS5 CCR-7: the one row → Store mapper for server code (= toStore(row, appUrl())). */
export declare function rowToStore(row: StoreRow): Store;
export declare function getStoreById(id: string): Promise<Store | null>;
export declare function getStoreBySlug(slug: string): Promise<Store | null>;
export declare function getStoreByDomain(domain: string): Promise<Store | null>;
/** ref = uuid | slug | domain | URL. Opted-out stores are returned (callers decide). */
export declare function resolveStore(ref: string): Promise<Store | null>;
export declare function listStores(opts?: {
  query?: string; platform?: Platform; has_checkout?: boolean; status?: StoreStatus;
  include_opted_out?: boolean; limit?: number; offset?: number;
}): Promise<StoreSummary[]>;
/** Find by normalized domain or insert {status:'pending'}; resolves slug collisions with -2, -3... */
export declare function upsertStoreForUrl(rawUrl: string): Promise<{ store: Store; created: boolean }>;
export interface StorePatch {
  name?: string | null; platform?: Platform; currency?: string | null; country?: string | null;
  status?: StoreStatus; strategy?: StoreStrategy | null; checkout_connector?: CheckoutConnectorId;
  last_crawled_at?: string | null; opted_out?: boolean; metadata?: Record<string, unknown>;
  best_method?: AccessMethod | "none" | null; dom_recipe?: DomRecipe | null; latest_scan_id?: string | null;
  base_url?: string;                // redirect updates (WS2)
  checkout_methods?: string[];      // legacy init.sql column stores.checkout_methods (display only)
}
export declare function updateStore(id: string, patch: StorePatch): Promise<Store>;
/** Merges into stores.readiness[phase] without touching the other phase. */
export declare function setStoreReadiness(id: string, phase: "before" | "after", report: ReadinessReport): Promise<void>;

// ---------------- crawl-runs.ts ----------------
export declare function createCrawlRun(storeId: string): Promise<CrawlRun>;
export declare function getCrawlRun(id: string): Promise<CrawlRun | null>;
export declare function getLatestCrawlRun(storeId: string): Promise<CrawlRun | null>;
export interface CrawlRunPatch {
  status?: CrawlRun["status"]; strategy?: string | null; products_found?: number;
  pages_fetched?: number; pages_failed?: number; error?: string | null;
  started_at?: string | null; finished_at?: string | null;
}
export declare function updateCrawlRun(id: string, patch: CrawlRunPatch): Promise<CrawlRun>;
/** queued → running, conditionally (update ... where status = 'queued'); sets started_at. null = already claimed. */
export declare function claimCrawlRun(id: string): Promise<CrawlRun | null>;
/** Latest queued/running run for the store created less than withinMin minutes ago, else null. */
export declare function getActiveCrawlRun(storeId: string, withinMin: number): Promise<CrawlRun | null>;
/** Number of queued/running runs created less than withinMin minutes ago (all stores). */
export declare function countActiveCrawlRuns(withinMin: number): Promise<number>;
/** Appends entries (at defaults to now), keeps the last 50 (WS5 CCR-1). Single writer per run assumed. */
export declare function appendCrawlLog(
  id: string,
  entries: Array<Omit<CrawlLogEntry, "at"> & { at?: string }>,
): Promise<void>;

// ---------------- products.ts ----------------
/**
 * WS2 CCR-1 semantics (B12). Never throws for a bad product or a failed chunk:
 * - invalid input → skipped[] (zod / mixed currency);
 * - DB failure for a product (e.g. handle collision with a different product, 23505) → failed[]; WS2 retries with a hashed handle;
 * - variants missing from the new payload are NOT deleted: they get available=false, availability='out_of_stock' and sort last;
 * - an unchanged content_hash skips the write but still bumps last_seen_at (= opts.seenAt ?? now()); counted in unchanged.
 * upserted counts written + unchanged products; product_ids lists both.
 */
export declare function upsertStoreProducts(
  storeId: string,
  products: NormalizedProduct[],
  opts?: { seenAt?: string },
): Promise<{
  upserted: number;
  unchanged: number;
  product_ids: string[];
  skipped: { url: string; reason: string }[];
  failed: { url: string; error: string }[];
}>;
/** id = product uuid | variant uuid (returns the parent) | "{store_slug}:{product_seq}". */
export declare function getProduct(id: string): Promise<IndexedProduct | null>;
export declare function getProductByHandle(storeId: string, handle: string): Promise<IndexedProduct | null>;
/** Preserves input order; missing ids are skipped. */
export declare function getProductsByIds(ids: string[]): Promise<IndexedProduct[]>;
/** WS3 CR-1: one hydrator for every lookup. All given keys are ANDed; each array is an IN list. Excludes opted-out stores. */
export declare function findProducts(where: {
  ids?: string[]; variantIds?: string[]; seqs?: number[]; variantSeqs?: number[];
  storeId?: string; handles?: string[]; limit?: number;
}): Promise<IndexedProduct[]>;
export declare function lookupProducts(refs: string[]): Promise<{ products: IndexedProduct[]; not_found: string[] }>;
/**
 * products.json paging (default): ordered by seq asc; page is 1-based; limit 1..250.
 * WS5 CCR-7: offset may replace page, and order "recent" = available desc, updated_at desc (store grid).
 */
export declare function listStoreProducts(
  storeId: string,
  opts: { limit: number; page?: number; offset?: number; order?: "seq" | "recent" },
): Promise<{ products: IndexedProduct[]; total: number }>;
export declare function searchProducts(params: SearchParams): Promise<SearchResult>;
export declare function getProductSummaries(ids: string[]): Promise<ProductSummary[]>;
/** For checkout: resolves variant uuids; throws AppError not_found listing unknown ids. */
export declare function getVariantsForCheckout(
  lines: { variant_id: string; quantity: number }[],
): Promise<{ store_id: string; lines: ResolvedLine[] }[]>;
/** For verifyOffer (WS2): the variant, its product and its store (opted-out stores included), or null. */
export declare function getVariantForVerify(variantId: string): Promise<{
  variant: IndexedVariant;
  product: { id: string; url: string; external_id: string | null; handle: string };
  store: Store;
} | null>;
/** Persists a live re-check (verifyOffer) and recomputes the parent's price range/availability. */
export declare function updateVariantOffer(variantId: string, offer: Offer): Promise<void>;

// ---------------- checkouts.ts (WS4 uses; WS1 implements) ----------------
export type NewCheckout = Omit<CheckoutRecord, "id" | "created_at" | "updated_at">;
export declare function insertCheckout(row: NewCheckout): Promise<CheckoutRecord>;
export declare function getCheckoutRecord(id: string): Promise<CheckoutRecord | null>;
export declare function getCheckoutByIdempotencyKey(key: string): Promise<CheckoutRecord | null>;
/** Optimistic concurrency: when expectState is given, updates only if the row is still in that state; returns null otherwise. */
export declare function updateCheckoutRecord(
  id: string,
  patch: Partial<NewCheckout>,
  opts?: { expectState?: CheckoutState },
): Promise<CheckoutRecord | null>;
export declare function insertCheckoutEvent(ev: Omit<CheckoutEvent, "id" | "created_at">): Promise<CheckoutEvent>;
export declare function listCheckoutEvents(checkoutId: string): Promise<CheckoutEvent[]>;
/** checkout_id of the newest checkout_events row, or null. Service-role; WS5 /checkouts/live follow mode (C9). */
export declare function getLatestCheckoutId(): Promise<string | null>;
export declare function insertOrder(o: Omit<Order, "id" | "created_at">): Promise<Order>;
export declare function getOrder(id: string): Promise<Order | null>;
export declare function getOrderByCheckoutId(checkoutId: string): Promise<Order | null>;
export declare function updateOrderStatus(id: string, status: Order["status"]): Promise<Order>;

// ---------------- scans.ts (WS2 writes, WS3/WS5 read; DECISIONS §A + 02 §15.3) ----------------
/** Exact ScanReport contract (toScanReport). Malformed uuid → null. Includes opted-out stores' scans. */
export declare function getScan(id: string): Promise<ScanReport | null>;
/**
 * With id: shallow-merge update of the given keys (probes / checks / recommendations are replaced whole).
 * With {store_id, url} and no id: insert (defaults: mode "cascade", status "queued", platform "unknown",
 * best_method "none", probes [], score 0, grade "F", checks [], after null, recommendations []).
 * Never touches stores: WS2 sets stores.best_method / dom_recipe / latest_scan_id via updateStore().
 */
export declare function upsertScan(
  patch: Partial<ScanReport> & ({ id: string } | { store_id: string; url: string }),
): Promise<ScanReport>;
/** queued → running, conditionally (update ... where status = 'queued'). null = someone else claimed it. */
export declare function claimScan(id: string): Promise<ScanReport | null>;
/** Most recent scan by created_at, optionally only with the given status. */
export declare function getLatestScanForStore(storeId: string, opts?: { status?: ScanStatus }): Promise<ScanReport | null>;
/** Latest queued/running scan created less than withinMin minutes ago, else null. */
export declare function getActiveScanForStore(storeId: string, withinMin: number): Promise<ScanReport | null>;
/** Number of queued/running scans created less than withinMin minutes ago (all stores). */
export declare function countActiveScans(withinMin: number): Promise<number>;
/** Marks the store's other queued/running scans "failed" (stale; 02 §6 step 9). Returns how many. */
export declare function supersedeScans(storeId: string, exceptId: string): Promise<number>;
/** Uploads to the public bucket "scan-screenshots" at "{scanId}/{name}" (upsert) and returns the public URL. */
export declare function uploadScanScreenshot(
  scanId: string, name: string, bytes: Uint8Array, contentType: string,
): Promise<string>;

// ---------------- claims.ts (WS5 uses) ----------------
/** Creates or rotates the claim token for a store. */
export declare function upsertClaim(storeId: string, method: ClaimMethod): Promise<StoreClaim>;
/** Non-rotating: returns the existing claim (updating only `method` if it differs), else creates one. Use for page loads. */
export declare function getOrCreateClaim(storeId: string, method?: ClaimMethod): Promise<StoreClaim>;
export declare function getClaim(storeId: string): Promise<StoreClaim | null>;
/** Sets store_claims.verified_at and stores.claimed_at = now(). */
/** Pass the checked token: a claim rotated in between is not verified (throws `conflict`). */
export declare function markClaimVerified(storeId: string, token?: string): Promise<void>;
export declare function setStoreOptOut(storeId: string, optedOut: boolean): Promise<void>;

// ---------------- metrics.ts ----------------
/** Fire-and-forget. Never throws, never awaited on the hot path (use after()). */
export declare function logAgentRequest(r: {
  surface: AgentSurface; tool?: string; store_id?: string | null; user_agent?: string | null;
  agent_profile?: string | null; // UCP-Agent profile (WS3); truncated to 2048 chars
}): Promise<void>;
export declare function getPublicMetrics(): Promise<PublicMetrics>;
/** Per-store index quality (WS2 readiness): offers_complete_ratio = products with a live price + availability / products. */
export interface IndexStats { product_count: number; variant_count: number; offers_complete_ratio: number }
/** No argument (WS3 CR-1): indexed, non-opted-out stores and their products (llms.txt, agent card). */
export declare function getIndexStats(): Promise<{ stores: number; products: number }>;
/** With a store id (WS2 02 §15.3): that store's IndexStats. */
export declare function getIndexStats(storeId: string): Promise<IndexStats>;
```

### 6.11 Shared helpers (WS1; full code in spec 01 §10)
```ts
// src/shared/errors.ts   (isomorphic)
export class AppError extends Error { code: ApiErrorCode; details?: unknown; get status(): number }
export function isAppError(e: unknown): e is AppError;
export function toAppError(e: unknown): AppError;           // ZodError→validation_error, 23505→conflict, PGRST116→not_found, 22P02→validation_error
// src/shared/http.ts     (server-only)
export const CORS_HEADERS: Record<string, string>;
export function getRequestId(req: Request): string;
export function json(data: unknown, init?: ResponseInit & { requestId?: string }): Response;
export function text(body: string, contentType?: string, init?: ResponseInit): Response;
export function errorResponse(err: unknown, requestId?: string): Response;
export function preflight(): Response;                      // export const OPTIONS = preflight;
export function parseJsonBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>>;
export function parseSearchParams<S extends z.ZodType>(req: Request, schema: S): z.output<S>;
export function route<Ctx>(name: string, handler: (req: NextRequest, ctx: Ctx, meta: { requestId: string }) => Promise<Response>): (req: NextRequest, ctx: Ctx) => Promise<Response>;
// src/shared/log.ts      (isomorphic)
export const log: { debug; info; warn; error(event: string, err?: unknown, fields?: Record<string, unknown>): void };
// src/shared/env.ts      (server-only)
export function optionalEnv(name: EnvName): string | undefined;
export function requireEnv(name: EnvName): string;          // throws AppError("not_implemented")
export function appUrl(): string;                            // APP_URL > https://$VERCEL_PROJECT_PRODUCTION_URL > http://localhost:3000
export const flags: { demoWalletEnabled(): boolean; allowPrivateStoreHosts(): boolean; crawlMaxProducts(): number; crawlerUserAgent(): string; scanCuEnabled(): boolean; scanCuMaxSteps(): number };
// src/shared/money.ts, src/shared/slug.ts: see spec 01 §7 (full code of everything above: spec 01 §10)
```

---

## 7. Integration milestones and sync points

T = coding start. E = demo time. Each **SYNC** is a 5-minute stand-up: each stream demos its milestone and names any blocking contract change.

| When | Milestone | Owner(s) | Exit check |
|---|---|---|---|
| T+15 | Packages installed and pushed (one commit) | WS1 | `npm ci && npm run build` green on a fresh clone |
| T+15 | Stripe feasibility check: SPT test helper returns a token, or labelled test fallback is selected | WS4 | go / fallback decision recorded in the channel |
| **T+30 SYNC** | **Contracts + stubs + core migration file + seed pushed. CONTRACTS FROZEN.** | WS1 | `npm run build` green; every stream imports `@/contracts` |
| T+45 | Migration applied (local and remote), `types.gen.ts` generated, read helpers (`getProduct`, `searchProducts`, `getStoreBySlug`, `listStores`) implemented against seed | WS1 | `npm run db:smoke` passes (spec 01 §11) |
| T+60 | MCP route alive: `tools/list` shows the catalog tools; `search_catalog("hoodie")` returns the seed hoodie in Claude / MCP Inspector | WS3 | screenshot in the channel |
| T+60 | Woo demo store up behind a tunnel with sample products, `bacs` and flat-rate shipping; `WOO_DEMO_URL` shared | WS4 | `GET $WOO_DEMO_URL/wp-json/wc/store/v1/products` returns 200 |
| T+60 | Landing + scan page render against seed data | WS5 | |
| T+90 | `POST /api/v1/stores {url: WOO_DEMO_URL}` crawls the Woo demo store into the DB with live progress | WS2 (+WS5 UI) | products visible in `/s/{slug}/products.json` |
| T+90 | `POST /api/v1/scans` runs the `api` probe on the Woo demo store and the `dom` probe on a JSON-LD store; `/scan/{id}` renders the cards live from Realtime on `scans` | WS2 (+WS5 UI) | `GET /api/v1/scans/{id}` → `status: "done"`, `best_method` set |
| **T+2h SYNC** | **End to end: Claude → `search_catalog` → `get_product` → `create_checkout` (live Woo quote) → `complete_checkout` (SPT) → Woo order placed; timeline streams** | all | order id visible in Woo admin + `/checkouts/{id}` |
| T+3h | JSON-LD engine on 2 external demo stores; Stripe checkout; discovery files (`llms.txt`, `.well-known/ucp`); scan score → "Make it agent-ready" → A | WS2, WS4, WS3, WS5 | |
| T+3h | `computer_use` probe streams screenshots to `scan-screenshots` and stops before payment (can be owned by a third person) | WS2 | screenshots render on `/scan/{id}` |
| T+4h SYNC | Feature-complete for the demo script; everything after this is polish or cut-list items | all | run the demo script once end to end |
| E−60 | **Code freeze.** Deploy prod to Vercel with all env vars. Delete seed data from the remote DB (`delete from public.stores where metadata->>'seed' = 'true';`; scans cascade). Pre-scan and pre-crawl the demo stores. | WS1 + WS5 | prod smoke passes |
| E−45 | Rehearse the demo twice on prod; record the backup video | WS5 (+all) | video file saved in `docs/demo/` |
| E−15 | Hands off. Only env or data fixes. | all | |

## 8. Deviations from synthesis §6 (and §4), in one place

1. **Layout.** Contracts are split into 8 files plus a barrel (§5). Input types are inferred from zod schemas. `NormalizedProduct` / `NormalizedVariant` / `Offer` have zod schemas used at the DB boundary.
2. **Store.** Adds `base_url`, `opted_out`, `created_at`, `updated_at`, `urls.page`, plus a new `StoreSummary`. Claim tokens moved from a `stores.claim_token` column to a service-role-only `store_claims` table, because `stores` is public and on Realtime.
3. **Catalog.**
   - `IndexedVariant` adds `position` and a non-null `external_id`.
   - Variants store `availability` (lossless `Offer` round-trip).
   - `NormalizedProduct.options` allows up to 10 (the Shopify emitter takes the first 3).
   - New `ProductSummary`, `SearchParams`, `SearchResult`.
4. **CrawlRun** adds `log`, `created_at` and `updated_at`. `ReadinessCheck.id` is a typed union with default `READINESS_WEIGHTS` and `gradeFor()`.
5. **Checkout state.** `CheckoutState` adds **`handoff`** (→ `requires_escalation`). `ALLOWED_TRANSITIONS` is now part of the contract (includes `awaiting_payment → quoting` for line-item edits).
6. **Checkout shapes.**
   - `LineItem` adds `variant_title` and `url`.
   - `Total` is a named type.
   - `PaymentHandler` is a discriminated union per rail; the Stripe config is `{ accepted: ["card"], test_mode }`.
   - `Message` adds `path` and `severity`.
   - `CheckoutSession.store` adds `name`, and `CheckoutSession.links[]` always includes the timeline URL.
   - `CompleteCheckoutInput.payment.instruments` is an array of length 1, not a TS tuple.
7. **Connectors.** `CheckoutConnector.quote()` takes `QuoteInput` (db-resolved `ResolvedLine[]` + buyer / address / shipping choice) instead of the raw `CreateCheckoutInput`. `continueUrl(store, lines)` likewise.
8. **Services.**
   - `computeReadiness(store, phase)` replaces `computeReadiness(domain)`.
   - New `startStoreCrawl(rawUrl)` (used by both `POST /api/v1/stores` and `index_store`).
   - `RequestContext` and the `CheckoutService` interface are formalized.
9. **MCP.**
   - `list_stores` returns `{ stores }` (structuredContent must be an object); `get_product` returns `{ product, verification? }`.
   - The rule "structuredContent == REST body" is added.
   - The text content carries the JSON.
   - Registrars are owned per stream (3.3.2).
   - `search_catalog` gains `filters.categories` and `context`.
10. **SQL.**
    - `search_products` adds `p_categories`, `p_currency` and `query_embedding text` (reserved), returns `total_count`, and uses any-term + all-terms-bonus ranking.
    - New RPCs: `upsert_product_batch` (atomic product + variant sync) and `get_public_metrics`.
    - The legacy `products (store_id, url)` unique is dropped; identity is `(store_id, handle)`.
    - Enumerations are enforced with named CHECK constraints, not Postgres enums.
    - Adds `checkouts.messages`, `orders.updated_at`, `crawl_runs.updated_at` and explicit grants.
11. **Round 2 (DECISIONS.md).** Scan and score is new (not in the synthesis): `scan.ts`, `scans`, the `stores` scan columns, the `scan-screenshots` bucket, `/api/v1/scans`, `scan_store` / `get_scan`. Catalog outputs switch to the UCP product shape (B7). `CrawlLogEntry` gains `step?` and is capped at 50. `CheckoutEventData` is typed. `ALLOWED_TRANSITIONS` adds `order_placed → failed`. `upsert_product_batch` no longer deletes variants. `agent_requests.agent_profile` is added. See "Round-2 changes" at the top.

## 9. Definition of done (demo)

The demo is done when all of these pass **on the production Vercel URL** with the production Supabase project:

- [ ] `curl -i https://<app>/s/<woo-slug>/products.json` → 200, Shopify shape (`products[].id` numeric, `variants[].price` decimal string), CORS header present.
- [ ] `curl https://<app>/.well-known/ucp` → 200 with `ucp.version = "2026-08-25"` and an MCP service endpoint `https://<app>/api/mcp`. `curl https://<app>/s/<slug>/llms.txt` → 200 markdown.
- [ ] Pasting a demo URL on `/` opens `/scan/{id}`, which shows the access cascade live (one card per method, screenshots for `computer_use`), then the score report with seconds and USD per agent task. A blocked store shows `blocked`, never a crash.
- [ ] "Make it agent-ready" on that report starts indexing: detected platform, a live product counter (Realtime, no refresh), and the grade reaches A within 60 s, ending on the store page.
- [ ] Claude (Desktop or Code), with only `https://<app>/api/mcp` (+ the demo wallet MCP) configured, completes "find me a hoodie under $50 across these stores and buy it" with no human edits. It ends at `status: "completed"` with `order.merchant_order_id`.
- [ ] That order exists in WooCommerce admin with the payment reference (Stripe PaymentIntent id) in its order note. The Stripe test dashboard shows the captured PaymentIntent.
- [ ] `/checkouts/{id}` shows every transition (`quoting → awaiting_payment → payment_authorized → placing_order → order_placed → completed`) as it happens.
- [ ] `create_checkout` on the Magento store returns `status: "requires_escalation"` with a working `continue_url`.
- [ ] Claim flow (or its slide) works for one store. The metrics strip shows non-zero `agent_requests`.
- [ ] A backup video of the full run is recorded and saved in `docs/demo/`. Seed data is removed from prod.
