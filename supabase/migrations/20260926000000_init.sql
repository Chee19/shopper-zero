-- Initial schema: the store/product index that agents read from.
-- Writes happen server-side via the service-role client; reads are public.

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  name text,
  platform text,                -- detected platform: woocommerce, magento, bigcommerce, custom, ...
  currency text,
  checkout_methods text[] not null default '{}',  -- e.g. {stripe, x402, native}
  status text not null default 'pending',         -- pending | crawling | indexed | failed
  last_crawled_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  external_id text,             -- product id / sku on the source store
  url text not null,
  title text not null,
  description text,
  brand text,
  price numeric(12, 2),
  currency text,
  availability text,            -- in_stock | out_of_stock | preorder | unknown
  images text[] not null default '{}',
  variants jsonb not null default '[]',
  raw jsonb not null default '{}',   -- source payload (JSON-LD, feed row, etc.)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, url)
);

create index products_store_id_idx on public.products (store_id);
create index products_search_idx on public.products
  using gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(brand, '')));

create table public.crawl_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  status text not null default 'queued',  -- queued | running | succeeded | failed
  strategy text,                          -- sitemap | json-ld | platform-api | feed | ...
  products_found integer not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index crawl_runs_store_id_idx on public.crawl_runs (store_id);

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger stores_updated_at before update on public.stores
  for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

alter table public.stores enable row level security;
alter table public.products enable row level security;
alter table public.crawl_runs enable row level security;

create policy "stores are publicly readable" on public.stores for select using (true);
create policy "products are publicly readable" on public.products for select using (true);
create policy "crawl runs are publicly readable" on public.crawl_runs for select using (true);
