# 01 — WS1 Foundation: packages, schema, contracts, db helpers, glue

Owner: WS1. It's a short stream: when the checklist in §12 is green, the owner joins WS3 or WS5.
Canonical types and conventions: `docs/specs/00-overview-and-contracts.md` (called "spec 00" below). Read `AGENTS.md`.

What was verified while writing this spec:
- **npm:** every package version below was checked with `npm view` on 2026-09-26.
- **SQL:** the migration and seed were applied, on top of `20260926000000_init.sql`, to a Postgres 17.9 instance with a Supabase-like role shim. The search RPC, upsert RPC (variant pruning, `product_count`), grants and RLS were exercised there.
- **TypeScript:** the contracts, `money.ts`, `slug.ts`, `errors.ts`, `http.ts`, `log.ts`, `env.ts`, `mappers.ts` and `upsert-row.ts` compile under `strict` against the project's TypeScript, zod 4.6.5 and Next 16.3.6 types, and the tests in §7 / §6.4 pass.
- **Not verified:** anything that needs the Supabase CLI + Docker (`db reset`, `gen types`), the hosted project, or the not-yet-installed packages. Those points are marked **UNVERIFIED** with a fallback.

**Round 2 (`DECISIONS.md` is binding and overrides this file where they disagree):**
- Core migration adds the `scans` table, the `stores` columns `best_method`, `dom_recipe`, `latest_scan_id`, the public `scan-screenshots` storage bucket, and `agent_requests.agent_profile` (§4).
- `upsert_product_batch` follows WS2 CCR-1: variants are never deleted, per-product failures are reported, unchanged products are skipped (§4, §6.3).
- New db helpers `getScan`, `upsertScan`, `getLatestScanForStore`, `rowToStore`, `findProducts`, `getIndexStats`, `getOrCreateClaim` (§6).
- `@anthropic-ai/sdk` is core; `playwright-core` and `@browserbasehq/stagehand` are installed for WS2's `dom` and `computer_use` probes (§2). New env vars (§9, §10).
- The round-2 SQL (migration + seed) was re-applied on 2026-09-26 to a throwaway Postgres 17 (Homebrew `postgresql@17`) with a Supabase role + `storage` schema shim; details in §4. The TypeScript in §6.2 was re-checked with `tsc --strict` against zod 4.6.5.

---

## 0. Order of work

| By | Step | Section |
|---|---|---|
| T+15 | Install packages, add npm scripts, push | §2 |
| T+30 | Contracts + shared helpers + stubs + migration file + seed + proxy matcher + `.env.example` + placeholder `types.gen.ts` + db helper **stubs**. Push. **Contracts frozen.** | §3, §4, §5, §8, §9, §10 |
| T+45 | Migration applied locally and remotely, types generated, read helpers implemented, `db:smoke` read part passes | §5.1, §6 |
| T+60 | All db helpers implemented (writes, checkouts, claims, metrics), `db:smoke` fully green | §6, §11 |
| then | Join WS3 / WS5. Stretch: pgvector hybrid search | §13 |

Prerequisites:
- Node 22 (`nvm use`; `.nvmrc` says 22. The machine default is 20.18, which also works).
- Supabase CLI ≥ 2.109 (installed: 2.109.0; latest 2.118.0).
- **Docker Desktop running**, for `supabase start` / `db reset`. It was not running when this spec was written.

---

## 1. Files WS1 creates or changes

```
package.json, package-lock.json            (install + scripts)
.env.example                               (§9)
src/proxy.ts                               (matcher only, §8)
src/infrastructure/supabase/admin.ts, client.ts, server.ts   (add <Database> generic, §6.1)
src/contracts/{primitives,api,catalog,store,crawl,scan,checkout,mcp,services,index}.ts   (spec 00 §5–§6, verbatim)
src/shared/{errors,http,log,env}.ts           (§10)
src/shared/money.ts, src/shared/slug.ts, tests/unit/foundation.test.ts   (§7)
src/infrastructure/database/{index,client,selects,mappers,upsert-row,stores,crawl-runs,products,scans,checkouts,claims,metrics}.ts, types.gen.ts, upsert-row.test.ts   (§6)
supabase/migrations/20260926010000_core.sql      (§4)
supabase/seed.sql                          (§5)
scripts/db/smoke.ts                        (§11)
.gitignore                                 (add `infra/woo/.env.woo`, CCR-W4-R2-2)
T+30 stubs handed to other streams: src/features/crawl/{index,mcp-tools}.ts, src/features/scan/index.ts, src/features/checkout/{index,mcp-tools}.ts, src/infrastructure/mcp/{result,types}.ts   (§3)
```

---

## 2. Package install (T+0 → T+15, one commit)

Versions checked with `npm view <pkg> version` on 2026-09-26:

| Package | Version | Used by | Notes |
|---|---|---|---|
| `zod` | 4.6.5 | all | `@modelcontextprotocol/server@2.1.0` needs `zod ^4.2` |
| `cheerio` | 1.2.0 | WS2 | |
| `fast-xml-parser` | 5.11.1 | WS2 | sitemaps |
| `robots-parser` | 3.0.1 | WS2 | |
| `p-queue` | 9.3.3 | WS2 | ESM-only, node ≥ 20 |
| `mcp-handler` | 2.2.0 | WS3, WS4 | peers: `next >=13`, `@modelcontextprotocol/server ^2.0.0` |
| `@modelcontextprotocol/server` | 2.1.0 | WS3, WS4 | fallback: `mcp-handler@1` + `@modelcontextprotocol/sdk@1.30.1` |
| `stripe` | 22.6.2 | WS4 | preview endpoints via `fetch` + `Stripe-Version` |
| `tsx` (dev) | 4.23.15 | WS1 tests, WS2/WS4 scripts | runs `.ts` scripts and `tsx --test` |
| `@anthropic-ai/sdk` | 0.128.0 | WS2 scan (DOM recipe agent, computer-use probe) | **core since round 2** (was stretch). Peer `zod ^3.25 \|\| ^4` ✓ |
| `playwright-core` | 1.63.0 | WS2 scan (`dom`, `computer_use`: drive a local browser or `connectOverCDP` to Browserbase) | **core**. No bundled browsers; node ≥ 20 |
| `@browserbasehq/sdk` | 2.21.0 | WS2 scan (create Browserbase sessions, then CDP) | **core**. Only used when `BROWSERBASE_API_KEY` is set |
| `playwright` (dev) | 1.63.0 | WS2 local probes + fixtures | dev only: `npx playwright install chromium` gives local runs a browser. Never imported by app code (use `playwright-core`) |
| `@browserbasehq/stagehand` | 4.1.0 | stretch only: WS2 `observe`/`extract`, WS4 browser connector (CCR-W4-R2-8) | **needs Node ≥ 22.18** (`engines`); pulls a nested `zod@4.4.3` (harmless). Install only when a stretch item starts |

Checked on 2026-09-26 with `npm view <pkg> version`: `@anthropic-ai/sdk` 0.128.0, `playwright-core` 1.63.0, `playwright` 1.63.0, `@browserbasehq/sdk` 2.21.0, `@browserbasehq/stagehand` 4.1.0.

