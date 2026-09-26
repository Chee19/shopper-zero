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
