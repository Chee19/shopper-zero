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