Exact command (pin exact versions so the lockfile can't drift mid-hackathon):
```bash
npm i --save-exact zod@4.6.5 cheerio@1.2.0 fast-xml-parser@5.11.1 robots-parser@3.0.1 p-queue@9.3.3 \
  mcp-handler@2.2.0 @modelcontextprotocol/server@2.1.0 stripe@22.6.2 \
  @anthropic-ai/sdk@0.128.0 playwright-core@1.63.0 @browserbasehq/sdk@2.21.0
npm i -D --save-exact tsx@4.23.15 playwright@1.63.0
# stretch, install only when asked: @mendable/firecrawl-js@4.41.0 @browserbasehq/stagehand@4.1.0 (Node >= 22.18)
```
**Node version.** The core set runs on the machine default Node 20.18.3 and on Vercel's Node 22. Stagehand (stretch) declares `node >=22.18.0`: run `nvm use 22` before installing it. Without Stagehand, WS2's DOM probe uses cheerio + Claude on fetched HTML (verified in a browser via `playwright-core`), and the computer-use probe uses `playwright-core` + `@anthropic-ai/sdk` directly (DECISIONS §A allows both). Model: `SCAN_MODEL`, default `claude-opus-5-5` (cheaper overrides `claude-sonnet-5`, `claude-haiku-4-5`).

**Serverless note (UNVERIFIED on Vercel).** A local Chrome is not available in a Vercel function. In production the `dom` / `computer_use` probes need `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` (connect over CDP). Without them, WS2 marks those probes `skipped` in production and runs them only locally.
(The synthesis wrote `firecrawl`. Both `firecrawl` and `@mendable/firecrawl-js` are at 4.41.0; `@mendable/firecrawl-js` is the SDK's canonical name. UNVERIFIED which one WS2 prefers, so ask them.)

Replace the `scripts` block in `package.json` with:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "typecheck": "next typegen && tsc --noEmit",
  "test": "tsx --test tests/unit/foundation.test.ts tests/unit/database/upsert-row.test.ts",
  "test:unit": "tsx --test 'src/lib/**/__tests__/*.test.ts'",
  "crawl:smoke": "node --env-file=.env.local --conditions=react-server --import tsx scripts/crawl-smoke.ts",
  "db:start": "supabase start",
  "db:reset": "supabase db reset",
  "db:push": "supabase db push",
  "db:types": "supabase gen types typescript --local > src/infrastructure/database/types.gen.ts",
  "db:types:remote": "supabase gen types typescript --linked > src/infrastructure/database/types.gen.ts",
  "db:smoke": "node --env-file=.env.local --conditions=react-server --import tsx scripts/db/smoke.ts"
}
```
`test:unit` and `crawl:smoke` are WS2's (02 §13; WS2 owns `scripts/crawl-*.ts` and `scripts/scan-*.ts`). The quoted glob in `test:unit` is expanded by Node's test runner, which needs Node ≥ 21 (fine on the pinned 22). Other streams append their test files to `test` by asking WS1. `--conditions=react-server` lets scripts import modules that start with `import "server-only"`; the plain `server-only` package throws otherwise.

Exit check: `rm -rf node_modules && npm ci && npm run build` is green. Push `package.json` + `package-lock.json` in one commit.

---

## 3. T+30 contracts commit

1. Create `src/contracts/*.ts` **verbatim** from spec 00 §6.1–§6.8 (9 files including `scan.ts` from §6.5a), plus `index.ts` from spec 00 §5.
2. Create `src/shared/{errors,http,log,env}.ts` from §10, and `money.ts` / `slug.ts` (+ tests) from §7.
3. Create `src/infrastructure/database/types.gen.ts` as a placeholder until §5.1 regenerates it:
   ```ts
   // PLACEHOLDER. Overwritten by `npm run db:types` (T+45). Never hand-edit the generated file.
   // eslint-disable-next-line @typescript-eslint/no-explicit-any
   export type Database = any;
   ```
4. Create every `src/infrastructure/database/*.ts` file from §6 with the **exact exported signatures** of spec 00 §6.10. Bodies may be `throw new AppError("not_implemented", "<fn>")` for now (read helpers first at T+45).
5. Create these stubs. Ownership transfers on push.
   ```ts
   // src/infrastructure/mcp/types.ts  → WS3
   import type { createMcpHandler } from "mcp-handler";
   export type McpServer = Parameters<Parameters<typeof createMcpHandler>[0]>[0];
   export type ToolRegistrar = (server: McpServer) => void;
   ```
   `src/infrastructure/mcp/result.ts` → WS3: verbatim from spec 00 §6.9.
   ```ts
   // src/features/crawl/index.ts  → WS2 (replace bodies, keep names + types)
   // STUB created by WS1 at T+30. Owned by WS2 from then on: replace bodies, keep signatures.
   import type { ComputeReadinessFn, CrawlStoreFn, StartStoreCrawlFn, VerifyOfferFn } from "@/lib/contracts";
   import { AppError } from "@/lib/errors";

   const notYet = (what: string) => new AppError("not_implemented", `${what} is not implemented yet`);

   export const startStoreCrawl: StartStoreCrawlFn = async () => { throw notYet("startStoreCrawl"); };
   export const crawlStore: CrawlStoreFn = async () => { throw notYet("crawlStore"); };
   export const verifyOffer: VerifyOfferFn = async () => { throw notYet("verifyOffer"); };
   export const computeReadiness: ComputeReadinessFn = async () => { throw notYet("computeReadiness"); };
   ```
   ```ts
   // src/features/crawl/mcp-tools.ts  → WS2 (register index_store, get_crawl_status, scan_store, get_scan here)
   import type { ToolRegistrar } from "@/lib/mcp/types";
   export const registerCrawlTools: ToolRegistrar = () => {};
   ```
   ```ts
   // src/features/scan/index.ts  → WS2 (replace bodies, keep names + types)
   // STUB created by WS1 at T+30. Owned by WS2 from then on: replace bodies, keep signatures.
   import type { RunScanFn, StartScanFn } from "@/lib/contracts";
   import { AppError } from "@/lib/errors";

   const notYet = (what: string) => new AppError("not_implemented", `${what} is not implemented yet`);

   export const startScan: StartScanFn = async () => { throw notYet("startScan"); };
   export const runScan: RunScanFn = async () => { throw notYet("runScan"); };
   ```
   ```ts
   // src/features/checkout/index.ts  → WS4 (replace bodies, keep names + types)
   // STUB created by WS1 at T+30. Owned by WS4 from then on: replace bodies, keep signatures.
   import type { CheckoutService } from "@/lib/contracts";
   import { AppError } from "@/lib/errors";

   const notYet = (what: string) => new AppError("not_implemented", `${what} is not implemented yet`);

   export const createCheckout: CheckoutService["createCheckout"] = async () => { throw notYet("createCheckout"); };
   export const updateCheckout: CheckoutService["updateCheckout"] = async () => { throw notYet("updateCheckout"); };
   export const getCheckout: CheckoutService["getCheckout"] = async () => { throw notYet("getCheckout"); };
   export const completeCheckout: CheckoutService["completeCheckout"] = async () => { throw notYet("completeCheckout"); };
   export const cancelCheckout: CheckoutService["cancelCheckout"] = async () => { throw notYet("cancelCheckout"); };
   export const getOrder: CheckoutService["getOrder"] = async () => { throw notYet("getOrder"); };
   export const listCheckoutEvents: CheckoutService["listCheckoutEvents"] = async () => { throw notYet("listCheckoutEvents"); };
   ```
   ```ts
   // src/features/checkout/mcp-tools.ts  → WS4 (register the 6 checkout tools here)
   import type { ToolRegistrar } from "@/lib/mcp/types";
   export const registerCheckoutTools: ToolRegistrar = () => {};
   ```
6. Add `supabase/migrations/20260926010000_core.sql` (§4) and `supabase/seed.sql` (§5). Change `src/proxy.ts` (§8) and `.env.example` (§9).
7. `npm run build` → green. Push. Announce: **"contracts frozen; import from `@/lib/contracts`"**.

If `mcp-handler`'s types do not expose the callback parameter this way (UNVERIFIED), use `import type { McpServer } from "@modelcontextprotocol/server"` in `types.ts`. Nothing else changes.

---

## 4. Migration: `supabase/migrations/20260926010000_core.sql`

Complete and runnable. It was applied on top of `init.sql` without errors, and it extends `init.sql` rather than replacing it. On a plain Postgres the only warning is `wal_level is insufficient to publish logical changes`, which Supabase does not emit.

**Round-2 verification (2026-09-26).** This version (with `scans`, the `stores` scan columns, the storage bucket and the new `upsert_product_batch`) plus §5's seed was applied to a throwaway Postgres 17 cluster. The cluster had a shim for the Supabase roles (`anon`, `authenticated`, `service_role bypassrls`), the `extensions` schema and a minimal `storage.buckets` / `storage.objects`. Checked there:
- the publication lists `checkout_events, crawl_runs, scans, stores`;
- the bucket row is `public = t`;
- `anon` can `select` from `scans` but gets `permission denied` on insert, while `service_role` inserts with the defaults;
- the `scans_updated_at` trigger fires;
- the RPC returns `upserted` / `unchanged` / `failed: handle_collision` / `failed: no_variants` / `failed: 23502 …` in one batch without aborting, and marks a dropped variant `out_of_stock` at position 1001 while keeping the other variant's uuid;
- `get_public_metrics()` returns the new keys;
- run as a non-owner role, the storage-policy block only raises its NOTICE.

**UNVERIFIED:** the real Supabase `storage` schema (column set of `storage.buckets` on the hosted project) and whether the hosted migration role may create policies on `storage.objects`. The fallback is built in (a guarded block; the bucket works without the policies).

Design notes (the "why" behind the SQL):
- **Enumerated values** use named CHECK constraints that mirror the TS unions in `src/contracts`. They are not Postgres enum types: the init tables already use `text`, and changing a CHECK in a later add-only migration is a two-line drop/add.
- **Product identity is `(store_id, handle)`.** The legacy unique `(store_id, url)` is dropped, so a URL change on re-crawl can't fail a whole batch; it is replaced by a non-unique index.
- **`fts` generated column.** It needs immutable expressions, and `array_to_string` is only STABLE (checked: `provolatile = 's'`). A tiny `public.immutable_array_to_string` wrapper solves this.
- **`upsert_product_batch(p_store_id, p_products jsonb, p_seen_at timestamptz)`** (WS2 CCR-1 semantics, B12):
  - it upserts each product and its variants inside its own sub-block, so one bad product never fails the batch. It returns one row per product with `status` = `upserted` | `unchanged` | `failed` and an `error` text;
  - an unchanged `content_hash` skips the write and only bumps `last_seen_at`;
  - variants that disappeared are **not deleted**: they get `available = false`, `availability = 'out_of_stock'` and `position + 1000`, so they sort last and old checkouts keep resolving;
  - a handle collision with a *different* product (same handle, different URL and a different non-null `external_id`) is reported as `failed` / `handle_collision`. WS2 retries with a hashed handle;
  - it keeps variant **uuids stable** across re-crawls (checkouts reference them);
  - it recomputes `stores.product_count`, which also fires Realtime on `stores`.
- **Scan and score (DECISIONS §A).** `scans` holds one `ScanReport` per row (jsonb for `probes`, `checks`, `after`, `recommendations`). It is public-read and on Realtime, so `/scan/{id}` follows it live. `stores.latest_scan_id` references `scans` and is added **after** the table exists (the two tables reference each other). Screenshots go to the public `scan-screenshots` bucket.
- **`search_products`**:
  - matching: a product matches if **any** query term matches (so "hoodie under 50" still finds hoodies), plus trigram `<%` for typos;
  - ranking: `ts_rank_cd` + a +1 bonus when **all** terms match + `word_similarity`;
  - it returns `total_count` on every row for pagination;
  - `query_embedding text` is reserved for the stretch hybrid version.
- **Claim tokens** live in `store_claims` (service-role only), because `stores` is public and on Realtime.
- **Explicit GRANTs.** `supabase/config.toml` warns that newer projects/CLIs don't auto-expose new tables to the API roles. So we grant `select` on the public tables to `anon, authenticated` and everything to `service_role`, and we revoke `execute` on the writer RPC from `anon`/`authenticated`.
- **Every later migration** that creates a table must repeat: `enable row level security`, `grant all on <t> to service_role`, and (only if public) `grant select on <t> to anon, authenticated` + a select policy.

```sql
-- 20260926010000_core.sql
-- ShoperZero core schema. Extends 20260926000000_init.sql (does not replace it).
-- ADD-ONLY RULE: once pushed, never edit this file. Later changes go in
-- 2026092602xxxx_<stream>_<what>.sql files.
--
-- Enumerated values are enforced with NAMED CHECK constraints (not Postgres enum
-- types). The TypeScript unions in src/contracts are the source of truth; to
-- add a value later: alter table ... drop constraint <name>, add constraint <name> check (...).

-- =====================================================================
-- 0. Extensions
-- =====================================================================
create extension if not exists pg_trgm with schema extensions;
-- stretch (embeddings): create extension if not exists vector with schema extensions;

-- =====================================================================
-- 1. STORES
-- =====================================================================
alter table public.stores
  add column slug text,                                   -- /s/{slug}; from slug.ts storeSlugFromDomain()
  add column seq bigint generated always as identity,     -- numeric id (not exposed yet)
  add column base_url text,                               -- "https://www.bulk.com/uk" (scheme + host + path prefix, no trailing slash)
  add column country text,                                -- ISO 3166-1 alpha-2, nullable
  add column product_count integer not null default 0,    -- maintained by upsert_product_batch()
  add column strategy jsonb,                              -- {tier, adapter?, sampled_at?}; null until sampled
  add column readiness jsonb not null default '{}'::jsonb,-- {before?: ReadinessReport, after?: ReadinessReport}
  add column checkout_connector text not null default 'handoff',
  add column claimed_at timestamptz,                      -- set when a store_claims row is verified
  add column opted_out boolean not null default false,    -- merchant opt-out: hidden from search + outputs
  add column best_method text,                            -- AccessMethod | 'none'; null = never scanned (DECISIONS §A)
  add column dom_recipe jsonb;                            -- DomRecipe from the dom probe; null until found
  -- latest_scan_id is added in section 4b, after public.scans exists.

-- Backfill legacy rows (fresh DBs have none) so NOT NULL can be applied.
update public.stores
   set slug = trim(both '-' from regexp_replace(lower(regexp_replace(domain, '^www\.', '')), '[^a-z0-9]+', '-', 'g'))
 where slug is null;
update public.stores set base_url = 'https://' || domain where base_url is null;

alter table public.stores
  alter column slug set not null,
  alter column base_url set not null;

alter table public.stores
  add constraint stores_slug_key unique (slug),
  add constraint stores_seq_key unique (seq),
  add constraint stores_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add constraint stores_status_check check (status in ('pending', 'crawling', 'indexed', 'failed', 'blocked')),
  add constraint stores_checkout_connector_check
    check (checkout_connector in ('woo_store_api', 'magento_guest', 'handoff', 'browser')),
  add constraint stores_best_method_check
    check (best_method is null or best_method in ('api', 'dom', 'computer_use', 'none'));

-- Claim tokens live in their own service-role-only table: `stores` is publicly
-- readable (and on Realtime), so a token column there would leak.
create table public.store_claims (
  store_id uuid primary key references public.stores(id) on delete cascade,
  method text not null,                  -- 'dns_txt' | 'meta_tag'
  token text not null,                   -- random, e.g. "shoperzero-verify=3f9c..."
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_claims_method_check check (method in ('dns_txt', 'meta_tag'))
);

-- =====================================================================
-- 2. PRODUCTS
-- Legacy columns kept: price numeric, availability text, variants jsonb, images text[].
-- New code writes *_minor + product_variants; products.variants stays '[]'.
-- Column mapping from NormalizedProduct: description_text -> description,
-- images[].url -> images (alt is not persisted).
-- =====================================================================

-- Generated columns need IMMUTABLE expressions; array_to_string is only STABLE.
create or replace function public.immutable_array_to_string(arr text[], sep text)
returns text language sql immutable parallel safe
set search_path = ''
as $$ select pg_catalog.array_to_string(arr, sep) $$;

alter table public.products
  add column seq bigint generated always as identity,   -- Shopify-compat numeric id (products.json "id")
  add column handle text,                               -- url slug, unique per store
  add column description_html text,
  add column product_type text,
  add column category text,
  add column tags text[] not null default '{}',
  add column options jsonb not null default '[]'::jsonb, -- [{name, values[]}]
  add column price_min_minor bigint,                     -- min over variants
  add column price_max_minor bigint,                     -- max over variants
  add column available boolean not null default false,   -- any variant available
  add column source text,                                -- ExtractionSource
  add column gtin text,
  add column content_hash text,                          -- sha1 of normalized payload (skip-unchanged, embeddings)
  add column last_seen_at timestamptz,                   -- last crawl that saw this product
  add column fts tsvector generated always as (
    setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple'::regconfig,  coalesce(brand, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig,
      coalesce(product_type, '') || ' ' || coalesce(category, '') || ' ' ||
      public.immutable_array_to_string(tags, ' ')), 'B') ||
    setweight(to_tsvector('english'::regconfig, left(coalesce(description, ''), 2000)), 'C')
  ) stored;

update public.products set handle = id::text where handle is null;
alter table public.products alter column handle set not null;

-- Identity is (store_id, handle). Drop the legacy (store_id, url) unique so a URL
-- change on re-crawl can never make an upsert batch fail.
alter table public.products drop constraint if exists products_store_id_url_key;
create index products_store_url_idx on public.products (store_id, url);

alter table public.products
  add constraint products_seq_key unique (seq),
  add constraint products_source_check
    check (source is null or source in ('platform_api', 'jsonld', 'microdata', 'opengraph', 'render', 'llm', 'dom_recipe'));

create unique index products_store_handle_uq on public.products (store_id, handle);
create index products_fts_idx on public.products using gin (fts);
create index products_title_trgm on public.products using gin (title extensions.gin_trgm_ops);
create index products_filter_idx on public.products (store_id, available, price_min_minor);
create index products_brand_idx on public.products (lower(brand));
create index products_store_seq_idx on public.products (store_id, seq);
drop index if exists public.products_search_idx;   -- replaced by products_fts_idx

-- =====================================================================
-- 3. PRODUCT VARIANTS (= offers). One row per purchasable SKU.
-- =====================================================================
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,               -- Shopify-compat variants[].id
  product_id uuid not null references public.products(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  external_id text not null,                             -- stable variant key (see db/products.ts variantKey())
  title text not null default 'Default Title',
  options jsonb not null default '{}'::jsonb,            -- {"Size":"M","Color":"Blue"}
  sku text,
  gtin text,
  price_minor bigint not null,
  compare_at_minor bigint,
  currency text not null,
  availability text not null default 'unknown',         -- Availability
  available boolean not null default false,              -- availability in ('in_stock','preorder')
  inventory_quantity integer,
  image_url text,
  url text,
  position integer not null default 1,
  checked_at timestamptz not null default now(),         -- when price/stock was last observed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_product_external_key unique (product_id, external_id),
  constraint product_variants_seq_key unique (seq),
  constraint product_variants_price_check check (price_minor >= 0 and (compare_at_minor is null or compare_at_minor >= 0)),
  constraint product_variants_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint product_variants_availability_check
    check (availability in ('in_stock', 'out_of_stock', 'preorder', 'unknown'))
);
create index variants_product_idx on public.product_variants (product_id, position);
create index variants_store_idx on public.product_variants (store_id);
create index variants_gtin_idx on public.product_variants (gtin) where gtin is not null;

-- =====================================================================
-- 4. CRAWL RUNS (existing table) + stats
-- =====================================================================
alter table public.crawl_runs
  add column pages_fetched integer not null default 0,
  add column pages_failed integer not null default 0,
  add column log jsonb not null default '[]'::jsonb,     -- CrawlLogEntry[] {at, step?, level, msg, data?} (keep <= 50 entries)
  add column updated_at timestamptz not null default now();

alter table public.crawl_runs
  add constraint crawl_runs_status_check check (status in ('queued', 'running', 'succeeded', 'failed'));
create index crawl_runs_store_created_idx on public.crawl_runs (store_id, created_at desc);

-- =====================================================================
-- 4b. SCANS (scan and score, DECISIONS §A). One row = one ScanReport
-- (src/contracts/scan.ts). Public read + Realtime: /scan/{id} follows it live.
-- Written only by WS2 through db.upsertScan() (service role).
-- =====================================================================
create table public.scans (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  url text not null,                                     -- URL as submitted (normalized)
  mode text not null default 'cascade',                  -- ScanMode
  status text not null default 'queued',                 -- ScanStatus
  platform text not null default 'unknown',              -- Platform
  best_method text not null default 'none',              -- AccessMethod | 'none'
  probes jsonb not null default '[]'::jsonb,             -- AccessProbe[] in cascade order
  score integer not null default 0,                      -- 0..100
  grade text not null default 'F',
  checks jsonb not null default '[]'::jsonb,             -- ReadinessCheck[]
  after jsonb,                                           -- {score, grade} | null
  recommendations jsonb not null default '[]'::jsonb,    -- string[]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scans_mode_check check (mode in ('cascade', 'full')),
  constraint scans_status_check check (status in ('queued', 'running', 'done', 'failed')),
  constraint scans_platform_check check (platform in (
    'woocommerce', 'magento', 'bigcommerce', 'squarespace', 'sfcc',
    'prestashop', 'wix', 'shopify', 'custom', 'unknown')),
  constraint scans_best_method_check check (best_method in ('api', 'dom', 'computer_use', 'none')),
  constraint scans_score_check check (score between 0 and 100),
  constraint scans_grade_check check (grade in ('A', 'B', 'C', 'D', 'F')),
  constraint scans_probes_array_check check (jsonb_typeof(probes) = 'array'),
  constraint scans_checks_array_check check (jsonb_typeof(checks) = 'array'),
  constraint scans_recommendations_array_check check (jsonb_typeof(recommendations) = 'array')
);
create index scans_store_created_idx on public.scans (store_id, created_at desc);

-- stores.latest_scan_id can only be added now that public.scans exists.
alter table public.stores
  add column latest_scan_id uuid references public.scans(id) on delete set null;

-- =====================================================================
-- 5. CHECKOUT
-- =====================================================================
create table public.checkouts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  connector text not null,                               -- CheckoutConnectorId
  state text not null default 'quoting',                 -- CheckoutState (internal)
  line_items jsonb not null,                             -- LineItem[]
  buyer jsonb,                                           -- Buyer
  fulfillment jsonb,                                     -- CheckoutSession["fulfillment"]
  totals jsonb not null default '[]'::jsonb,             -- Total[]
  currency text,
  total_minor bigint,                                    -- frozen once state = awaiting_payment
  connector_state jsonb not null default '{}'::jsonb,    -- e.g. {cart_token, woo_order_id}; NEVER exposed
  payment jsonb not null default '{}'::jsonb,            -- CheckoutPaymentRecord
  continue_url text,
  idempotency_key text,
  agent_profile text,
  messages jsonb not null default '[]'::jsonb,           -- Message[] last returned to the agent
  error jsonb,                                           -- {code, message} on failure
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checkouts_idempotency_key_key unique (idempotency_key),
  constraint checkouts_connector_check check (connector in ('woo_store_api', 'magento_guest', 'handoff', 'browser')),
  constraint checkouts_state_check check (state in (
    'quoting', 'awaiting_payment', 'requires_action', 'payment_authorized', 'placing_order',
    'order_placed', 'completed', 'refunding', 'failed', 'expired', 'canceled', 'handoff'))
);
create index checkouts_store_idx on public.checkouts (store_id, created_at desc);

create table public.checkout_events (
  id bigint generated always as identity primary key,
  checkout_id uuid not null references public.checkouts(id) on delete cascade,
  from_state text,
  to_state text not null,
  message text,                                          -- human-readable, NO PII (public timeline)
  data jsonb not null default '{}'::jsonb,               -- {payment_intent_id, merchant_order_id, ...}; NO PII
  created_at timestamptz not null default now()
);
create index checkout_events_checkout_idx on public.checkout_events (checkout_id, id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  checkout_id uuid not null references public.checkouts(id),
  store_id uuid not null references public.stores(id),
  merchant_order_id text,
  merchant_order_url text,
  status text not null,                                  -- placed | confirmed | failed | refunded
  rail text not null,                                    -- stripe_spt
  payment_reference text,                                -- Stripe PaymentIntent id (pi_...)
  payer text,                                            -- reserved, null for Stripe
  amount_minor bigint not null,
  currency text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_checkout_id_key unique (checkout_id), -- one order per checkout = idempotency
  constraint orders_status_check check (status in ('placed', 'confirmed', 'failed', 'refunded')),
  constraint orders_rail_check check (rail = 'stripe_spt')
);
create index orders_store_idx on public.orders (store_id, created_at desc);

-- =====================================================================
-- 6. METRICS ("agent queries served")
-- =====================================================================
create table public.agent_requests (
  id bigint generated always as identity primary key,
  surface text not null,
  tool text,                                             -- MCP tool name or REST route id
  store_id uuid references public.stores(id) on delete set null,
  user_agent text,
  agent_profile text,                                    -- UCP-Agent profile URL, optional (WS3)
  created_at timestamptz not null default now(),
  constraint agent_requests_surface_check check (surface in (
    'mcp', 'rest', 'products_json', 'feed', 'llms_txt', 'ucp', 'openapi', 'agent_card'))
);
create index agent_requests_created_idx on public.agent_requests (created_at desc);

-- =====================================================================
-- 7. updated_at triggers (public.set_updated_at() exists from init.sql)
-- =====================================================================
create trigger store_claims_updated_at before update on public.store_claims
  for each row execute function public.set_updated_at();
create trigger variants_updated_at before update on public.product_variants
  for each row execute function public.set_updated_at();
create trigger crawl_runs_updated_at before update on public.crawl_runs
  for each row execute function public.set_updated_at();
create trigger scans_updated_at before update on public.scans
  for each row execute function public.set_updated_at();
create trigger checkouts_updated_at before update on public.checkouts
  for each row execute function public.set_updated_at();
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- =====================================================================
-- 8. RLS
-- Public read: stores, products, crawl_runs (policies from init.sql),
--              product_variants, scans, checkout_events (below).
-- Service-role only (RLS on, no policies): store_claims, checkouts, orders, agent_requests.
-- No insert/update/delete policies anywhere: all writes go through the
-- service-role (secret key) client, which bypasses RLS.
-- =====================================================================
alter table public.store_claims enable row level security;
alter table public.product_variants enable row level security;
alter table public.scans enable row level security;
alter table public.checkouts enable row level security;
alter table public.checkout_events enable row level security;
alter table public.orders enable row level security;
alter table public.agent_requests enable row level security;

create policy "variants are publicly readable" on public.product_variants
  for select to anon, authenticated using (true);
create policy "checkout events are publicly readable" on public.checkout_events
  for select to anon, authenticated using (true);
create policy "scans are publicly readable" on public.scans
  for select to anon, authenticated using (true);

-- Explicit grants. supabase/config.toml notes that new tables are NOT auto-exposed
-- to the Data API roles without explicit GRANTs on newer projects/CLIs, so grant
-- everything we rely on (idempotent and harmless on legacy projects).
grant usage on schema public to anon, authenticated, service_role;
grant select on public.stores, public.products, public.product_variants,
                public.crawl_runs, public.scans, public.checkout_events
  to anon, authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- =====================================================================
-- 9. REALTIME: scan page (scans), indexing progress (crawl_runs, stores)
--    and checkout timeline (checkout_events)
-- =====================================================================
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['crawl_runs', 'checkout_events', 'stores', 'scans'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- =====================================================================
-- 9b. STORAGE: public bucket for computer-use screenshots (DECISIONS §A).
-- Objects: "{scan_id}/{step}.png". Public URLs are served without RLS
-- (public bucket); uploads use the service-role key, which bypasses RLS.
-- The explicit policies below are belt and braces. Creating policies on
-- storage.objects can be refused on hosted projects where the migration role
-- does not own the table (UNVERIFIED), so they are created in a guarded block
-- that only raises a NOTICE; the bucket works either way.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scan-screenshots', 'scan-screenshots', true, 5242880,   -- 5 MB per screenshot
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'scan screenshots are publicly readable') then
    create policy "scan screenshots are publicly readable" on storage.objects
      for select to anon, authenticated using (bucket_id = 'scan-screenshots');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'service role writes scan screenshots') then
    create policy "service role writes scan screenshots" on storage.objects
      for all to service_role
      using (bucket_id = 'scan-screenshots') with check (bucket_id = 'scan-screenshots');
  end if;
exception when insufficient_privilege then
  raise notice 'scan-screenshots: storage.objects policies skipped (%). Public URLs and service-role uploads still work.', sqlerrm;
end $$;

-- =====================================================================
-- 10. RPC: upsert_product_batch  (service role only; called by src/infrastructure/database)
-- p_products: ProductUpsertRow[] as built by src/infrastructure/database/upsert-row.ts (§6.4).
-- WS2 CCR-1 semantics (B12). Per product, in its own sub-block (one bad product
-- never fails the batch):
--   * upsert on (store_id, handle); an unchanged content_hash only bumps last_seen_at;
--   * a different product already holding the handle (different url AND a different
--     non-null external_id) -> status 'failed', error 'handle_collision';
--   * variants upsert on (product_id, external_id) and keep their uuids;
--   * variants missing from the payload are NOT deleted: available=false,
--     availability='out_of_stock', position + 1000 (sort last);
-- Returns one row per input product. Finally recomputes stores.product_count.
-- =====================================================================
create or replace function public.upsert_product_batch(
  p_store_id uuid,
  p_products jsonb,
  p_seen_at timestamptz default null
)
returns table (product_id uuid, handle text, variant_count integer, status text, error text)
language plpgsql
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  p jsonb;
  v_pid uuid;
  v_keys text[];
  v_seen timestamptz := coalesce(p_seen_at, now());
  v_existing record;
begin
  if p_products is null or jsonb_typeof(p_products) <> 'array' then
    raise exception 'upsert_product_batch: p_products must be a JSON array';
  end if;

  for p in select e.value from jsonb_array_elements(p_products) as e(value) loop
    handle := p->>'handle';
    variant_count := coalesce(jsonb_array_length(case when jsonb_typeof(p->'variants') = 'array' then p->'variants' end), 0);
    product_id := null;
    status := null;
    error := null;

    begin
      if variant_count = 0 then
        raise exception using errcode = '22023', message = 'no_variants';
      end if;

      select pr.id, pr.url, pr.external_id, pr.content_hash
        into v_existing
        from public.products pr
       where pr.store_id = p_store_id and pr.handle = p->>'handle';

      if found and v_existing.url is distinct from p->>'url'
         and v_existing.external_id is not null and p->>'external_id' is not null
         and v_existing.external_id <> p->>'external_id' then
        raise exception using errcode = '23505', message = 'handle_collision';
      end if;

      if found and v_existing.content_hash is not null
         and v_existing.content_hash = p->>'content_hash' then
        update public.products set last_seen_at = v_seen where id = v_existing.id;
        product_id := v_existing.id;
        status := 'unchanged';
        return next;
        continue;
      end if;

      insert into public.products as t (
        store_id, handle, url, external_id, title, description, description_html, brand,
        product_type, category, tags, options, images, currency, price, availability,
        price_min_minor, price_max_minor, available, source, gtin, raw, content_hash, last_seen_at)
      values (
        p_store_id,
        p->>'handle',
        p->>'url',
        p->>'external_id',
        p->>'title',
        p->>'description_text',
        p->>'description_html',
        p->>'brand',
        p->>'product_type',
        p->>'category',
        array(select jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb))),
        coalesce(p->'options', '[]'::jsonb),
        array(select jsonb_array_elements_text(coalesce(p->'images', '[]'::jsonb))),
        p->>'currency',
        (p->>'price')::numeric,
        p->>'availability',
        (p->>'price_min_minor')::bigint,
        (p->>'price_max_minor')::bigint,
        coalesce((p->>'available')::boolean, false),
        p->>'source',
        p->>'gtin',
        coalesce(nullif(p->'raw', 'null'::jsonb), '{}'::jsonb),
        p->>'content_hash',
        v_seen)
      on conflict (store_id, handle) do update set
        url = excluded.url,
        external_id = excluded.external_id,
        title = excluded.title,
        description = excluded.description,
        description_html = excluded.description_html,
        brand = excluded.brand,
        product_type = excluded.product_type,
        category = excluded.category,
        tags = excluded.tags,
        options = excluded.options,
        images = excluded.images,
        currency = excluded.currency,
        price = excluded.price,
        availability = excluded.availability,
        price_min_minor = excluded.price_min_minor,
        price_max_minor = excluded.price_max_minor,
        available = excluded.available,
        source = excluded.source,
        gtin = excluded.gtin,
        raw = excluded.raw,
        content_hash = excluded.content_hash,
        last_seen_at = excluded.last_seen_at
      returning t.id into v_pid;

      select array_agg(x.value->>'external_id')
        into v_keys
        from jsonb_array_elements(p->'variants') as x(value);

      -- Never delete: stale variants stay resolvable for old checkouts, but are not purchasable.
      update public.product_variants pv
         set available = false,
             availability = 'out_of_stock',
             position = case when pv.position < 1000 then pv.position + 1000 else pv.position end
       where pv.product_id = v_pid
         and not (pv.external_id = any (v_keys))
         and (pv.available or pv.availability <> 'out_of_stock' or pv.position < 1000);

      insert into public.product_variants as t (
        product_id, store_id, external_id, title, options, sku, gtin, price_minor,
        compare_at_minor, currency, availability, available, inventory_quantity, image_url, url, position, checked_at)
      select
        v_pid,
        p_store_id,
        x.value->>'external_id',
        coalesce(x.value->>'title', 'Default Title'),
        coalesce(x.value->'options', '{}'::jsonb),
        x.value->>'sku',
        x.value->>'gtin',
        (x.value->>'price_minor')::bigint,
        (x.value->>'compare_at_minor')::bigint,
        x.value->>'currency',
        coalesce(x.value->>'availability', 'unknown'),
        coalesce((x.value->>'available')::boolean, false),
        (x.value->>'inventory_quantity')::integer,
        x.value->>'image_url',
        x.value->>'url',
        x.ord::integer,
        coalesce((x.value->>'checked_at')::timestamptz, v_seen)
      from jsonb_array_elements(p->'variants') with ordinality as x(value, ord)
      on conflict (product_id, external_id) do update set
        title = excluded.title,
        options = excluded.options,
        sku = excluded.sku,
        gtin = excluded.gtin,
        price_minor = excluded.price_minor,
        compare_at_minor = excluded.compare_at_minor,
        currency = excluded.currency,
        availability = excluded.availability,
        available = excluded.available,
        inventory_quantity = excluded.inventory_quantity,
        image_url = excluded.image_url,
        url = excluded.url,
        position = excluded.position,
        checked_at = excluded.checked_at;

      product_id := v_pid;
      status := 'upserted';
    exception when others then
      -- The sub-block's changes are rolled back; report and move on.
      product_id := null;
      status := 'failed';
      error := case when sqlerrm in ('handle_collision', 'no_variants') then sqlerrm
                    else sqlstate || ': ' || sqlerrm end;
    end;
    return next;
  end loop;

  update public.stores s
     set product_count = (select count(*) from public.products pr where pr.store_id = p_store_id)
   where s.id = p_store_id;
end;
$$;

-- =====================================================================
-- 11. RPC: search_products  (FTS + trigram; embedding param reserved)
-- Returns ranked ids + total_count (same value on every row). Callers hydrate
-- rows with getProductsByIds(). Excludes opted-out stores.
-- query_embedding: reserved for the stretch hybrid version (pgvector text
-- literal "[0.1,0.2,...]"); ignored here. Keep the signature when swapping.
-- =====================================================================
create or replace function public.search_products(
  query_text text default null,
  match_count integer default 10,
  match_offset integer default 0,
  p_store_id uuid default null,
  p_min_minor bigint default null,
  p_max_minor bigint default null,
  p_available boolean default true,
  p_brands text[] default null,
  p_categories text[] default null,
  p_currency text default null,
  query_embedding text default null
) returns table (id uuid, score real, total_count bigint)
language sql stable
set search_path = public, extensions
as $$
  with q as (
    select nullif(btrim(query_text), '') as qt
  ), qq as (
    select
      qt,
      -- all terms (Google-style syntax: "exact phrase", -exclude, or)
      case when qt is null then null else websearch_to_tsquery('english', qt) end as tsq_all,
      -- any term: OR of the stemmed lexemes, so "hoodie under 50" still finds hoodies
      case when qt is null then null else (
        select to_tsquery('simple', string_agg(quote_literal(l), ' | '))
          from unnest(tsvector_to_array(to_tsvector('english', qt))) as l
      ) end as tsq_any
    from q
  ), matches as (
    select
      p.id,
      p.updated_at,
      (case when qq.qt is null then 0
            else coalesce(ts_rank_cd(p.fts, qq.tsq_any), 0)
               + (case when p.fts @@ qq.tsq_all then 1 else 0 end)
               + word_similarity(qq.qt, p.title)
       end)::real as score
    from public.products p
    join public.stores s on s.id = p.store_id and not s.opted_out
    cross join qq
    where (p_store_id is null or p.store_id = p_store_id)
      and (p_available is null or p.available = p_available)
      and (p_min_minor is null or p.price_max_minor >= p_min_minor)
      and (p_max_minor is null or p.price_min_minor <= p_max_minor)
      and (p_currency is null or p.currency = upper(p_currency))
      and (p_brands is null or lower(p.brand) = any (select lower(b) from unnest(p_brands) as b))
      and (p_categories is null
           or lower(p.category) = any (select lower(c) from unnest(p_categories) as c)
           or lower(p.product_type) = any (select lower(c) from unnest(p_categories) as c))
      and (qq.qt is null
           or p.fts @@ qq.tsq_all
           or coalesce(p.fts @@ qq.tsq_any, false)
           or qq.qt <% p.title)
  )
  select m.id, m.score, count(*) over () as total_count
  from matches m
  order by m.score desc, m.updated_at desc, m.id
  limit greatest(1, least(coalesce(match_count, 10), 50))
  offset greatest(coalesce(match_offset, 0), 0);
$$;

-- =====================================================================
-- 12. RPC: get_public_metrics  (safe aggregate counts for the UI metrics strip)
-- =====================================================================
create or replace function public.get_public_metrics()
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'stores_total',       (select count(*) from public.stores where not opted_out),
    'stores_indexed',     (select count(*) from public.stores where status = 'indexed' and not opted_out),
    'products',           (select count(*) from public.products),
    'variants',           (select count(*) from public.product_variants),
    'agent_requests',     (select count(*) from public.agent_requests),
    'agent_requests_24h', (select count(*) from public.agent_requests where created_at > now() - interval '24 hours'),
    'checkouts',          (select count(*) from public.checkouts),
    'orders',             (select count(*) from public.orders where status in ('placed', 'confirmed')),
    'gmv_minor',          (select coalesce(jsonb_object_agg(currency, total), '{}'::jsonb)
                             from (select currency, sum(amount_minor) as total
                                     from public.orders where status in ('placed', 'confirmed')
                                    group by currency) g),
    -- round 2, optional keys (WS5)
    'stores_by_best_method', (select coalesce(jsonb_object_agg(best_method, n), '{}'::jsonb)
                                from (select best_method, count(*) as n from public.stores
                                       where best_method is not null and not opted_out
                                       group by best_method) b),
    'orders_by_rail',     (select coalesce(jsonb_object_agg(rail, n), '{}'::jsonb)
                             from (select rail, count(*) as n from public.orders
                                    where status in ('placed', 'confirmed') group by rail) r),
    'median_seconds_to_agent_ready',
                          (select round(percentile_cont(0.5) within group (
                                    order by extract(epoch from (finished_at - created_at)))::numeric, 1)
                             from public.crawl_runs
                            where status = 'succeeded' and finished_at is not null)
  );
$$;

-- Function privileges: functions are EXECUTE-able by PUBLIC by default; lock the writer down.
revoke execute on function public.upsert_product_batch(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.upsert_product_batch(uuid, jsonb, timestamptz) to service_role;
grant execute on function public.search_products(text, integer, integer, uuid, bigint, bigint, boolean, text[], text[], text, text)
  to anon, authenticated, service_role;
grant execute on function public.get_public_metrics() to anon, authenticated, service_role;
```

---

## 5. Seed: `supabase/seed.sql`

One demo store, three products, six variants (one out of stock), one finished crawl run, one finished scan. The fixed UUIDs are referenced by tests, curl examples and the UI:

| Entity | id |
|---|---|
| store `demo-store-example` | `11111111-1111-4111-8111-111111111111` |
| product Classic Pullover Hoodie ($45, S/M/L, L out of stock) | `22222222-2222-4222-8222-222222222201` |
| product Merino Crew Socks ($18, Charcoal/Oat) | `22222222-2222-4222-8222-222222222202` |
| product Canvas Tote Bag ($24, single variant) | `22222222-2222-4222-8222-222222222203` |
| variants hoodie S / M / L | `33333333-3333-4333-8333-3333333333{01,02,03}` |
| variants socks Charcoal / Oat, tote default | `33333333-3333-4333-8333-3333333333{04,05,06}` |
| crawl run | `44444444-4444-4444-8444-444444444401` |
| scan (done, best method `api`, grade D → after A) | `55555555-5555-4555-8555-555555555501` |

The store uses `checkout_connector = 'handoff'`, since `demo-store.example` is not a real store. The real Woo demo store gets crawled by WS2 and set to `woo_store_api` by WS4.

```sql
-- supabase/seed.sql: local dev seed (runs after migrations on `supabase db reset`).
-- 1 demo store + 3 products (6 variants) + 1 finished crawl run.
-- Fixed UUIDs so tests, curl examples and UI stories can reference them.
-- Never run against production; `supabase db push` does NOT apply seed.sql.

insert into public.stores (
  id, domain, slug, base_url, name, platform, currency, country, status,
  product_count, strategy, readiness, checkout_connector, last_crawled_at, metadata
) values (
  '11111111-1111-4111-8111-111111111111',
  'demo-store.example',
  'demo-store-example',
  'https://demo-store.example',
  'Northwind Demo Outfitters',
  'woocommerce',
  'USD',
  'US',
  'indexed',
  3,
  '{"tier":"platform_api","adapter":"woocommerce","sampled_at":"2026-09-26T09:00:00Z"}',
  '{
    "before": {"score": 35, "grade": "F", "computed_at": "2026-09-26T09:00:00Z", "checks": [
      {"id":"products_json","label":"Shopify-style /products.json","pass":false,"weight":15},
      {"id":"well_known_ucp","label":"UCP profile at /.well-known/ucp","pass":false,"weight":15},
      {"id":"mcp_endpoint","label":"MCP endpoint","pass":false,"weight":15},
      {"id":"llms_txt","label":"llms.txt","pass":false,"weight":10},
      {"id":"jsonld_product_coverage","label":"JSON-LD Product on product pages","pass":true,"weight":15,"detail":"3/3 sampled pages"},
      {"id":"sitemap","label":"XML sitemap","pass":true,"weight":10},
      {"id":"robots_allows_agents","label":"robots.txt allows agents","pass":true,"weight":10},
      {"id":"agent_checkout","label":"Agent checkout","pass":false,"weight":10}
    ]},
    "after": {"score": 90, "grade": "A", "computed_at": "2026-09-26T09:01:00Z", "checks": [
      {"id":"products_json","label":"Shopify-style /products.json","pass":true,"weight":15},
      {"id":"well_known_ucp","label":"UCP profile at /.well-known/ucp","pass":true,"weight":15},
      {"id":"mcp_endpoint","label":"MCP endpoint","pass":true,"weight":15},
      {"id":"llms_txt","label":"llms.txt","pass":true,"weight":10},
      {"id":"jsonld_product_coverage","label":"JSON-LD Product on product pages","pass":true,"weight":15},
      {"id":"sitemap","label":"XML sitemap","pass":true,"weight":10},
      {"id":"robots_allows_agents","label":"robots.txt allows agents","pass":true,"weight":10},
      {"id":"agent_checkout","label":"Agent checkout","pass":false,"weight":10,"detail":"handoff only"}
    ]}
  }',
  'handoff',
  '2026-09-26T09:01:00Z',
  '{"seed": true}'
);

insert into public.products (
  id, store_id, external_id, handle, url, title, description, description_html, brand,
  product_type, category, tags, options, images, currency, price, availability,
  price_min_minor, price_max_minor, available, source, raw, last_seen_at
) values
(
  '22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111111', '101',
  'classic-pullover-hoodie', 'https://demo-store.example/product/classic-pullover-hoodie/',
  'Classic Pullover Hoodie',
  'Heavyweight 400gsm organic cotton hoodie with a kangaroo pocket. Unisex fit.',
  '<p>Heavyweight 400gsm organic cotton hoodie with a kangaroo pocket. Unisex fit.</p>',
  'Northwind', 'Hoodies', 'Apparel > Tops', '{hoodie,cotton,unisex}',
  '[{"name":"Size","values":["S","M","L"]}]',
  '{https://picsum.photos/seed/sz-hoodie/800/800}',
  'USD', 45.00, 'in_stock', 4500, 4500, true, 'platform_api', '{"seed":true}', now()
),
(
  '22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111111', '102',
  'merino-crew-socks', 'https://demo-store.example/product/merino-crew-socks/',
  'Merino Crew Socks',
  'Midweight merino wool socks. Breathable, odor resistant.',
  '<p>Midweight merino wool socks. Breathable, odor resistant.</p>',
  'Northwind', 'Socks', 'Apparel > Accessories', '{socks,merino,wool}',
  '[{"name":"Color","values":["Charcoal","Oat"]}]',
  '{https://picsum.photos/seed/sz-socks/800/800}',
  'USD', 18.00, 'in_stock', 1800, 1800, true, 'platform_api', '{"seed":true}', now()
),
(
  '22222222-2222-4222-8222-222222222203', '11111111-1111-4111-8111-111111111111', '103',
  'canvas-tote-bag', 'https://demo-store.example/product/canvas-tote-bag/',
  'Canvas Tote Bag',
  'Waxed canvas tote with leather handles. 20 L.',
  '<p>Waxed canvas tote with leather handles. 20 L.</p>',
  'Northwind', 'Bags', 'Accessories > Bags', '{tote,canvas,bag}',
  '[]',
  '{https://picsum.photos/seed/sz-tote/800/800}',
  'USD', 24.00, 'in_stock', 2400, 2400, true, 'jsonld', '{"seed":true}', now()
);

insert into public.product_variants (
  id, product_id, store_id, external_id, title, options, sku, price_minor, compare_at_minor,
  currency, availability, available, inventory_quantity, image_url, url, position
) values
('33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111111',
 '1011', 'S', '{"Size":"S"}', 'NW-HOOD-S', 4500, 5500, 'USD', 'in_stock', true, 12, null,
 'https://demo-store.example/product/classic-pullover-hoodie/?attribute_pa_size=s', 1),
('33333333-3333-4333-8333-333333333302', '22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111111',
 '1012', 'M', '{"Size":"M"}', 'NW-HOOD-M', 4500, 5500, 'USD', 'in_stock', true, 7, null,
 'https://demo-store.example/product/classic-pullover-hoodie/?attribute_pa_size=m', 2),
('33333333-3333-4333-8333-333333333303', '22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111111',
 '1013', 'L', '{"Size":"L"}', 'NW-HOOD-L', 4500, 5500, 'USD', 'out_of_stock', false, 0, null,
 'https://demo-store.example/product/classic-pullover-hoodie/?attribute_pa_size=l', 3),
('33333333-3333-4333-8333-333333333304', '22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111111',
 '1021', 'Charcoal', '{"Color":"Charcoal"}', 'NW-SOCK-CH', 1800, null, 'USD', 'in_stock', true, 40, null,
 'https://demo-store.example/product/merino-crew-socks/?attribute_pa_color=charcoal', 1),
('33333333-3333-4333-8333-333333333305', '22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111111',
 '1022', 'Oat', '{"Color":"Oat"}', 'NW-SOCK-OAT', 1800, null, 'USD', 'in_stock', true, 25, null,
 'https://demo-store.example/product/merino-crew-socks/?attribute_pa_color=oat', 2),
('33333333-3333-4333-8333-333333333306', '22222222-2222-4222-8222-222222222203', '11111111-1111-4111-8111-111111111111',
 'default', 'Default Title', '{}', 'NW-TOTE', 2400, null, 'USD', 'in_stock', true, null, null,
 'https://demo-store.example/product/canvas-tote-bag/', 1);

insert into public.crawl_runs (
  id, store_id, status, strategy, products_found, pages_fetched, pages_failed, log, started_at, finished_at, created_at
) values (
  '44444444-4444-4444-8444-444444444401', '11111111-1111-4111-8111-111111111111', 'succeeded',
  'platform_api', 3, 4, 0,
  '[{"at":"2026-09-26T09:00:00Z","step":"detect","level":"info","msg":"Detected WooCommerce (Store API)","data":{"platform":"woocommerce"}},
    {"at":"2026-09-26T09:01:00Z","step":"done","level":"info","msg":"Indexed 3 products"}]',
  '2026-09-26T09:00:00Z', '2026-09-26T09:01:00Z', '2026-09-26T09:00:00Z'
);

-- One finished scan (DECISIONS §A) so /scan/{id} and get_scan render without a live run.
insert into public.scans (
  id, store_id, url, mode, status, platform, best_method, probes, score, grade, checks, after,
  recommendations, created_at
) values (
  '55555555-5555-4555-8555-555555555501', '11111111-1111-4111-8111-111111111111',
  'https://demo-store.example', 'cascade', 'done', 'woocommerce', 'api',
  '[
    {"method":"api","status":"partial","started_at":"2026-09-26T08:59:00.000Z","finished_at":"2026-09-26T08:59:02.000Z","duration_ms":2000,
     "signals":[{"id":"woo_store_api","label":"WooCommerce Store API","ok":true,"url":"https://demo-store.example/wp-json/wc/store/v1/products"},
                {"id":"well_known_ucp","label":"UCP profile at /.well-known/ucp","ok":false},
                {"id":"mcp","label":"MCP endpoint","ok":false}],
     "capabilities":{"catalog":true,"product_detail":true,"price_availability":true,"variants":true,"cart":true,"checkout_reachable":false},
     "sample_products":3,"est_seconds_per_task":1,"est_usd_per_task":0,
     "endpoints":["https://demo-store.example/wp-json/wc/store/v1/products"]},
    {"method":"dom","status":"skipped","started_at":null,"finished_at":null,"duration_ms":null,"signals":[],
     "capabilities":{"catalog":false,"product_detail":false,"price_availability":false,"variants":false,"cart":false,"checkout_reachable":false},
     "sample_products":0,"est_seconds_per_task":null,"est_usd_per_task":null},
    {"method":"computer_use","status":"skipped","started_at":null,"finished_at":null,"duration_ms":null,"signals":[],
     "capabilities":{"catalog":false,"product_detail":false,"price_availability":false,"variants":false,"cart":false,"checkout_reachable":false},
     "sample_products":0,"est_seconds_per_task":null,"est_usd_per_task":null}
  ]',
  45, 'D',
  '[{"id":"products_json","label":"Shopify-style /products.json","pass":false,"weight":15},
    {"id":"well_known_ucp","label":"UCP profile at /.well-known/ucp","pass":false,"weight":15},
    {"id":"sitemap","label":"XML sitemap","pass":true,"weight":10}]',
  '{"score": 90, "grade": "A"}',
  '["Publish a UCP profile at /.well-known/ucp", "Expose an MCP endpoint for agents"]',
  '2026-09-26T08:59:00Z'
);

update public.stores
   set best_method = 'api', latest_scan_id = '55555555-5555-4555-8555-555555555501'
 where id = '11111111-1111-4111-8111-111111111111';
```

### 5.1 Apply and generate types

Local (Docker running):
```bash
supabase start                     # first time only; prints the API URL + publishable/secret keys for .env.local
npm run db:reset                   # = supabase db reset: init.sql + core.sql, then seed.sql
npm run db:types                   # writes src/infrastructure/database/types.gen.ts (overwrites the placeholder)
```
Remote (the shared hosted project; already linked, see `supabase/.temp/project-ref`):
```bash
supabase db push                   # applies 20260926010000_core.sql; asks for the DB password (SUPABASE_DB_PASSWORD)
npm run db:types:remote            # only if local isn't available; local and remote must produce the same file
# Dev seed on remote (UNVERIFIED flag on CLI 2.109): supabase db push --include-seed
# Fallback: paste supabase/seed.sql into the Studio SQL editor. Remove before the demo (spec 00 §7, E-60).
```
Commit `types.gen.ts`. Regenerate it after every migration, from any stream, and commit it together with the migration.

---

## 6. `src/infrastructure/database/**`

All files except `mappers.ts` and `upsert-row.ts` start with `import "server-only"`. `index.ts` re-exports everything, so other streams `import { getProduct } from "@/lib/db"`. The signatures are fixed by spec 00 §6.10.

### 6.1 Client (`client.ts`) and typed Supabase clients
```ts
// src/infrastructure/database/client.ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "./types.gen";

let client: SupabaseClient<Database> | null = null;
/** Memoized service-role client (no session, bypasses RLS). Server code only. */
export function db(): SupabaseClient<Database> {
  return (client ??= createAdminClient());
}
```
```ts
// src/infrastructure/supabase/admin.ts (change: add the Database generic)
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types.gen";

export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
```
Also add `<Database>` to `createBrowserClient` in `src/infrastructure/supabase/client.ts` and to `createServerClient` in `server.ts` / `proxy.ts` (type-only change).

**Typed RPC gotcha.** The generated RPC arg types make defaulted params optional (`query_text?: string`). Pass `undefined` (omit the key) instead of `null` for "no filter". The SQL default (`null`) applies either way.

### 6.2 Select strings (`selects.ts`) and mappers (`mappers.ts`)
```ts
// src/infrastructure/database/selects.ts
export const STORE_REF_SELECT =
  "stores!inner(id, slug, name, domain, platform, checkout_connector, opted_out)" as const;
export const PRODUCT_SELECT =
  `id, seq, handle, url, external_id, title, description, description_html, brand, product_type, category, tags, options, images, currency, price_min_minor, price_max_minor, available, source, updated_at, ${STORE_REF_SELECT}, product_variants(*)` as const;
export const PRODUCT_SUMMARY_SELECT =
  `id, seq, handle, url, title, brand, product_type, images, currency, price_min_minor, price_max_minor, available, updated_at, ${STORE_REF_SELECT}, product_variants(count)` as const;
export const STORE_SELECT = "*" as const;
export const CRAWL_RUN_SELECT = "*" as const;
export const SCAN_SELECT = "*" as const;
```
- Every public product read adds `.eq("stores.opted_out", false)`.
- Rows are cast with `as unknown as ProductRow[]` (etc.) into the mapper row interfaces below. Those interfaces are the contract for the select strings.

`mappers.ts` (isomorphic; generated `Tables<"x">` rows are structurally assignable to the row interfaces):
```ts
// src/infrastructure/database/mappers.ts: row -> contract mappers. ISOMORPHIC (no server-only, no client import),
// so WS5 client components can map rows they read with the browser client.
// Row interfaces are structural and loose on purpose: generated Tables<"x"> rows are assignable.
import type {
  AccessMethod, Availability, CheckoutConnectorId, CheckoutEvent, CheckoutEventData, CheckoutState,
  CrawlLogEntry, CrawlRun, DomRecipe, ExtractionSource, IndexedProduct, IndexedVariant, Order, PaymentRailId,
  Platform, ProductSummary, ScanReport, Store, StoreRef, StoreStrategy, StoreSummary, StoreUrls,
} from "@/lib/contracts";
import { PLATFORMS } from "@/lib/contracts";

export const iso = (ts: string): string => new Date(ts).toISOString();
export const isoOrNull = (ts: string | null | undefined): string | null => (ts ? iso(ts) : null);

export function storeUrls(slug: string, base: string): StoreUrls {
  const b = base.replace(/\/+$/, "");
  return {
    page: `${b}/stores/${slug}`,
    products_json: `${b}/s/${slug}/products.json`,
    llms_txt: `${b}/s/${slug}/llms.txt`,
    feed: `${b}/s/${slug}/feed.acp.jsonl`,
    ucp: `${b}/s/${slug}/.well-known/ucp`,
    mcp: `${b}/api/mcp`,
  };
}

export function checkoutMethods(connector: string | null | undefined): CheckoutConnectorId[] {
  const c = (connector ?? "handoff") as CheckoutConnectorId;
  return c === "handoff" ? ["handoff"] : [c, "handoff"];
}

const asPlatform = (p: string | null | undefined): Platform =>
  (PLATFORMS as readonly string[]).includes(p ?? "") ? (p as Platform) : "unknown";

// ---------- stores ----------
export interface StoreRow {
  id: string; slug: string; domain: string; base_url: string; name: string | null; platform: string | null;
  currency: string | null; country: string | null; status: string; product_count: number;
  strategy: unknown; readiness: unknown; checkout_connector: string; claimed_at: string | null;
  opted_out: boolean; last_crawled_at: string | null; created_at: string; updated_at: string;
  best_method: string | null; dom_recipe: unknown; latest_scan_id: string | null;
}
export function toStore(r: StoreRow, base: string): Store {
  const readiness = (r.readiness ?? {}) as Store["readiness"];
  return {
    id: r.id, slug: r.slug, domain: r.domain, base_url: r.base_url, name: r.name,
    platform: asPlatform(r.platform), currency: r.currency, country: r.country,
    status: r.status as Store["status"], product_count: r.product_count,
    strategy: (r.strategy as StoreStrategy | null) ?? null,
    checkout_connector: (r.checkout_connector ?? "handoff") as CheckoutConnectorId,
    readiness, claimed: r.claimed_at !== null, claimed_at: isoOrNull(r.claimed_at), opted_out: r.opted_out,
    best_method: (r.best_method as AccessMethod | "none" | null) ?? null,
    dom_recipe: (r.dom_recipe as DomRecipe | null) ?? null,
    latest_scan_id: r.latest_scan_id ?? null,
    last_crawled_at: isoOrNull(r.last_crawled_at), created_at: iso(r.created_at), updated_at: iso(r.updated_at),
    urls: storeUrls(r.slug, base),
  };
}
export function toStoreSummary(r: StoreRow, base: string): StoreSummary {
  const { readiness, strategy: _s, dom_recipe: _d, ...rest } = toStore(r, base);
  return { ...rest, grade_before: readiness.before?.grade ?? null, grade_after: readiness.after?.grade ?? null };
}

// ---------- products ----------
export interface StoreRefRow { id: string; slug: string; name: string | null; domain: string; platform: string | null; checkout_connector: string }
export interface VariantRow {
  id: string; seq: number; product_id: string; external_id: string; title: string; options: unknown;
  sku: string | null; gtin: string | null; price_minor: number; compare_at_minor: number | null;
  currency: string; availability: string; inventory_quantity: number | null; image_url: string | null;
  url: string | null; position: number; checked_at: string;
}
export interface ProductRow {
  id: string; seq: number; handle: string; url: string; external_id: string | null; title: string;
  description: string | null; description_html: string | null; brand: string | null;
  product_type: string | null; category: string | null; tags: string[]; options: unknown; images: string[];
  currency: string | null; price_min_minor: number | null; price_max_minor: number | null;
  available: boolean; source: string | null; updated_at: string;
  stores: StoreRefRow;
  product_variants: VariantRow[];
}
const toStoreRef = (s: StoreRefRow): StoreRef =>
  ({ id: s.id, slug: s.slug, name: s.name, domain: s.domain, platform: asPlatform(s.platform) });

export function toIndexedVariant(v: VariantRow): IndexedVariant {
  return {
    id: v.id, seq: v.seq, product_id: v.product_id, external_id: v.external_id, position: v.position,
    title: v.title, options: (v.options ?? {}) as Record<string, string>, sku: v.sku, gtin: v.gtin,
    image_url: v.image_url, inventory_quantity: v.inventory_quantity,
    offer: {
      price: { amount: v.price_minor, currency: v.currency },
      compare_at: v.compare_at_minor === null ? null : { amount: v.compare_at_minor, currency: v.currency },
      availability: v.availability as Availability,
      url: v.url,
      checked_at: iso(v.checked_at),
    },
  };
}

export function toIndexedProduct(r: ProductRow): IndexedProduct {
  const variants = [...(r.product_variants ?? [])].sort((a, b) => a.position - b.position).map(toIndexedVariant);
  const currency = r.currency ?? variants[0]?.offer.price.currency ?? "USD";
  return {
    id: r.id, seq: r.seq, external_id: r.external_id, url: r.url, handle: r.handle, title: r.title,
    description_html: r.description_html, description_text: r.description, brand: r.brand,
    product_type: r.product_type, category: r.category, tags: r.tags ?? [],
    images: (r.images ?? []).map((url) => ({ url })),
    options: (r.options ?? []) as IndexedProduct["options"],
    source: (r.source ?? "jsonld") as ExtractionSource,
    store: toStoreRef(r.stores),
    price_range: {
      min: { amount: r.price_min_minor ?? 0, currency },
      max: { amount: r.price_max_minor ?? 0, currency },
    },
    available: r.available,
    variants,
    checkout_methods: checkoutMethods(r.stores.checkout_connector),
    updated_at: iso(r.updated_at),
  };
}

export interface ProductSummaryRow extends Omit<ProductRow, "product_variants" | "description" | "description_html" | "options" | "tags" | "external_id" | "category" | "source"> {
  product_variants: { count: number }[];
}
export function toProductSummary(r: ProductSummaryRow, score?: number): ProductSummary {
  const currency = r.currency ?? "USD";
  return {
    id: r.id, seq: r.seq, handle: r.handle, title: r.title, brand: r.brand, product_type: r.product_type,
    url: r.url, image_url: r.images?.[0] ?? null,
    price_range: { min: { amount: r.price_min_minor ?? 0, currency }, max: { amount: r.price_max_minor ?? 0, currency } },
    available: r.available, variants_count: r.product_variants?.[0]?.count ?? 0,
    store: toStoreRef(r.stores), checkout_methods: checkoutMethods(r.stores.checkout_connector),
    ...(score !== undefined ? { score } : {}),
  };
}

// ---------- crawl runs ----------
export interface CrawlRunRow {
  id: string; store_id: string; status: string; strategy: string | null; products_found: number;
  pages_fetched: number; pages_failed: number; log: unknown; error: string | null;
  started_at: string | null; finished_at: string | null; created_at: string; updated_at: string;
}
export function toCrawlRun(r: CrawlRunRow): CrawlRun {
  return {
    id: r.id, store_id: r.store_id, status: r.status as CrawlRun["status"], strategy: r.strategy,
    products_found: r.products_found, pages_fetched: r.pages_fetched, pages_failed: r.pages_failed,
    log: (Array.isArray(r.log) ? r.log : []) as CrawlLogEntry[], error: r.error,
    started_at: isoOrNull(r.started_at), finished_at: isoOrNull(r.finished_at),
    created_at: iso(r.created_at), updated_at: iso(r.updated_at),
  };
}

// ---------- checkout events / orders ----------
export interface CheckoutEventRow {
  id: number; checkout_id: string; from_state: string | null; to_state: string;
  message: string | null; data: unknown; created_at: string;
}
export function toCheckoutEvent(r: CheckoutEventRow): CheckoutEvent {
  return {
    id: r.id, checkout_id: r.checkout_id, from_state: r.from_state as CheckoutState | null,
    to_state: r.to_state as CheckoutState, message: r.message,
    data: (r.data ?? {}) as CheckoutEventData, created_at: iso(r.created_at),
  };
}

// ---------- scans (DECISIONS §A) ----------
export interface ScanRow {
  id: string; store_id: string; url: string; mode: string; status: string; platform: string;
  best_method: string; probes: unknown; score: number; grade: string; checks: unknown;
  after: unknown; recommendations: unknown; created_at: string; updated_at: string;
}
const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
/** Row -> the exact ScanReport contract. Also usable in the browser on Realtime payloads (payload.new). */
export function toScanReport(r: ScanRow): ScanReport {
  return {
    id: r.id, store_id: r.store_id, url: r.url,
    mode: r.mode as ScanReport["mode"], status: r.status as ScanReport["status"],
    platform: asPlatform(r.platform), best_method: r.best_method as ScanReport["best_method"],
    probes: asArray<ScanReport["probes"][number]>(r.probes),
    score: r.score, grade: r.grade as ScanReport["grade"],
    checks: asArray<ScanReport["checks"][number]>(r.checks),
    after: (r.after as ScanReport["after"]) ?? null,
    recommendations: asArray<string>(r.recommendations),
    created_at: iso(r.created_at), updated_at: iso(r.updated_at),
  };
}
export interface OrderRow {
  id: string; checkout_id: string; store_id: string; merchant_order_id: string | null;
  merchant_order_url: string | null; status: string; rail: string; payment_reference: string | null;
  payer: string | null; amount_minor: number; currency: string; created_at: string;
}
export function toOrder(r: OrderRow): Order {
  return {
    id: r.id, checkout_id: r.checkout_id, store_id: r.store_id, status: r.status as Order["status"],
    merchant_order_id: r.merchant_order_id, merchant_order_url: r.merchant_order_url,
    payment: {
      rail: r.rail as PaymentRailId, reference: r.payment_reference ?? "",
      amount: { amount: r.amount_minor, currency: r.currency },
      ...(r.payer ? { payer: r.payer } : {}),
    },
    created_at: iso(r.created_at),
  };
}
```

### 6.3 Behavior of each helper

Readers return `null` / `[]` for not-found (never throw for absence). They exclude opted-out stores unless the helper says otherwise. Supabase errors are thrown via `toAppError(error)`.

**`stores.ts`**
| Function | Behavior |
|---|---|
| `rowToStore(row)` | `toStore(row, appUrl())`. The single server-side row → `Store` mapper (WS2 CCR-2, WS5 CCR-7). Client code uses the isomorphic `toStore(row, base)`. |
| `getStoreById(id)` / `getStoreBySlug(slug)` / `getStoreByDomain(domain)` | Single row via `.maybeSingle()` → `toStore(row, appUrl())`. **Includes** opted-out stores (callers decide). A malformed uuid returns `null` (catch `22P02`). |
| `resolveStore(ref)` | Order: uuid regex → by id; contains `.` or `/` → `normalizeStoreUrl(ref, {allowPrivate: flags.allowPrivateStoreHosts()}).domain` → by domain; else → by slug. |
| `listStores(opts)` | Filters: `query` (ilike on `name` or `domain`, `%q%`), `platform`, `has_checkout` (`checkout_connector <> 'handoff'`), `status`, `opted_out = false` unless `include_opted_out`. Order `product_count desc, created_at desc`. Limit default 20, max 50. Maps with `toStoreSummary`. |
| `upsertStoreForUrl(rawUrl)` | `normalizeStoreUrl` (throws → `AppError("validation_error")`). If a row with that `domain` exists, return `{store, created:false}`. Else insert `{domain, base_url, slug, status:'pending', platform:null}`. On slug `23505` retry with `slug-2`, `slug-3`… (max 20). Returns `{store, created:true}`. |
| `updateStore(id, patch)` | Update only the provided keys; return the mapped store. `metadata` is **merged** (read, spread, write), not replaced. Round 2 keys: `best_method`, `dom_recipe`, `latest_scan_id` (WS2 writes them after a scan), `base_url` (redirects), `checkout_methods` (legacy column). |
| `setStoreReadiness(id, phase, report)` | Read `readiness`, set `readiness[phase] = report`, write back. |

**`crawl-runs.ts`**
| Function | Behavior |
|---|---|
| `createCrawlRun(storeId)` | Insert `{store_id, status:'queued'}` and return `toCrawlRun`. |
| `getCrawlRun(id)` / `getLatestCrawlRun(storeId)` | Latest = order by `created_at desc` limit 1. |
| `claimCrawlRun(id)` | `update crawl_runs set status='running', started_at=now() where id=$1 and status='queued'` + `.select().maybeSingle()`. `null` = lost the claim. |
| `getActiveCrawlRun(storeId, withinMin)` | `status in ('queued','running') and created_at > now() - withinMin minutes`, latest first, or `null`. |
| `countActiveCrawlRuns(withinMin)` | Same filter across all stores, `{ count: "exact", head: true }`. |
| `updateCrawlRun(id, patch)` | Partial update. WS2 calls it at most once per 10 products (Realtime traffic). |
| `appendCrawlLog(id, entries)` | Read `log`, append entries (`at` defaults to `new Date().toISOString()`; `step` is kept when given), keep the last **50** (WS5 CCR-1), write. One writer per run is assumed (the crawler). |

**`products.ts`**
| Function | Behavior |
|---|---|
| `upsertStoreProducts(storeId, products, opts?)` | WS2 CCR-1 semantics. For each product call `buildUpsertRow(p)` (§6.4); invalid ones go to `skipped[]` with a reason. Then `dedupeHandles(rows)`, chunk by **25**, and call `db().rpc("upsert_product_batch", { p_store_id, p_products: chunk, p_seen_at: opts?.seenAt })`. Map each returned row by position back to its input URL: `upserted` → counted + `product_ids`; `unchanged` → counted in both `upserted` and `unchanged` + `product_ids`; `failed` → `failed[]` `{url, error}` (e.g. `handle_collision`; WS2 retries with a hashed handle). A whole-chunk RPC error puts every product of that chunk in `failed[]` and continues. **Never throws** for data problems. Returns `{upserted, unchanged, product_ids, skipped, failed}`. |
| `getProduct(id)` | `id` forms: uuid → product by id, else a variant with that id → its product; `"^([a-z0-9-]+):(\d+)$"` → store by slug, then product by `(store_id, seq)`; `"^\d+$"` → product by `seq`. Uses `PRODUCT_SELECT` + opted-out filter → `toIndexedProduct`. Unknown → `null`. |
| `getProductByHandle(storeId, handle)` | `(store_id, handle)` lookup, full product. |
| `getProductsByIds(ids)` | `.in("id", ids)` with `PRODUCT_SELECT`, re-ordered to input order. |
| `findProducts(where)` | WS3 CR-1. One query with `PRODUCT_SELECT` + opted-out filter: `ids` → `.in("id")`, `seqs` → `.in("seq")`, `storeId` → `.eq("store_id")`, `handles` → `.in("handle")`; `variantIds` / `variantSeqs` first resolve parent ids from `product_variants` (`.in("id")` / `.in("seq")`). Keys are ANDed. Order by `seq`; `limit` default 50, max 250. |
| `lookupProducts(refs)` | Up to 10 refs. Resolve each with the `getProduct` rules. Dedupe products (two refs can point to one product). Unresolved refs go to `not_found`, in input order. |
| `listStoreProducts(storeId, {limit, page?, offset?, order?})` | Clamp `limit` to 1..250. Start = `offset` when given, else `(max(page,1)-1)*limit`. `order: "seq"` (default, `products.json`) → `.order("seq")`; `"recent"` (WS5 store grid) → `.order("available", {ascending:false}).order("updated_at", {ascending:false})`. `.range(start, start+limit-1)`, `{ count: "exact" }`. Returns full products + `total`. |
| `searchProducts(params)` | See the code below. `available` defaults to `true` (`undefined` → true, `null` → any). |
| `getProductSummaries(ids)` | `PRODUCT_SUMMARY_SELECT` + opted-out filter, in input order. |
| `getVariantsForCheckout(lines)` | Select `product_variants` by the given ids with `products!inner(id, title, url, handle, external_id, store_id, stores!inner(opted_out))`. Unknown or opted-out ids → `AppError("not_found", "Unknown variant(s)", { missing })`. Group by `store_id`, keeping quantity and input order, and return `ResolvedLine[]` groups. WS4 rejects more than one group with `unprocessable`. |
| `getVariantForVerify(variantId)` | `product_variants` by id with `products!inner(id, url, external_id, handle, store_id)`, then `getStoreById(store_id)` (opted-out included). Returns `{variant: toIndexedVariant(v), product, store}` or `null` (also for a malformed uuid). |
| `updateVariantOffer(variantId, offer)` | Update the variant's `price_minor`, `compare_at_minor`, `currency`, `availability`, `available`, `url` (only if non-null) and `checked_at`. Then recompute the parent's `price_min_minor`, `price_max_minor` and `available` from all its variants (select + update). |

```ts
// searchProducts (products.ts)
export async function searchProducts(params: SearchParams): Promise<SearchResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? SEARCH_DEFAULT_LIMIT), 1), SEARCH_MAX_LIMIT);
  const offset = Math.max(Math.trunc(params.offset ?? 0), 0);
  const available = params.available === undefined ? true : params.available; // null = any
  const args = {
    query_text: params.query?.trim() || undefined,
    match_count: limit,
    match_offset: offset,
    p_store_id: params.store_id ?? undefined,
    p_min_minor: params.min_minor ?? undefined,
    p_max_minor: params.max_minor ?? undefined,
    p_available: available, // true | false | null. null MUST be sent explicitly (SQL default is true)
    p_brands: params.brands?.length ? params.brands : undefined,
    p_categories: params.categories?.length ? params.categories : undefined,
    p_currency: params.currency?.toUpperCase() ?? undefined,
  };
  const { data, error } = await db().rpc("search_products", args as never); // generated arg types reject null
  if (error) throw toAppError(error);
  const rows = (data ?? []) as { id: string; score: number; total_count: number }[];
  const summaries = await getProductSummaries(rows.map((r) => r.id));
  const scoreById = new Map(rows.map((r) => [r.id, r.score]));
  const products = summaries.map((s) => ({ ...s, score: scoreById.get(s.id) }));
  const total = rows[0]?.total_count ?? 0;
  const next = offset + rows.length;
  return { products, total_count: total, next_offset: next < total ? next : null };
}
```
Note on `p_available`: the SQL default is `true`, so "any availability" requires sending JSON `null`. That is why the args object is built explicitly and cast (`as never`) past the generated arg type. Every other filter is omitted when unset.

**`scans.ts`** (WS2 writes; WS3 / WS5 read; DECISIONS §A, 02 §15.3). All map through `toScanReport`, so every reader gets the exact `ScanReport` contract.
| Function | Behavior |
|---|---|
| `getScan(id)` | `maybeSingle` by id; malformed uuid (`22P02`) → `null`. Opted-out stores' scans are included (the report is about the site, not the index). |
| `upsertScan(patch)` | With `id`: update only the keys present (shallow merge; `probes`, `checks`, `recommendations`, `after` replaced whole), `.select().single()`. Without `id` (needs `store_id` + `url`): insert with the column defaults. Unknown keys (`id`, `created_at`, `updated_at` in a patch) are ignored. Does **not** touch `stores`. WS2 updates `stores.best_method` / `dom_recipe` / `latest_scan_id` with `updateStore`. Single writer per scan assumed. |
| `claimScan(id)` | `update scans set status='running' where id=$1 and status='queued'`, `.select().maybeSingle()`; `null` = lost the claim. |
| `getLatestScanForStore(storeId, {status?})` | Order `created_at desc` limit 1, optional `.eq("status")`. |
| `getActiveScanForStore(storeId, withinMin)` | `status in ('queued','running') and created_at > now() - withinMin minutes`, latest first. |
| `countActiveScans(withinMin)` | Same filter across all stores, `{ count: "exact", head: true }`. |
| `supersedeScans(storeId, exceptId)` | `update scans set status='failed' where store_id=$1 and id<>$2 and status in ('queued','running')`; returns the row count. |
| `uploadScanScreenshot(scanId, name, bytes, contentType)` | `db().storage.from("scan-screenshots").upload(`${scanId}/${name}`, bytes, { contentType, upsert: true, cacheControl: "31536000" })`, then `getPublicUrl(path).data.publicUrl`. Throws `AppError("upstream_error")` on a storage error. |

**`checkouts.ts`** (WS1 implements; WS4 is the only caller)
| Function | Behavior |
|---|---|
| `insertCheckout(row)` | Insert and return a `CheckoutRecord` (jsonb fields cast to contract types). On `23505` for `idempotency_key` → `AppError("conflict")`. WS4 then calls `getCheckoutByIdempotencyKey`. |
| `getCheckoutRecord(id)` / `getCheckoutByIdempotencyKey(key)` | `maybeSingle`; malformed uuid → `null`. |
| `updateCheckoutRecord(id, patch, {expectState})` | `.update(patch).eq("id", id)`, plus `.eq("state", expectState)` when given. `.select().maybeSingle()`. Returns `null` if no row matched (lost race / wrong state). |
| `insertCheckoutEvent(ev)` / `listCheckoutEvents(checkoutId)` | Events are ordered by `id asc`. The message must be PII-free (the caller's responsibility). |
| `insertOrder(o)` | Flattens `o.payment` into `rail`, `payment_reference`, `payer`, `amount_minor`, `currency`. `23505` on `checkout_id` → `AppError("conflict")` (idempotency: read the existing order instead). |
| `getOrder(id)` / `getOrderByCheckoutId(id)` / `updateOrderStatus(id, status)` | Via `toOrder`. |

**`claims.ts`** (WS5 is the caller)
| Function | Behavior |
|---|---|
| `upsertClaim(storeId, method)` | `token = crypto.randomUUID().replaceAll("-", "")`. Upsert on `store_id` (rotates the token, resets `verified_at = null`). Returns `StoreClaim`. Use only for an explicit "new token" action. |
| `getOrCreateClaim(storeId, method = "dns_txt")` | **Non-rotating**: return the existing row (update only `method` if a different one is given; the token stays), else insert a new one like `upsertClaim`. Use on page loads so a refresh never invalidates a published record. |
| `getClaim(storeId)` | `maybeSingle`. |
| `markClaimVerified(storeId)` | Set `store_claims.verified_at = now()` and `stores.claimed_at = now()` (two updates). |
| `setStoreOptOut(storeId, optedOut)` | Updates `stores.opted_out`. Opted-out stores vanish from search, lookups and outputs immediately. |

Claim publishing convention (WS5 verifies): DNS TXT record at **`_shoperzero.<host>`** (host = the store domain without `www.` and without a path) with value **`shoperzero-verify=<token>`**, or `<meta name="shoperzero-verify" content="<token>">` on the store homepage.

**`metrics.ts`**
| Function | Behavior |
|---|---|
| `logAgentRequest(r)` | Insert into `agent_requests` (incl. optional `agent_profile`, truncated to 2048 chars). Wrapped in try/catch, it logs `log.warn("metrics.agent_request.failed")` and **never throws**. Call it inside `after(() => logAgentRequest(...))`. `user_agent` is truncated to 300 chars. For MCP only WS3's `instrumentServer` calls it. |
| `getIndexStats()` / `getIndexStats(storeId)` | No argument (WS3): `{ stores, products }` = count of `stores` with `status='indexed' and not opted_out`, and the sum of their `product_count`. With a store id (WS2): `{ product_count, variant_count, offers_complete_ratio }`, where the ratio = products whose variants all have `price_minor` and an `availability <> 'unknown'` / `product_count` (0 when there are no products). Implement as one function with an overload signature. |
| `getPublicMetrics()` | `db().rpc("get_public_metrics")` → `PublicMetrics`. The browser can call the same RPC with the publishable key. |

### 6.4 Product → upsert row (`upsert-row.ts`, pure and unit-tested)

This module is the single place where `NormalizedProduct` becomes DB rows. Rules:
- zod-validate the product.
- Reject mixed variant currencies.
- Variant key: `external_id` > `sku:<sku>` > `opt:<slug of option values>` > `opt:<slug of title>` > `default`. Duplicates get `~2`, `~3`.
- `available` = variant `in_stock` or `preorder`.
- Legacy `products.price` / `availability` are still filled.
- Tags and image URLs are deduped (max 20 images).
- `raw` is dropped when over 100 KB.
- `content_hash` = sha1 of the row without `raw` and `checked_at`.
- Handles are made unique within a batch with a `-<6 hex>` suffix.

```ts
// src/infrastructure/database/upsert-row.ts: pure mapping NormalizedProduct -> upsert_product_batch payload row.
import { createHash } from "node:crypto";
import {
  NormalizedProductSchema, type Availability, type NormalizedProduct, type NormalizedVariant,
} from "@/lib/contracts";
import { fromMinor } from "@/lib/money";
import { shortHash, slugify } from "@/lib/slug";

