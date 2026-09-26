import "server-only";
import type { Availability, CrawlContext, Offer, PlatformAdapter } from "@/contracts";
import { toMinor } from "@/shared/money";
import { MAGENTO_STORE_CONFIG_QUERY } from "../detect";
import { AdapterError } from "../errors";
import { getJson, getText } from "../fetch";
import { finalizeProduct, type DraftProduct, type DraftVariant } from "../normalize";
import { parseSitemap } from "../sitemap";

const PAGE_SIZE = 50;
const SAFE_PAGE_SIZE = 20;
const MAX_CATEGORY_WALK = 5;
const RETRYABLE_ERROR = /Cannot query field|complexity|depth/i;

interface MagentoMoney { value: number; currency: string }
interface MagentoPriceRange { minimum_price: { final_price: MagentoMoney; regular_price: MagentoMoney } }
interface MagentoConfigurableOption { attribute_code: string; label: string; values: { uid: string; label: string; value_index: number }[] }
interface MagentoVariant {
  attributes: { code: string; label: string; uid: string; value_index: number }[];
  product: { uid: string; sku: string; name: string; stock_status: string; image?: { url: string } | null; price_range: MagentoPriceRange };
}
interface MagentoItem {
  __typename: string; uid: string; sku: string; name: string; url_key: string; url_suffix?: string | null;
  canonical_url?: string | null; stock_status: string;
  description?: { html: string } | null; short_description?: { html: string } | null;
  image?: { url: string; label?: string | null } | null;
  media_gallery?: { url: string; label?: string | null }[] | null;
  categories?: { name: string }[] | null;
  price_range: MagentoPriceRange;
  configurable_options?: MagentoConfigurableOption[] | null;
  variants?: MagentoVariant[] | null;
}
interface ProductsPayload { total_count: number; page_info: { current_page: number; total_pages: number; page_size: number }; items: MagentoItem[] }
interface GraphQlResponse<T> { data?: T; errors?: { message: string }[] }
interface StoreConfigPayload { storeConfig?: { store_code: string; base_currency_code: string; base_url: string; locale: string; product_url_suffix: string | null } }
interface MagentoCategory { uid: string; name: string; product_count: number; children?: MagentoCategory[] }
interface CategoryListPayload { categoryList?: MagentoCategory[] }

const magentoUrl = (base: string, query: string) => `${base}/graphql?query=${encodeURIComponent(query)}`;

const FULL_FIELDS = `__typename uid sku name url_key url_suffix canonical_url stock_status
  description { html } short_description { html }
  image { url label } media_gallery { url label }
  categories { name }
  price_range { minimum_price { final_price { value currency } regular_price { value currency } } }
  ... on ConfigurableProduct {
    configurable_options { attribute_code label values { uid label value_index } }
    variants {
      attributes { code label uid value_index }
      product { uid sku name stock_status image { url }
        price_range { minimum_price { final_price { value currency } regular_price { value currency } } } }
    }
  }`;

const SAFE_FIELDS = `__typename uid sku name url_key stock_status
  description { html }
  image { url }
  price_range { minimum_price { final_price { value currency } regular_price { value currency } } }
  ... on ConfigurableProduct {
    configurable_options { attribute_code label values { uid label value_index } }
    variants {
      attributes { code label uid value_index }
      product { uid sku name stock_status image { url }
        price_range { minimum_price { final_price { value currency } regular_price { value currency } } } }
    }
  }`;

function productsQuery(filter: string, page: number, pageSize: number, safe: boolean): string {
  return `{ products(${filter}, pageSize: ${pageSize}, currentPage: ${page}) {
    total_count
    page_info { current_page total_pages page_size }
    items { ${safe ? SAFE_FIELDS : FULL_FIELDS} }
  } }`;
}

const escapeGql = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

async function fetchStoreConfig(ctx: CrawlContext): Promise<{ currency: string | null; suffix: string }> {
  const r = await getJson<GraphQlResponse<StoreConfigPayload>>(ctx, magentoUrl(ctx.baseUrl, MAGENTO_STORE_CONFIG_QUERY));
  const sc = r.data?.data?.storeConfig;
  return { currency: sc?.base_currency_code ?? null, suffix: sc?.product_url_suffix || ".html" };
}

