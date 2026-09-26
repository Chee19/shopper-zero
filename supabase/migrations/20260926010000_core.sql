-- 20260926010000_core.sql
-- ShoperZero core schema. Extends 20260926000000_init.sql (does not replace it).
-- ADD-ONLY RULE: once pushed, never edit this file. Later changes go in
-- 2026092602xxxx_<stream>_<what>.sql files.
--
-- Enumerated values are enforced with NAMED CHECK constraints (not Postgres enum
-- types). The TypeScript unions in src/lib/contracts are the source of truth; to
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
-- (src/lib/contracts/scan.ts). Public read + Realtime: /scan/{id} follows it live.
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
  total_minor bigint,                                    -- frozen once state = awaiting_payment (x402 price source)
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
  data jsonb not null default '{}'::jsonb,               -- {payment_intent, tx_hash, merchant_order_id, ...}; NO PII
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
  rail text not null,                                    -- stripe_spt | x402
  payment_reference text,                                -- pi_... | 0x tx hash
  payer text,                                            -- wallet address (x402)
  amount_minor bigint not null,
  currency text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_checkout_id_key unique (checkout_id), -- one order per checkout = idempotency
  constraint orders_status_check check (status in ('placed', 'confirmed', 'failed', 'refunded')),
  constraint orders_rail_check check (rail in ('stripe_spt', 'x402'))
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
-- 10. RPC: upsert_product_batch  (service role only; called by src/lib/db)
-- p_products: ProductUpsertRow[] as built by src/lib/db/upsert-row.ts (§6.4).
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