/** One element of the p_products JSON array consumed by public.upsert_product_batch(). */
export interface ProductUpsertRow {
  handle: string;
  url: string;
  external_id: string | null;
  title: string;
  description_text: string | null;
  description_html: string | null;
  brand: string | null;
  product_type: string | null;
  category: string | null;
  tags: string[];
  options: { name: string; values: string[] }[];
  images: string[];
  currency: string;
  price: string;                       // legacy numeric column, decimal string of price_min_minor
  availability: Availability;          // legacy products.availability
  price_min_minor: number;
  price_max_minor: number;
  available: boolean;
  source: string;
  gtin: string | null;
  raw: unknown;
  content_hash: string;
  variants: VariantUpsertRow[];
}
export interface VariantUpsertRow {
  external_id: string;
  title: string;
  options: Record<string, string>;
  sku: string | null;
  gtin: string | null;
  price_minor: number;
  compare_at_minor: number | null;
  currency: string;
  availability: Availability;
  available: boolean;
  inventory_quantity: number | null;
  image_url: string | null;
  url: string | null;
  checked_at: string;
}

const RAW_MAX_BYTES = 100_000;
const isAvailable = (a: Availability) => a === "in_stock" || a === "preorder";

/** Stable per-product variant key: source id > sku > option/title slug > "default". */
export function variantKey(v: NormalizedVariant): string {
  if (v.external_id) return v.external_id;
  if (v.sku) return `sku:${v.sku}`;
  const optionValues = Object.values(v.options);
  if (optionValues.length) return `opt:${slugify(optionValues.join("-"))}`;
  if (v.title && v.title !== "Default Title") return `opt:${slugify(v.title)}`;
  return "default";
}