function productTypeOf(item: MagentoItem): string | null {
  if (item.categories?.[0]?.name) return item.categories[0].name;
  const m = /^([A-Za-z]+)Product$/.exec(item.__typename);
  return m ? m[1] : null;
}

function urlOf(item: MagentoItem, baseUrl: string, suffix: string): string {
  if (item.canonical_url) return new URL(item.canonical_url, `${baseUrl}/`).href;
  return `${baseUrl}/${item.url_key}${item.url_suffix ?? suffix}`;
}

function moneyOf(m: MagentoMoney): { amount: number; currency: string } | null {
  try {
    return { amount: toMinor(m.value, m.currency), currency: m.currency };
  } catch {
    return null;
  }
}

function availabilityOf(status: string): Availability {
  return status === "IN_STOCK" ? "in_stock" : "out_of_stock";
}

function offerOf(priceRange: MagentoPriceRange, stockStatus: string, url: string, checkedAt: string): DraftVariant["offer"] {
  const final = moneyOf(priceRange.minimum_price.final_price);
  const regular = moneyOf(priceRange.minimum_price.regular_price);
  return {
    price: final,
    compare_at: final && regular && regular.amount > final.amount ? regular : null,
    availability: availabilityOf(stockStatus),
    url,
    checked_at: checkedAt,
  };
}

function mapItem(item: MagentoItem, baseUrl: string, suffix: string, checkedAt: string): DraftProduct {
  const url = urlOf(item, baseUrl, suffix);
  const optionLabelByCode = new Map((item.configurable_options ?? []).map((o) => [o.attribute_code, o.label]));
  const variants: DraftVariant[] = item.variants?.length
    ? item.variants.map((v) => {
      const options = Object.fromEntries(v.attributes.map((a) => [optionLabelByCode.get(a.code) ?? a.code, a.label]));
      const title = v.attributes.map((a) => a.label).join(" / ") || v.product.name;
      return {
        external_id: v.product.sku,
        title,
        options,
        sku: v.product.sku,
        gtin: null,
        image_url: v.product.image?.url ?? null,
        inventory_quantity: null,
        offer: offerOf(v.product.price_range, v.product.stock_status, url, checkedAt),
      };
    })
    : [{
      external_id: item.sku,
      title: "Default Title",
      options: {},
      sku: item.sku,
      gtin: null,
      image_url: item.image?.url ?? null,
      inventory_quantity: null,
      offer: offerOf(item.price_range, item.stock_status, url, checkedAt),
    }];
  return {
    external_id: item.sku,
    url,
    handle: item.url_key,
    title: item.name,
    description_html: item.description?.html || item.short_description?.html || null,
    description_text: null,
    brand: null,
    product_type: productTypeOf(item),
    category: item.categories?.at(-1)?.name ?? null,
    tags: [],
    images: (item.media_gallery?.length ? item.media_gallery : item.image ? [item.image] : [])
      .filter((i) => !i.url.includes("/placeholder/"))
      .map((i) => ({ url: i.url, ...(i.label ? { alt: i.label } : {}) })),
    options: (item.configurable_options ?? []).map((o) => ({ name: o.label, values: o.values.map((v) => v.label) })),
    variants,
    source: "platform_api",
    raw: item,
  };
}

// R12: probe the first mapped PDP URL; a 404 means EDS routes PDPs differently, so remap via the product sitemap.
async function buildUrlKeyMap(ctx: CrawlContext): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const queue = [`${ctx.baseUrl}/sitemap.xml`, `${ctx.baseUrl}/sitemap_index.xml`];
  const seen = new Set<string>();
  let fetched = 0;
  while (queue.length && fetched < 15) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const r = await getText(ctx, url);
    fetched++;
    if (!r.ok) continue;
    const parsed = parseSitemap(r.body);
    if (!parsed) continue;
    queue.push(...parsed.sitemaps.slice(0, 10));
    for (const u of parsed.urls) map.set(u.loc, u.loc);
  }
  return map;
}