export type BuildResult =
  | { ok: true; row: ProductUpsertRow }
  | { ok: false; url: string; reason: string };

/** Validates + maps one product. Never throws. */
export function buildUpsertRow(input: unknown): BuildResult {
  const parsed = NormalizedProductSchema.safeParse(input);
  const url = typeof (input as { url?: unknown })?.url === "string" ? (input as { url: string }).url : "?";
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, url, reason: `invalid: ${issue.path.join(".")} ${issue.message}` };
  }
  const p: NormalizedProduct = parsed.data;
  const currency = p.variants[0].offer.price.currency;
  if (p.variants.some((v) => v.offer.price.currency !== currency)) {
    return { ok: false, url, reason: "mixed_currency" };
  }

  const seen = new Map<string, number>();
  const variants: VariantUpsertRow[] = p.variants.map((v) => {
    const base = variantKey(v);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return {
      external_id: n === 1 ? base : `${base}~${n}`,
      title: v.title,
      options: v.options,
      sku: v.sku,
      gtin: v.gtin,
      price_minor: v.offer.price.amount,
      compare_at_minor: v.offer.compare_at?.amount ?? null,
      currency,
      availability: v.offer.availability,
      available: isAvailable(v.offer.availability),
      inventory_quantity: v.inventory_quantity,
      image_url: v.image_url,
      url: v.offer.url,
      checked_at: v.offer.checked_at,
    };
  });

  const prices = variants.map((v) => v.price_minor);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avs = variants.map((v) => v.availability);
  const availability: Availability = avs.includes("in_stock") ? "in_stock"
    : avs.includes("preorder") ? "preorder"
    : avs.every((a) => a === "out_of_stock") ? "out_of_stock" : "unknown";

  let raw: unknown = p.raw ?? {};
  try {
    if (JSON.stringify(raw).length > RAW_MAX_BYTES) raw = { _truncated: true };
  } catch {
    raw = { _unserializable: true };
  }

  const row: Omit<ProductUpsertRow, "content_hash"> = {
    handle: p.handle.trim(),
    url: p.url,
    external_id: p.external_id,
    title: p.title.trim(),
    description_text: p.description_text?.slice(0, 20_000) ?? null,
    description_html: p.description_html?.slice(0, 50_000) ?? null,
    brand: p.brand,
    product_type: p.product_type,
    category: p.category,
    tags: [...new Set(p.tags.map((t) => t.trim()).filter(Boolean))],
    options: p.options,
    images: [...new Set(p.images.map((i) => i.url))].slice(0, 20),
    currency,
    price: fromMinor(min, currency),
    availability,
    price_min_minor: min,
    price_max_minor: max,
    available: variants.some((v) => v.available),
    source: p.source,
    gtin: p.variants.length === 1 ? p.variants[0].gtin : null,
    raw,
    variants,
  };
  // Hash everything except raw and observation timestamps, so unchanged products hash equal.
  const { raw: _raw, variants: vs, ...rest } = row;
  const hashInput = JSON.stringify({ ...rest, variants: vs.map(({ checked_at: _c, ...v }) => v) });
  const content_hash = createHash("sha1").update(hashInput).digest("hex");
  return { ok: true, row: { ...row, content_hash } };
}

/** Makes handles unique within one batch: later duplicates get "-" + 6 hex chars of hash(url). */
export function dedupeHandles(rows: ProductUpsertRow[]): ProductUpsertRow[] {
  const byHandle = new Map<string, string>(); // handle -> url
  return rows.map((r) => {
    const prevUrl = byHandle.get(r.handle);
    if (prevUrl === undefined || prevUrl === r.url) {
      byHandle.set(r.handle, r.url);
      return r;
    }
    const handle = `${r.handle}-${shortHash(r.url).slice(0, 6)}`;
    byHandle.set(handle, r.url);
    return { ...r, handle };
  });
}
```
```ts
// tests/unit/database/upsert-row.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUpsertRow, dedupeHandles, variantKey } from "./upsert-row";

const offer = (amount: number, availability = "in_stock") => ({
  price: { amount, currency: "USD" }, compare_at: null, availability, url: null, checked_at: "2026-09-26T10:00:00.000Z",
});
const base = {
  external_id: "101", url: "https://x.com/p/hoodie", handle: "hoodie", title: " Hoodie ",
  description_html: null, description_text: "warm", brand: "NW", product_type: "Hoodies", category: null,
  tags: ["a", "a", " b "], images: [{ url: "https://x.com/1.jpg" }, { url: "https://x.com/1.jpg" }],
  options: [{ name: "Size", values: ["S", "M"] }], source: "platform_api",
  variants: [
    { external_id: null, title: "S", options: { Size: "S" }, sku: null, gtin: null, image_url: null, inventory_quantity: null, offer: offer(4500, "out_of_stock") },
    { external_id: null, title: "M", options: { Size: "M" }, sku: null, gtin: null, image_url: null, inventory_quantity: 3, offer: offer(5000) },
    { external_id: null, title: "M", options: { Size: "M" }, sku: null, gtin: null, image_url: null, inventory_quantity: 3, offer: offer(5000) },
  ],
};