function resolveEdsUrl(url: string, urlKey: string, sitemapUrls: Map<string, string> | null): string {
  if (!sitemapUrls) return url;
  for (const loc of sitemapUrls.values()) if (loc.includes(urlKey)) return loc;
  return url;
}

async function* categoryWalk(
  ctx: CrawlContext,
  baseUrl: string,
  suffix: string,
  max: number,
  seenSkus: Set<string>,
  emittedRef: { count: number },
  urlKeyMap: { value: Map<string, string> | null; checked: boolean },
): AsyncGenerator<import("@/contracts").NormalizedProduct> {
  const r = await getJson<GraphQlResponse<CategoryListPayload>>(ctx, magentoUrl(baseUrl, "{ categoryList { uid name product_count children { uid name product_count } } }"));
  const roots = r.data?.data?.categoryList ?? [];
  const flat: MagentoCategory[] = [];
  for (const c of roots) {
    flat.push(c);
    flat.push(...(c.children ?? []));
  }
  const top = flat.filter((c) => c.product_count > 0).sort((a, b) => b.product_count - a.product_count).slice(0, MAX_CATEGORY_WALK);
  for (const cat of top) {
    if (emittedRef.count >= max) return;
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages && emittedRef.count < max && !ctx.signal?.aborted) {
      const filter = `filter: { category_uid: { in: ["${escapeGql(cat.uid)}"] } }`;
      const pr = await getJson<GraphQlResponse<{ products?: ProductsPayload }>>(ctx, magentoUrl(baseUrl, productsQuery(filter, page, PAGE_SIZE, false)));
      const payload = pr.data?.data?.products;
      if (!pr.ok || !payload || !payload.items.length) break;
      totalPages = payload.page_info.total_pages;
      const checkedAt = new Date().toISOString();
      for (const item of payload.items) {
        if (emittedRef.count >= max) return;
        if (seenSkus.has(item.sku)) continue;
        seenSkus.add(item.sku);
        const draft = mapItem(item, baseUrl, suffix, checkedAt);
        if (!urlKeyMap.checked) {
          urlKeyMap.checked = true;
          const check = await getText(ctx, draft.url);
          if (check.status === 404) {
            urlKeyMap.value = await buildUrlKeyMap(ctx);
            ctx.log({ level: "warn", msg: "Magento PDP URLs 404d; remapped via sitemap url_key" });
          }
        }
        if (urlKeyMap.value) draft.url = resolveEdsUrl(draft.url, item.url_key, urlKeyMap.value);
        const fp = finalizeProduct(draft, { baseUrl });
        if (fp.ok) {
          emittedRef.count++;
          yield fp.product;
        }
      }
      page++;
    }
  }
}