test("buildUpsertRow", () => {
  const r = buildUpsertRow(base);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.row.title, "Hoodie");
  assert.deepEqual(r.row.tags, ["a", "b"]);
  assert.deepEqual(r.row.images, ["https://x.com/1.jpg"]);
  assert.equal(r.row.price_min_minor, 4500);
  assert.equal(r.row.price_max_minor, 5000);
  assert.equal(r.row.price, "45.00");
  assert.equal(r.row.available, true);
  assert.equal(r.row.availability, "in_stock");
  assert.deepEqual(r.row.variants.map((v) => v.external_id), ["opt:s", "opt:m", "opt:m~2"]);
  const again = buildUpsertRow({ ...base, variants: base.variants.map((v) => ({ ...v, offer: { ...v.offer, checked_at: "2026-09-27T00:00:00.000Z" } })) });
  assert.ok(again.ok && again.row.content_hash === r.row.content_hash);
  const bad = buildUpsertRow({ ...base, variants: [] });
  assert.equal(bad.ok, false);
  const mixed = buildUpsertRow({ ...base, variants: [base.variants[0], { ...base.variants[1], offer: { ...offer(1), price: { amount: 1, currency: "EUR" } } }] });
  assert.deepEqual(mixed, { ok: false, url: "https://x.com/p/hoodie", reason: "mixed_currency" });
  assert.equal(variantKey({ ...base.variants[0], options: {}, title: "Default Title" } as never), "default");
  const rows = dedupeHandles([r.row, { ...r.row, url: "https://x.com/other" }, r.row]);
  assert.equal(rows[0].handle, "hoodie");
  assert.match(rows[1].handle, /^hoodie-[0-9a-f]{6}$/);
  assert.equal(rows[2].handle, "hoodie");
});
```

---

## 7. `src/shared/money.ts` and `src/shared/slug.ts` (isomorphic)

Behavior summary:

| Function | Contract |
|---|---|
| `currencyExponent(c)` | Via `Intl`: USD 2, JPY 0, KWD 3; unknown → 2 (cached) |
| `money(amount, c)` | Validates a safe integer, upper-cases the code; throws |
| `toMinor(v, c)` | Strict decimal → minor, **string arithmetic** (no float multiply), half-up on the first dropped digit: `"1.005"` USD → 101; throws on non-decimal |
| `parsePrice(raw, c)` | Lenient scraped-price parser. The right-most of `.`/`,` is the decimal separator when both appear; a lone comma followed by 1–2 digits is decimal; otherwise separators are thousands. Returns `null` when unparseable |
| `rescaleMinor(amount, fromExp, c)` | Woo `prices.price` with `currency_minor_unit` → our exponent (`"115"`, 0, USD → 11500) |
| `fromMinor(amount, c)` | `"25.00"` (Shopify strings, exact exponent digits, no grouping) |
| `formatMoney(m, locale)` | UI display `"$45.00"` |
| `acpPrice(m)` | `"25.00 USD"` |
| `addMoney`, `multiplyMoney`, `sumMoney` | Throw on currency mismatch or a non-integer qty |
| `slugify(s, max=80)` | NFKD, strip diacritics, lower-case, `[^a-z0-9]+` → `-`, trim dashes |
| `shortHash(s)` | FNV-1a 32-bit, 8 hex (deterministic, not security) |
| `normalizeStoreUrl(raw, {allowPrivate})` | Adds `https://`; http(s) only; keeps the first path segment only if it looks like a locale (`uk`, `en-gb`); rejects localhost/`.local`/`.internal`/IP literals unless `allowPrivate` (SSRF guard); returns `{domain, base_url, slug}` |
| `storeSlugFromDomain(d)` (alias `slugFromDomain`) | `"bulk.com/uk"` → `"bulk-com-uk"`, max 63 |
| `handleFromUrl(url)` | Last meaningful path segment without `.html/.php/...`; generic segments (`product`, `index`, `p`…) fall back to query pairs (`?p=123` → `p-123`); else `product-<hash>`. Deterministic |

```ts
// src/shared/money.ts
// Isomorphic (server + client). All money in the app is integer minor units.
import type { Money } from "@/lib/contracts";

const exponentCache = new Map<string, number>();

/** Number of minor-unit digits: USD 2, JPY 0, KWD 3. Unknown codes fall back to 2. */
export function currencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  const hit = exponentCache.get(code);
  if (hit !== undefined) return hit;
  let exp = 2;
  try {
    exp = new Intl.NumberFormat("en", { style: "currency", currency: code })
      .resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    exp = 2;
  }
  exponentCache.set(code, exp);
  return exp;
}

/** Builds a Money, validating integer amount and upper-casing the currency. Throws on bad input. */
export function money(amount: number, currency: string): Money {
  if (!Number.isSafeInteger(amount)) throw new Error(`money: amount must be an integer, got ${amount}`);
  const code = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error(`money: bad currency ${currency}`);
  return { amount, currency: code };
}

/**
 * Strict decimal -> minor units. Accepts "25", "25.5", "25.50", "-3.10", 25.5.
 * Extra fraction digits are rounded half-up ("1.005" USD -> 101). Throws on anything else.
 */
export function toMinor(value: string | number, currency: string): number {
  const exp = currencyExponent(currency);
  const s = typeof value === "number" ? numberToPlain(value) : value.trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`toMinor: not a decimal: ${JSON.stringify(value)}`);
  const [, neg, int, frac = ""] = m;
  const kept = (frac + "0".repeat(exp)).slice(0, exp);
  let minor = Number(int) * 10 ** exp + (kept ? Number(kept) : 0);
  if (frac.length > exp && Number(frac[exp]) >= 5) minor += 1; // half-up on the first dropped digit
  return neg ? -minor : minor;
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`toMinor: not finite: ${n}`);
  // Avoid exponent notation; 12 fraction digits is plenty for prices.
  return n.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Lenient price parser for scraped text/JSON-LD. Returns null when nothing parseable.
 * "£1,299.00" -> 129900 (GBP) · "1.299,00 €" -> 129900 (EUR) · "25,50" -> 2550 · "1,299" -> 129900 ·
 * " $45 " -> 4500 · 19.99 -> 1999 · "" / "Call us" / null -> null.
 */
export function parsePrice(raw: unknown, currency: string): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? toMinor(raw, currency) : null;
  if (typeof raw !== "string") return null;
  let s = raw.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: the right-most one is the decimal separator.
    const dec = lastDot > lastComma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    s = s.split(thou).join("").replace(dec, ".");
  } else if (lastComma >= 0) {
    // Only commas: decimal iff exactly one comma followed by 1-2 digits at the end.
    const parts = s.split(",");
    s = parts.length === 2 && /^\d{1,2}$/.test(parts[1]) ? `${parts[0]}.${parts[1]}` : parts.join("");
  } else if (lastDot >= 0) {
    // Only dots: several dots = thousands separators ("1.299.000").
    const parts = s.split(".");
    if (parts.length > 2) s = parts.join("");
  }
  try {
    const v = toMinor(s.replace(/^-/, ""), currency);
    return v;
  } catch {
    return null;
  }
}

/** Re-scales an integer minor amount from a source exponent (e.g. Woo currency_minor_unit) to the currency's exponent. */
export function rescaleMinor(amount: number | string, fromExponent: number, currency: string): number {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) throw new Error(`rescaleMinor: bad amount ${amount}`);
  const diff = currencyExponent(currency) - fromExponent;
  return diff >= 0 ? Math.round(n * 10 ** diff) : Math.round(n / 10 ** -diff);
}

/** Minor units -> plain decimal string with exactly `exponent` digits: (2500,"USD") -> "25.00"; (500,"JPY") -> "500". */
export function fromMinor(amount: number, currency: string): string {
  const exp = currencyExponent(currency);
  const neg = amount < 0;
  const abs = Math.abs(Math.trunc(amount)).toString().padStart(exp + 1, "0");
  const out = exp === 0 ? abs : `${abs.slice(0, -exp)}.${abs.slice(-exp)}`;
  return neg ? `-${out}` : out;
}

/** Display string: ({4500,"USD"}) -> "$45.00". */
export function formatMoney(m: Money, locale = "en-US"): string {
  const exp = currencyExponent(m.currency);
  return new Intl.NumberFormat(locale, { style: "currency", currency: m.currency })
    .format(m.amount / 10 ** exp);
}

/** ACP feed price: "25.00 USD". */
export function acpPrice(m: Money): string {
  return `${fromMinor(m.amount, m.currency)} ${m.currency}`;
}


export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error(`currency mismatch ${a.currency}/${b.currency}`);
  return money(a.amount + b.amount, a.currency);
}

export function multiplyMoney(m: Money, qty: number): Money {
  if (!Number.isInteger(qty)) throw new Error("multiplyMoney: qty must be an integer");
  return money(m.amount * qty, m.currency);
}

export function sumMoney(items: Money[], currency: string): Money {
  return items.reduce((acc, m) => addMoney(acc, m), money(0, currency));
}
```
```ts
// src/shared/slug.ts
// Isomorphic (server + client). No node:crypto so client components can import it.

/** "Café Crème  Hoodie!" -> "cafe-creme-hoodie". Empty/unsluggable input -> "". */
export function slugify(input: string, maxLen = 80): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
}

/** 32-bit FNV-1a, 8 hex chars. Deterministic short hash for handles/suffixes (not security). */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const LOCALE_SEGMENT = /^[a-z]{2}([-_][a-z]{2})?$/i;
const BLOCKED_HOST = /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i;
const IP_HOST = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])$/i;

export interface NormalizedStoreUrl {
  domain: string;   // identity key: host without "www." + locale prefix: "bulk.com/uk"
  base_url: string; // fetch root: "https://www.bulk.com/uk" (no trailing slash)
  slug: string;     // "bulk-com-uk"
}

/**
 * Accepts "www.bulk.com/uk", "https://Shop.Example.com/", "shop.example.com/product/x?y=1".
 * - Adds https:// when no scheme. Only http/https.
 * - Keeps the first path segment ONLY if it looks like a locale/storefront prefix (uk, en-gb); drops the rest.
 * - Rejects localhost, *.local, *.internal and IP literals unless allowPrivate (ALLOW_PRIVATE_STORE_HOSTS=true).
 * Throws Error("invalid_store_url: ...") on bad input (callers map to AppError validation_error).
 */
export function normalizeStoreUrl(raw: string, opts: { allowPrivate?: boolean } = {}): NormalizedStoreUrl {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("invalid_store_url: empty");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new Error(`invalid_store_url: ${raw}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`invalid_store_url: scheme ${u.protocol}`);
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") && !opts.allowPrivate) throw new Error(`invalid_store_url: host ${host}`);
  if (!opts.allowPrivate && (BLOCKED_HOST.test(host) || IP_HOST.test(host))) {
    throw new Error(`invalid_store_url: private host ${host}`);
  }
  const first = u.pathname.split("/").filter(Boolean)[0];
  const prefix = first && LOCALE_SEGMENT.test(first) ? `/${first.toLowerCase()}` : "";
  const port = u.port ? `:${u.port}` : "";
  const bareHost = host.replace(/^www\./, "");
  const domain = `${bareHost}${port}${prefix}`;
  return {
    domain,
    base_url: `${u.protocol}//${host}${port}${prefix}`,
    slug: storeSlugFromDomain(domain),
  };
}

/** "bulk.com/uk" -> "bulk-com-uk"; "www.Shop.co.uk" -> "shop-co-uk". Max 63 chars. */
export function storeSlugFromDomain(domain: string): string {
  const s = slugify(domain.replace(/^https?:\/\//i, "").replace(/^www\./i, ""), 63);
  return s || `store-${shortHash(domain)}`;
}
/** Alias requested by WS2 (02 §13 CCR-4). Same function. */
export const slugFromDomain = storeSlugFromDomain;

/**
 * Deterministic product handle from a PDP URL (same URL -> same handle, always).
 * "https://x.com/product/classic-hoodie/" -> "classic-hoodie"
 * "https://x.com/p/Blue-Shirt.html"       -> "blue-shirt"
 * "https://x.com/index.php?route=product/product&product_id=42" -> "product-id-42" style fallback via query
 * "https://x.com/?p=123"                  -> "p-123"
 * Nothing usable                          -> "product-" + shortHash(url)
 */
export function handleFromUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `product-${shortHash(url)}`;
  }
  const segs = u.pathname.split("/").filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  const last = (segs[segs.length - 1] ?? "").replace(/\.(html?|php|aspx?|jsp)$/i, "");
  const fromPath = slugify(last, 120);
  const generic = /^(index|product|products|p|item|default)$/;
  if (fromPath && !generic.test(fromPath)) return fromPath;
  const fromQuery = slugify(
    [...u.searchParams.entries()]
      .filter(([k]) => !/^(utm_|ref$|route$|variant$|attribute_)/i.test(k))
      .map(([k, v]) => `${k}-${v}`)
      .join("-"),
    120,
  );
  if (fromQuery) return fromQuery;
  return `product-${shortHash(url)}`;
}
```
Tests: save as `tests/unit/foundation.test.ts` (money, slug and contract checks, including that every MCP input schema converts to JSON Schema). Runs with `npm test`.
```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { acpPrice, currencyExponent, formatMoney, fromMinor, parsePrice, rescaleMinor, toMinor } from "./money";
import { handleFromUrl, normalizeStoreUrl, slugify, storeSlugFromDomain } from "./slug";
import {
  CompleteCheckoutInputSchema, CreateCheckoutInputSchema, NormalizedProductSchema,
  SearchCatalogInputSchema, STATE_TO_STATUS, ALLOWED_TRANSITIONS, CHECKOUT_STATES, MCP_TOOL_INPUTS,
} from "./contracts";
import { z } from "zod";

test("money", () => {
  assert.equal(currencyExponent("usd"), 2);
  assert.equal(currencyExponent("JPY"), 0);
  assert.equal(currencyExponent("KWD"), 3);
  assert.equal(currencyExponent("XXX_BAD"), 2);
  assert.equal(toMinor("25", "USD"), 2500);
  assert.equal(toMinor("25.5", "USD"), 2550);
  assert.equal(toMinor(19.99, "USD"), 1999);
  assert.equal(toMinor("1.005", "USD"), 101);
  assert.equal(toMinor("500", "JPY"), 500);
  assert.equal(toMinor("1.2345", "KWD"), 1235);
  assert.throws(() => toMinor("abc", "USD"));
  assert.equal(parsePrice("£1,299.00", "GBP"), 129900);
  assert.equal(parsePrice("1.299,00 €", "EUR"), 129900);
  assert.equal(parsePrice("25,50", "EUR"), 2550);
  assert.equal(parsePrice("1,299", "USD"), 129900);
  assert.equal(parsePrice(" $45 ", "USD"), 4500);
  assert.equal(parsePrice(19.99, "USD"), 1999);
  assert.equal(parsePrice("Call us", "USD"), null);
  assert.equal(parsePrice(null, "USD"), null);
  assert.equal(rescaleMinor("115", 0, "USD"), 11500);
  assert.equal(rescaleMinor("4500", 2, "USD"), 4500);
  assert.equal(rescaleMinor(4500, 2, "JPY"), 45);
  assert.equal(fromMinor(2500, "USD"), "25.00");
  assert.equal(fromMinor(5, "USD"), "0.05");
  assert.equal(fromMinor(500, "JPY"), "500");
  assert.equal(fromMinor(-150, "USD"), "-1.50");
  assert.equal(formatMoney({ amount: 4500, currency: "USD" }), "$45.00");
  assert.equal(acpPrice({ amount: 2500, currency: "USD" }), "25.00 USD");
});

test("slug", () => {
  assert.equal(slugify("Café Crème  Hoodie!"), "cafe-creme-hoodie");
  assert.equal(slugify("!!!"), "");
  assert.deepEqual(normalizeStoreUrl("www.bulk.com/uk"), { domain: "bulk.com/uk", base_url: "https://www.bulk.com/uk", slug: "bulk-com-uk" });
  assert.deepEqual(normalizeStoreUrl("https://Shop.Example.com/"), { domain: "shop.example.com", base_url: "https://shop.example.com", slug: "shop-example-com" });
  assert.deepEqual(normalizeStoreUrl("hester-demo.squarespace.com/shop/p/thing?x=1"), { domain: "hester-demo.squarespace.com", base_url: "https://hester-demo.squarespace.com", slug: "hester-demo-squarespace-com" });
  assert.throws(() => normalizeStoreUrl("http://localhost:8080"));
  assert.throws(() => normalizeStoreUrl("http://10.0.0.1"));
  assert.throws(() => normalizeStoreUrl("ftp://x.com"));
  assert.deepEqual(normalizeStoreUrl("http://localhost:8080", { allowPrivate: true }), { domain: "localhost:8080", base_url: "http://localhost:8080", slug: "localhost-8080" });
  assert.equal(storeSlugFromDomain("www.Shop.co.uk"), "shop-co-uk");
  assert.equal(handleFromUrl("https://x.com/product/classic-hoodie/"), "classic-hoodie");
  assert.equal(handleFromUrl("https://x.com/p/Blue-Shirt.html"), "blue-shirt");
  assert.equal(handleFromUrl("https://x.com/?p=123"), "p-123");
  assert.equal(handleFromUrl("https://x.com/index.php?route=product/product&product_id=42"), "product-id-42");
  assert.match(handleFromUrl("https://x.com/"), /^product-[0-9a-f]{8}$/);
  assert.equal(handleFromUrl("https://x.com/"), handleFromUrl("https://x.com/"));
});

test("contracts", () => {
  for (const s of CHECKOUT_STATES) {
    assert.ok(STATE_TO_STATUS[s]);
    for (const t of ALLOWED_TRANSITIONS[s]) assert.ok(CHECKOUT_STATES.includes(t));
  }
  const ok = CreateCheckoutInputSchema.safeParse({
    line_items: [{ variant_id: "33333333-3333-4333-8333-333333333301", quantity: 1 }],
    buyer: { email: "a@b.co" },
    fulfillment: { address: { name: "A", line1: "1 Main", city: "SF", postal_code: "94107", country: "us" } },
  });
  assert.ok(ok.success, JSON.stringify(ok.error?.issues));
  assert.equal(ok.data!.fulfillment!.address.country, "US");
  assert.equal(CreateCheckoutInputSchema.safeParse({ line_items: [] }).success, false);
  assert.ok(CompleteCheckoutInputSchema.safeParse({
    payment: { instruments: [{ handler_id: "app.shoperzero.stripe_spt", type: "card", credential: { type: "spt", token: "spt_123" } }] },
  }).success);
  assert.equal(CompleteCheckoutInputSchema.safeParse({
    payment: { instruments: [{ handler_id: "app.shoperzero.stripe_spt", type: "card", credential: { type: "spt", token: "" } }] },
  }).success, false);
  assert.ok(SearchCatalogInputSchema.safeParse({ catalog: { query: "hoodie", filters: { price: { max: 5000 } } }, meta: { "ucp-agent": { profile: "https://a/p.json" }, extra: 1 } }).success);
  assert.ok(SearchCatalogInputSchema.safeParse({ catalog: {} }).success);
  const np = NormalizedProductSchema.safeParse({
    external_id: null, url: "https://x.com/p/a", handle: "a", title: "A", description_html: null, description_text: null,
    brand: null, product_type: null, category: null, tags: [], images: [{ url: "https://x.com/a.jpg" }], options: [],
    variants: [{ external_id: null, title: "Default Title", options: {}, sku: null, gtin: null, image_url: null, inventory_quantity: null,
      offer: { price: { amount: 100, currency: "USD" }, compare_at: null, availability: "in_stock", url: null, checked_at: new Date().toISOString() } }],
    source: "jsonld",
  });
  assert.ok(np.success, JSON.stringify(np.error?.issues));
  // every MCP input schema converts to JSON Schema (what tools/list will expose)
  for (const [name, schema] of Object.entries(MCP_TOOL_INPUTS)) {
    const js = z.toJSONSchema(schema, { io: "input" }) as { type?: string };
    assert.equal(js.type, "object", name);
  }
});
```

---

## 8. `src/proxy.ts` (matcher only)

Replace the file with the code below. The regex was tested against sample paths. Proxy runs on `/`, `/scan`, `/stores/x`, `/checkouts/x`, `/claim/x` and `/search`. It skips `/api/*`, `/s/*` (including `/s/x/.well-known/ucp`), `/.well-known/*`, `/llms.txt`, `/robots.txt`, `/openapi.json`, `/sitemap.xml`, `_next` assets and images.
```ts
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Refresh the Supabase session only for human UI pages. Skipped: static assets, every API
  // route (api/*), per-store agent outputs (s/*) and root discovery files; none use cookies.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|s/|\\.well-known/|llms\\.txt|robots\\.txt|openapi\\.json|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
```
Matcher check (same regex, run from the repo root):
```bash
node -e '
const re = new RegExp("^/((?!_next/static|_next/image|favicon.ico|api/|s/|\\.well-known/|llms\\.txt|robots\\.txt|openapi\\.json|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)$");
for (const p of ["/", "/scan", "/stores/x", "/checkouts/x", "/claim/x", "/api/mcp", "/api/v1/search", "/s/x/products.json", "/s/x/.well-known/ucp", "/.well-known/ucp", "/llms.txt", "/robots.txt", "/openapi.json", "/logo.png"])
  console.log(re.test(p) ? "PROXY" : "skip ", p);'
```

---

## 9. `.env.example` (replace the whole file)

```bash
# Supabase: get these from `supabase status` (local) or the project dashboard (Settings → API)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
# Server-only. Never expose to the browser.
SUPABASE_SECRET_KEY=
# Supabase CLI only (supabase link / db push). Not read by the app.
SUPABASE_DB_PASSWORD=

# App (all streams). Public base URL without trailing slash.
APP_URL=http://localhost:3000
LOG_LEVEL=info

# Ingestion (WS2)
CRAWLER_USER_AGENT="ShoperZeroBot/0.1 (+http://localhost:3000/bot)"
CRAWL_MAX_PRODUCTS=150
CRAWL_TIME_BUDGET_MS=240000
CRAWL_MAX_CONCURRENT_RUNS=3
CRAWL_TIERS=platform_api,jsonld
# true only in local dev when the Woo demo store runs on localhost / a private IP
ALLOW_PRIVATE_STORE_HOSTS=false

# Scan and score (WS2). ANTHROPIC_API_KEY is core: without it the dom recipe and computer-use probes are skipped.
ANTHROPIC_API_KEY=
SCAN_MODEL=claude-opus-5-5
SCAN_MAX_CONCURRENT=3
SCAN_CU_ENABLED=1
SCAN_CU_MAX_STEPS=15
# Optional: remote browser for the dom / computer_use probes (required on Vercel). Empty = local Playwright.
BROWSERBASE_API_KEY=
BROWSERBASE_PROJECT_ID=
# Optional: JS-only shop fixture (infra/fixtures/js-shop) for probe tests
JS_SHOP_FIXTURE_URL=

# Stripe, TEST MODE ONLY (WS4)
STRIPE_SECRET_KEY=
STRIPE_PREVIEW_VERSION=2026-04-22.preview
# spt | fallback (pm_card_visa)
STRIPE_SPT_MODE=spt

DEMO_WALLET_ENABLED=false
DEMO_WALLET_TOKEN=

# Checkout safety (WS4)
# Comma-separated hosts allowed for headless woo_store_api checkout (empty = only WOO_DEMO_URL's host)
CHECKOUT_ALLOWED_DOMAINS=
# Stretch browser connector
CHECKOUT_BROWSER_ENABLED=false
CHECKOUT_BROWSER_HOSTS=
# Dev only: force every checkout to handoff
CHECKOUT_FORCE_HANDOFF=false

# WooCommerce demo store (WS4; WS2 crawls it)
WOO_DEMO_URL=
# Optional: REST v3 keys, only if WS4 adds order notes via /wp-json/wc/v3
WOO_CONSUMER_KEY=
WOO_CONSUMER_SECRET=

# Web UI (WS5). 1 = UI runs on mock/fixtures, no Supabase
NEXT_PUBLIC_UI_MOCK=

# Stretch (leave empty unless the feature is being built)
OPENAI_API_KEY=
FIRECRAWL_API_KEY=
CRON_SECRET=
```
Mirror every non-empty value into Vercel (Production + Preview) before E−60.

---

## 10. Shared helpers (`src/shared/errors.ts`, `http.ts`, `log.ts`, `env.ts`)

```ts
// src/shared/errors.ts  (isomorphic)
// Isomorphic. Throw AppError anywhere; route/tool wrappers turn it into the envelope.
import { z } from "zod";
import { API_ERROR_STATUS, type ApiErrorCode } from "@/lib/contracts";

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: unknown;
  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
  get status(): number {
    return API_ERROR_STATUS[this.code];
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

type PgLikeError = { code: string; message: string; details?: string | null };
function isPgLikeError(e: unknown): e is PgLikeError {
  return typeof e === "object" && e !== null && typeof (e as PgLikeError).code === "string"
    && typeof (e as PgLikeError).message === "string";
}

/** Maps anything thrown to an AppError. Unknown errors become "internal" (message hidden). */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof z.ZodError) return new AppError("validation_error", "Invalid input", z.flattenError(e));
  if (isPgLikeError(e)) {
    if (e.code === "23505") return new AppError("conflict", "Already exists", { detail: e.details ?? null });
    if (e.code === "PGRST116") return new AppError("not_found", "Not found");
    if (e.code === "22P02") return new AppError("validation_error", "Malformed identifier");
    if (e.code === "23514") return new AppError("validation_error", "Value not allowed", { detail: e.message });
  }
  return new AppError("internal", "Internal error");
}
```
```ts
// src/shared/http.ts  (server-only)
import "server-only";
import type { NextRequest } from "next/server";
import type { z } from "zod";
import type { ApiErrorBody } from "@/lib/contracts";
import { AppError, toAppError } from "@/lib/errors";
import { log } from "@/lib/log";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "content-type, authorization, idempotency-key, ucp-agent, request-id, mcp-session-id, mcp-protocol-version, last-event-id",
  "Access-Control-Expose-Headers": "request-id, mcp-session-id",
  "Access-Control-Max-Age": "86400",
};