export const magento: PlatformAdapter = {
  platform: "magento",

  async detect(ctx) {
    const r = await getJson<GraphQlResponse<StoreConfigPayload>>(ctx, magentoUrl(ctx.baseUrl, MAGENTO_STORE_CONFIG_QUERY));
    return r.ok && typeof r.data?.data?.storeConfig?.store_code === "string" ? 0.95 : 0;
  },

  async *listProducts(ctx, { max }) {
    const { suffix } = await fetchStoreConfig(ctx);
    const seenSkus = new Set<string>();
    const emittedRef = { count: 0 };
    const urlKeyMap: { value: Map<string, string> | null; checked: boolean } = { value: null, checked: false };
    let page = 1;
    let totalPages = 1;
    let safe = false;
    let firstPageSucceeded = false;

    while (page <= totalPages && emittedRef.count < max && !ctx.signal?.aborted) {
      const r = await getJson<GraphQlResponse<{ products?: ProductsPayload }>>(
        ctx, magentoUrl(ctx.baseUrl, productsQuery(`search: ""`, page, safe ? SAFE_PAGE_SIZE : PAGE_SIZE, safe)),
      );
      if (r.blocked === "challenge" || r.blocked === "forbidden" || r.status === 403) {
        throw new AdapterError("unavailable", "magento", r.status || 403);
      }
      if (!r.ok || !r.data) {
        if (page === 1 && !firstPageSucceeded) throw new AdapterError("unavailable", "magento", r.status);
        ctx.log({ level: "warn", msg: `Magento page ${page} failed (${r.status}); stopping` });
        break;
      }
      const errorMsg = r.data.errors?.map((e) => e.message).join(" ") ?? "";
      if (r.data.errors?.length && RETRYABLE_ERROR.test(errorMsg) && !safe) {
        safe = true;
        continue; // retry the same page with the safe field set
      }
      const payload = r.data.data?.products;
      if (!payload || payload.total_count === 0) {
        if (page === 1 && !firstPageSucceeded) {
          ctx.log({ level: "info", msg: "Magento empty search; walking categories" });
          yield* categoryWalk(ctx, ctx.baseUrl, suffix, max, seenSkus, emittedRef, urlKeyMap);
        }
        break;
      }
      firstPageSucceeded = true;
      totalPages = payload.page_info.total_pages;
      if (!payload.items.length) break;
      const checkedAt = new Date().toISOString();
      let invalid = 0;
      for (const item of payload.items) {
        if (emittedRef.count >= max) break;
        if (seenSkus.has(item.sku)) continue;
        seenSkus.add(item.sku);
        const draft = mapItem(item, ctx.baseUrl, suffix, checkedAt);
        if (!urlKeyMap.checked) {
          urlKeyMap.checked = true;
          const check = await getText(ctx, draft.url);
          if (check.status === 404) {
            urlKeyMap.value = await buildUrlKeyMap(ctx);
            ctx.log({ level: "warn", msg: "Magento PDP URLs 404d; remapped via sitemap url_key" });
          }
        }
        if (urlKeyMap.value) draft.url = resolveEdsUrl(draft.url, item.url_key, urlKeyMap.value);
        const fp = finalizeProduct(draft, { baseUrl: ctx.baseUrl });
        if (!fp.ok) {
          invalid++;
          continue;
        }
        emittedRef.count++;
        yield fp.product;
      }
      if (invalid) ctx.log({ level: "warn", msg: `${invalid} products on page ${page} failed validation` });
      page++;
    }
  },

  async fetchOffer(ctx, product, variantExternalId): Promise<Offer> {
    const wanted = variantExternalId ?? product.external_id;
    const urlKey = new URL(product.url).pathname.replace(/^\/+/, "").split("/").pop()?.replace(/\.[a-z0-9]+$/i, "") ?? "";
    let items: MagentoItem[] = [];
    if (urlKey) {
      const r = await getJson<GraphQlResponse<{ products?: ProductsPayload }>>(
        ctx, magentoUrl(ctx.baseUrl, productsQuery(`filter: { url_key: { eq: "${escapeGql(urlKey)}" } }`, 1, 1, false)),
      );
      items = r.data?.data?.products?.items ?? [];
    }
    if (!items.length && wanted) {
      const r = await getJson<GraphQlResponse<{ products?: ProductsPayload }>>(
        ctx, magentoUrl(ctx.baseUrl, productsQuery(`search: "${escapeGql(wanted)}"`, 1, 5, false)),
      );
      items = r.data?.data?.products?.items ?? [];
    }
    for (const item of items) {
      if (item.sku === wanted) {
        const offer = offerOf(item.price_range, item.stock_status, product.url, new Date().toISOString());
        if (offer.price) return { ...offer, price: offer.price, checked_at: offer.checked_at! };
      }
      for (const v of item.variants ?? []) {
        if (v.product.sku === wanted) {
          const offer = offerOf(v.product.price_range, v.product.stock_status, product.url, new Date().toISOString());
          if (offer.price) return { ...offer, price: offer.price, checked_at: offer.checked_at! };
        }
      }
    }
    throw new AdapterError("unavailable", "magento", 404);
  },
};