export function getRequestId(req: Request): string {
  return req.headers.get("request-id") ?? req.headers.get("x-request-id") ?? crypto.randomUUID();
}

/** JSON response with CORS + Request-Id headers. */
export function json(data: unknown, init: ResponseInit & { requestId?: string } = {}): Response {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  if (init.requestId) headers.set("Request-Id", init.requestId);
  return Response.json(data, { status: init.status ?? 200, headers });
}

/** Plain text / other content types (llms.txt, jsonl) with CORS. */
export function text(body: string, contentType = "text/plain; charset=utf-8", init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  headers.set("Content-Type", contentType);
  return new Response(body, { status: init.status ?? 200, headers });
}

/** Error envelope. Unknown errors are logged with stack and returned as "internal". */
export function errorResponse(err: unknown, requestId?: string): Response {
  const e = toAppError(err);
  if (e.code === "internal") log.error("http.unhandled", err, { request_id: requestId });
  const body: ApiErrorBody = {
    error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}), request_id: requestId },
  };
  return json(body, { status: e.status, requestId });
}

/** `export const OPTIONS = preflight;` in every public route file. */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function parseJsonBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError("bad_request", "Body must be valid JSON");
  }
  return schema.parse(raw); // ZodError -> validation_error via toAppError
}

/** Query string -> object (repeated keys become arrays) -> schema. Use z.coerce for numbers/booleans. */
export function parseSearchParams<S extends z.ZodType>(req: Request, schema: S): z.output<S> {
  const obj: Record<string, string | string[]> = {};
  for (const [k, v] of new URL(req.url).searchParams) {
    const prev = obj[k];
    obj[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return schema.parse(obj);
}

/** Wraps a route handler: request id, error envelope, timing log. */
export function route<Ctx>(
  name: string,
  handler: (req: NextRequest, ctx: Ctx, meta: { requestId: string }) => Promise<Response>,
): (req: NextRequest, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    const requestId = getRequestId(req);
    const started = Date.now();
    try {
      const res = await handler(req, ctx, { requestId });
      if (!res.headers.has("Request-Id")) res.headers.set("Request-Id", requestId);
      log.info("http.request", { route: name, method: req.method, status: res.status, ms: Date.now() - started, request_id: requestId });
      return res;
    } catch (err) {
      const res = errorResponse(err, requestId);
      log.warn("http.request", { route: name, method: req.method, status: res.status, ms: Date.now() - started, request_id: requestId });
      return res;
    }
  };
}
```
Route usage (every public route file):
```ts
// src/app/api/v1/products/[id]/route.ts (WS3), illustrative
import { route, json, preflight } from "@/lib/http";
import { getProduct } from "@/lib/db";
import { AppError } from "@/lib/errors";

export const GET = route("products.get", async (_req, ctx: RouteContext<"/api/v1/products/[id]">, { requestId }) => {
  const { id } = await ctx.params;
  const product = await getProduct(id);
  if (!product) throw new AppError("not_found", "Product not found", { id });
  return json({ product }, { requestId });
});
export const OPTIONS = preflight;
```
```ts
// src/shared/log.ts  (isomorphic)
// One JSON line per event on stdout/stderr (Vercel captures both). Isomorphic but meant for server code.
type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const REDACT = /token|secret|password|authorization|cookie|private_?key|signature|email|phone|address|line1|postal|cart_token/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out: Fields = {};
  for (const [k, v] of Object.entries(value as Fields)) {
    out[k] = REDACT.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

function emit(level: Level, event: string, fields?: Fields) {
  if (level === "debug" && process.env.LOG_LEVEL !== "debug") return;
  const line = JSON.stringify({ level, ts: new Date().toISOString(), event, ...(redact(fields ?? {}) as Fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: Fields) => emit("debug", event, fields),
  info: (event: string, fields?: Fields) => emit("info", event, fields),
  warn: (event: string, fields?: Fields) => emit("warn", event, fields),
  error: (event: string, err?: unknown, fields?: Fields) =>
    emit("error", event, {
      ...fields,
      err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack?.split("\n").slice(0, 5).join("\n") } : err,
    }),
};
```
```ts
// src/shared/env.ts  (server-only)
import "server-only";
import { AppError } from "@/lib/errors";

export type EnvName =
  | "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" | "SUPABASE_SECRET_KEY"
  | "APP_URL" | "CRAWLER_USER_AGENT" | "CRAWL_MAX_PRODUCTS" | "ALLOW_PRIVATE_STORE_HOSTS" | "LOG_LEVEL"
  | "STRIPE_SECRET_KEY" | "STRIPE_PREVIEW_VERSION"
  | "DEMO_WALLET_ENABLED"
  | "WOO_DEMO_URL" | "WOO_CONSUMER_KEY" | "WOO_CONSUMER_SECRET"
  | "CRAWL_TIME_BUDGET_MS" | "CRAWL_MAX_CONCURRENT_RUNS" | "CRAWL_TIERS"
  | "ANTHROPIC_API_KEY" | "SCAN_MODEL" | "SCAN_MAX_CONCURRENT" | "SCAN_CU_ENABLED" | "SCAN_CU_MAX_STEPS"
  | "BROWSERBASE_API_KEY" | "BROWSERBASE_PROJECT_ID" | "JS_SHOP_FIXTURE_URL"
  | "STRIPE_SPT_MODE" | "DEMO_WALLET_TOKEN"
  | "CHECKOUT_ALLOWED_DOMAINS" | "CHECKOUT_BROWSER_ENABLED" | "CHECKOUT_BROWSER_HOSTS" | "CHECKOUT_FORCE_HANDOFF"
  | "NEXT_PUBLIC_UI_MOCK"
  | "OPENAI_API_KEY" | "FIRECRAWL_API_KEY" | "CRON_SECRET";

/** Read lazily (never at module top level) so `next build` works without secrets. */
export function optionalEnv(name: EnvName): string | undefined {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? undefined : v.trim();
}

/** Throws AppError("not_implemented") naming the missing variable; the feature degrades, the app does not crash. */
export function requireEnv(name: EnvName): string {
  const v = optionalEnv(name);
  if (!v) throw new AppError("not_implemented", `Server is missing ${name}`);
  return v;
}

/** Public base URL, no trailing slash. APP_URL > Vercel production URL > localhost. */
export function appUrl(): string {
  const explicit = optionalEnv("APP_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export const flags = {
  demoWalletEnabled: () => optionalEnv("DEMO_WALLET_ENABLED") === "true",
  allowPrivateStoreHosts: () => optionalEnv("ALLOW_PRIVATE_STORE_HOSTS") === "true",
  crawlMaxProducts: () => Number(optionalEnv("CRAWL_MAX_PRODUCTS") ?? 150) || 150,
  crawlerUserAgent: () =>
    optionalEnv("CRAWLER_USER_AGENT") ?? `ShoperZeroBot/0.1 (+${appUrl()}/bot)`,
  scanCuEnabled: () => (optionalEnv("SCAN_CU_ENABLED") ?? "1") !== "0",
  scanCuMaxSteps: () => Math.min(Number(optionalEnv("SCAN_CU_MAX_STEPS") ?? 15) || 15, 15),
};
```

---

## 11. `scripts/db/smoke.ts`

Run with `npm run db:smoke`, against whatever `.env.local` points to: local by default, or remote if you swap the env.
```ts
// Wrapped in main(): the file runs as CommonJS under tsx, where top-level await is not allowed.
import assert from "node:assert/strict";
import {
  db, getStoreBySlug, searchProducts, getProduct, lookupProducts, listStoreProducts,
  upsertStoreProducts, getPublicMetrics, logAgentRequest, getVariantsForCheckout,
  getScan, getLatestScanForStore, upsertScan, claimScan, supersedeScans, getIndexStats,
} from "../src/infrastructure/database";

const HOODIE = "22222222-2222-4222-8222-222222222201";
const HOODIE_S = "33333333-3333-4333-8333-333333333301";

async function main() {
const store = await getStoreBySlug("demo-store-example");
assert.ok(store, "seed store missing: run npm run db:reset");
assert.ok(store.urls.products_json.endsWith("/s/demo-store-example/products.json"));

const s = await searchProducts({ query: "hoodie", max_minor: 5000 });
assert.equal(s.products[0]?.id, HOODIE);
assert.equal(s.products[0].price_range.min.amount, 4500);

const byVariant = await getProduct(HOODIE_S);
assert.ok(byVariant);
assert.equal(byVariant.id, HOODIE);
assert.deepEqual(byVariant.variants.map((v) => v.title), ["S", "M", "L"]);
assert.equal(byVariant.variants[2].offer.availability, "out_of_stock");
assert.equal((await getProduct(`demo-store-example:${byVariant.seq}`))?.id, HOODIE);

const lk = await lookupProducts([HOODIE, "nope"]);
assert.deepEqual([lk.products.length, lk.not_found], [1, ["nope"]]);

const page = await listStoreProducts(store.id, { limit: 2, page: 1 });
assert.equal(page.products.length, 2);
assert.ok(page.total >= 3);

const [group] = await getVariantsForCheckout([{ variant_id: HOODIE_S, quantity: 2 }]);
assert.ok(group);
assert.equal(group.lines[0].quantity, 2);

const now = new Date().toISOString();
const beanie = (variants: string[]) => ({
  external_id: "smoke-1", url: "https://demo-store.example/product/smoke-beanie/", handle: "smoke-beanie",
  title: "Smoke Test Beanie", description_html: null, description_text: "test", brand: "Northwind",
  product_type: "Hats", category: null, tags: ["beanie"], images: [], options: [], source: "jsonld" as const,
  variants: variants.map((t, i) => ({ external_id: t, title: t, options: { Color: t }, sku: null, gtin: null,
    image_url: null, inventory_quantity: null,
    offer: { price: { amount: 2200 + i * 100, currency: "USD" }, compare_at: null, availability: "in_stock" as const, url: null, checked_at: now } })),
});
const up1 = await upsertStoreProducts(store.id, [beanie(["Red", "Blue"])]);
assert.deepEqual([up1.upserted, up1.failed.length], [1, 0]);
const blueId = (await getProduct(up1.product_ids[0]))?.variants.find((v) => v.title === "Blue")?.id;
await upsertStoreProducts(store.id, [beanie(["Blue"])]); // Red is kept but marked unavailable and sorted last
const b = await getProduct(up1.product_ids[0]);
assert.deepEqual(b?.variants.map((v) => [v.title, v.offer.availability]), [["Blue", "in_stock"], ["Red", "out_of_stock"]]);
assert.equal(b?.variants[0].id, blueId);                 // Blue kept its uuid
const same = await upsertStoreProducts(store.id, [beanie(["Blue"])]);
assert.equal(same.unchanged, 1);                         // unchanged content_hash: write skipped
const clash = await upsertStoreProducts(store.id, [{ ...beanie(["Blue"]), external_id: "other", url: "https://demo-store.example/p/other/" }]);
assert.deepEqual(clash.failed.map((f) => f.error), ["handle_collision"]);
assert.equal((await getStoreBySlug("demo-store-example"))?.product_count, 4);

// scans (DECISIONS §A)
const seedScan = await getScan("55555555-5555-4555-8555-555555555501");
assert.equal(seedScan?.best_method, "api");
assert.equal(seedScan?.probes.length, 3);
const sc = await upsertScan({ store_id: store.id, url: store.base_url });
assert.deepEqual([sc.status, sc.best_method, sc.grade], ["queued", "none", "F"]);
assert.equal((await claimScan(sc.id))?.status, "running");
assert.equal(await claimScan(sc.id), null);              // second claim loses
const done = await upsertScan({ id: sc.id, status: "done", best_method: "dom", score: 60, grade: "C" });
assert.equal(done.best_method, "dom");
assert.equal((await getLatestScanForStore(store.id))?.id, sc.id);
assert.equal(await supersedeScans(store.id, sc.id), 0);
assert.ok((await getIndexStats()).stores >= 1);
assert.equal((await getIndexStats(store.id)).product_count >= 3, true);
await db().from("scans").delete().eq("id", sc.id);

await logAgentRequest({ surface: "rest", tool: "db-smoke", store_id: store.id });
const m = await getPublicMetrics();
assert.ok(m.products >= 4 && m.agent_requests >= 1);

await db().from("products").delete().eq("handle", "smoke-beanie"); // cleanup (product_count refreshes on next upsert)
console.log("db-smoke OK");
}

main().catch((err) => { console.error(err); process.exit(1); });
```

---

## 12. Acceptance checklist (WS1 is done when all pass)

| # | Check | Command | Expected |
|---|---|---|---|
| 1 | Clean install + build | `rm -rf node_modules .next && npm ci && npm run build` | exit 0 |
| 2 | Types | `npm run typecheck` | exit 0 |
| 3 | Unit tests | `npm test` | money, slug, contracts, upsert-row: all pass |
| 4 | Migrations + seed apply | `npm run db:reset` | no errors; ends with seeding `supabase/seed.sql` |
| 5 | Search RPC | `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select * from search_products('hoodie', p_max_minor => 5000);"` | one row, id `22222222-2222-4222-8222-222222222201` |
| 6 | Any-term search | `... -c "select id from search_products('hoodie under 50');"` | the hoodie |
| 7 | Public RPC over REST (publishable key) | `curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/search_products" -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" -H "Content-Type: application/json" -d '{"query_text":"socks"}'` | `[{"id":"22222222-…-202",…,"total_count":1}]` |
| 8 | RLS: private tables hidden from anon | `curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/checkouts?select=id" -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"` and the same for `store_claims`, `orders` | `[]` or a permission error, never rows |
| 9 | RLS: writer RPC locked | `curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/upsert_product_batch" -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" -H "Content-Type: application/json" -d '{"p_store_id":"11111111-1111-4111-8111-111111111111","p_products":[]}'` | permission denied (401/403/404), never 200 |
| 10 | Public reads work | `curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/product_variants?select=title&product_id=eq.22222222-2222-4222-8222-222222222201" -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"` | 3 rows |
| 11 | Realtime publication | `psql … -c "select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1;"` | includes `checkout_events`, `crawl_runs`, `scans`, `stores` |
| 12 | Types generated | `npm run db:types && git diff --stat src/infrastructure/database/types.gen.ts` | real `Database` type containing `product_variants`, `search_products`, `upsert_product_batch` |
| 13 | db helpers end to end | `npm run db:smoke` | `db-smoke OK` |
| 14 | Proxy matcher | run the node snippet at the end of §8 | `PROXY` for UI paths, `skip` for every agent path |
| 15 | Remote applied | `supabase db push` (then `supabase migration list`) | `20260926010000` present both locally and remotely |
| 16 | Env template | `grep -cE '^[A-Z0-9_]+=' .env.example` and compare with spec 00 §4.7 | 42 variable names, every one in the spec 00 §4.7 table is present |
| 17 | Scans public, writes locked | `curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/scans?select=id,grade" -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"` then the same with `-X POST -d '{"store_id":"11111111-1111-4111-8111-111111111111","url":"x"}' -H "Content-Type: application/json"` | GET: the seed scan (`55555555-…-501`, grade `D`); POST: permission error, never 201 |
| 18 | Screenshot bucket | `psql … -c "select id, public from storage.buckets where id = 'scan-screenshots';"`, then upload a PNG with the secret key and `curl -I "$NEXT_PUBLIC_SUPABASE_URL/storage/v1/object/public/scan-screenshots/<path>"` | one row, `public = t`; the public URL returns 200 |

Troubleshooting:
- **`supabase db reset` fails on `extensions.gin_trgm_ops`.** `pg_trgm` is installed in another schema (UNVERIFIED on hosted). Fix it in a follow-up migration with `alter extension pg_trgm set schema extensions;`, never by editing core.
- **`alter publication` fails on hosted.** The table is already published. The DO block guards against this. If it still fails, remove the table from the Realtime UI and re-run in a new migration.
- **Typed `rpc()` rejects `null`.** See §6.3 (`as never` on the args object).

---

## 13. Stretch: embeddings + hybrid search (only after WS1 is green and someone asks)

New migration `20260926023000_ws1_embeddings.sql`:
- `create extension if not exists vector with schema extensions;`
- `alter table public.products add column embedding extensions.vector(512);`
- an HNSW index `using hnsw (embedding extensions.vector_cosine_ops)`;
- `create or replace function public.search_products(...)` with the **same signature**. Cast `query_embedding::extensions.vector(512)` when not null and fuse FTS + vector with RRF (`rrf_k = 50`, research 06 §B). Keep `total_count`.

Embeddings: OpenAI `text-embedding-3-small`, `dimensions: 512`. Embed `title | brand | product_type | tags | first 500 chars of description` per product, skipping rows whose `content_hash` is unchanged. `searchProducts` embeds the query only when `OPENAI_API_KEY` is set. Otherwise behavior is unchanged.
