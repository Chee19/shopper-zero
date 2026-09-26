import "server-only";
import type { Availability, CrawlContext, Money, Offer, PlatformAdapter } from "@/contracts";
import { rescaleMinor } from "@/shared/money";
import { AdapterError } from "../errors";
import { getJson } from "../fetch";
import { finalizeProduct, type DraftProduct, type DraftVariant } from "../normalize";

const PAGE_SIZE = 100;
const MAX_VARIATIONS_PER_PRODUCT = 30;
const MAX_VARIATION_FETCHES_PER_RUN = 300;

// Store API fields we read; anything malformed is caught by finalizeProduct's schema gate.
interface WooPrices { price?: string; regular_price?: string; currency_code?: string; currency_minor_unit?: number }
interface WooItem {
  id: number; type?: string; name?: string; slug?: string; permalink?: string; sku?: string;
  description?: string; short_description?: string; on_sale?: boolean; prices?: WooPrices;
  is_in_stock?: boolean; stock_availability?: { class?: string }; low_stock_remaining?: number | null;
  images?: { src: string; alt?: string }[]; categories?: { name: string }[]; tags?: { name: string }[];
  brands?: { name: string }[];
  attributes?: { name: string; taxonomy?: string | null; has_variations?: boolean; terms?: { name: string; slug: string }[] }[];
  variations?: { id: number; attributes?: { name: string; value: string }[] }[];
}

export const wooApiBases = (base: string) => [`${base}/wp-json/wc/store/v1`, `${base}/?rest_route=/wc/store/v1`];

export function wooUrl(api: string, path: string, params: Record<string, string | number> = {}): string {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  if (!qs) return `${api}${path}`;
  return `${api}${path}${api.includes("?rest_route=") ? "&" : "?"}${qs}`;
}

export async function resolveWooApi(ctx: CrawlContext): Promise<string | null> {
  for (const api of wooApiBases(ctx.baseUrl)) {
    const r = await getJson<unknown>(ctx, wooUrl(api, "/products", { per_page: 1 }));
    if (r.ok && Array.isArray(r.data)) return api;
  }
  return null;
}

// Woo prices are strings in the store's own minor unit (porterandyork: minor_unit 0, "115" = $115).
function wooMoney(amount: string | undefined, p: WooPrices | undefined): Money | null {
  if (!amount || !p?.currency_code) return null;
  const currency = p.currency_code.toUpperCase();
  try {
    return { amount: rescaleMinor(amount, p.currency_minor_unit ?? 2, currency), currency };
  } catch {
    return null;
  }
}

function availabilityOf(item: WooItem): Availability {
  if (item.stock_availability?.class === "on-backorder") return "preorder";
  return item.is_in_stock ? "in_stock" : "out_of_stock";
}

function offerOf(src: WooItem, checkedAt: string, fallbackUrl?: string): DraftVariant["offer"] {
  const price = wooMoney(src.prices?.price, src.prices);
  const regular = wooMoney(src.prices?.regular_price, src.prices);
  return {
    price,
    compare_at: src.on_sale && price && regular && regular.amount > price.amount ? regular : null,
    availability: availabilityOf(src),
    url: src.permalink ?? fallbackUrl ?? null,
    checked_at: checkedAt,
  };
}

const titleCase = (slug: string) => slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// variant.external_id is always the Store API purchasable id (B9): variation id, or product id for simple products.
function mapWooProduct(item: WooItem, variations: Map<number, WooItem>, checkedAt: string): { draft: DraftProduct; synthesized: number } {
  const attrs = item.attributes ?? [];
  const termName = (attrName: string, slug: string) => {
    const attr = attrs.find((a) => a.name.toLowerCase() === attrName.toLowerCase() || a.taxonomy === attrName);
    return attr?.terms?.find((t) => t.slug === slug)?.name ?? titleCase(slug);
  };
  const listed = item.type === "variable" ? (item.variations ?? []).slice(0, MAX_VARIATIONS_PER_PRODUCT) : [];
  let synthesized = 0;
  const variants: DraftVariant[] = listed.length
    ? listed.map((lv) => {
      const detail = variations.get(lv.id);
      if (!detail) synthesized++;
      const options = Object.fromEntries((lv.attributes ?? []).map((a) => [a.name, a.value ? termName(a.name, a.value) : "Any"]));
      return {
        external_id: String(lv.id),
        title: Object.values(options).join(" / "),
        options,
        sku: detail?.sku || null,
        gtin: null,
        image_url: detail?.images?.[0]?.src ?? item.images?.[0]?.src ?? null,
        inventory_quantity: detail?.low_stock_remaining ?? null,
        // No detail fetched: the parent's price and stock stand in (strategy is then partial).
        offer: offerOf(detail ?? item, checkedAt, item.permalink),
      };
    })
    : [{
      external_id: String(item.id), title: "Default Title", options: {}, sku: item.sku || null, gtin: null,
      image_url: item.images?.[0]?.src ?? null, inventory_quantity: item.low_stock_remaining ?? null,
      offer: offerOf(item, checkedAt),
    }];
  const descriptionHtml = item.description || item.short_description || null;
  return {
    synthesized,
    draft: {
      external_id: String(item.id),
      url: item.permalink ?? "",
      handle: item.slug || null,
      title: item.name ?? "",
      description_html: descriptionHtml,
      description_text: null,
      brand: item.brands?.[0]?.name ?? null,
      product_type: item.categories?.[0]?.name ?? null,
      category: item.categories?.at(-1)?.name ?? null,
      tags: (item.tags ?? []).map((t) => t.name),
      images: (item.images ?? []).map((i) => ({ url: i.src, ...(i.alt ? { alt: i.alt } : {}) })),
      options: attrs.filter((a) => a.has_variations).map((a) => ({ name: a.name, values: (a.terms ?? []).map((t) => t.name) })),
      variants,
      source: "platform_api",
      raw: { ...item, _variations: listed.map((lv) => variations.get(lv.id)).filter(Boolean) },
    },
  };
}

// Batch first (type=variation&include= is UNVERIFIED), then per-id GETs within the run budget.
async function fetchVariations(ctx: CrawlContext, api: string, ids: number[], budget: { left: number }): Promise<Map<number, WooItem>> {
  const out = new Map<number, WooItem>();
  for (let i = 0; i < ids.length; i += PAGE_SIZE) {
    const chunk = ids.slice(i, i + PAGE_SIZE);
    const r = await getJson<WooItem[]>(ctx, wooUrl(api, "/products", { type: "variation", include: chunk.join(","), per_page: PAGE_SIZE }));
    for (const v of Array.isArray(r.data) ? r.data : []) if (chunk.includes(v.id)) out.set(v.id, v);
  }
  const missing = ids.filter((id) => !out.has(id)).slice(0, Math.max(budget.left, 0));
  budget.left -= missing.length;
  await Promise.all(missing.map(async (id) => {
    const r = await getJson<WooItem>(ctx, wooUrl(api, `/products/${id}`));
    if (r.ok && r.data?.id === id) out.set(id, r.data);
  }));
  return out;
}

export const woocommerce: PlatformAdapter = {
  platform: "woocommerce",

  async detect(ctx) {
    return (await resolveWooApi(ctx)) ? 0.95 : 0;
  },

  async *listProducts(ctx, { max }) {
    const api = await resolveWooApi(ctx);
    if (!api) throw new AdapterError("unavailable", "woocommerce");
    const budget = { left: MAX_VARIATION_FETCHES_PER_RUN };
    let page = 1;
    let totalPages = Number.POSITIVE_INFINITY;
    let emitted = 0;
    while (page <= totalPages && emitted < max && !ctx.signal?.aborted) {
      const checkedAt = new Date().toISOString();
      const r = await getJson<WooItem[]>(ctx, wooUrl(api, "/products", { per_page: PAGE_SIZE, page, orderby: "date", order: "desc" }));
      if (!r.ok || !Array.isArray(r.data)) {
        if (page === 1) throw new AdapterError("unavailable", "woocommerce", r.status);
        ctx.log({ level: "warn", msg: `WooCommerce page ${page} failed (${r.status}); stopping` });
        break;
      }
      const header = r.headers.get("x-wp-totalpages");
      totalPages = header ? Number(header) : r.data.length === PAGE_SIZE ? page + 1 : page;
      if (page === 1) {
        const total = Number(r.headers.get("x-wp-total")) || null;
        ctx.log({ level: "info", msg: `WooCommerce Store API${total ? `: ${total} products` : ""}`, data: total ? { total_estimate: Math.min(total, max) } : undefined });
      }
      const ids = r.data.filter((p) => p.type === "variable")
        .flatMap((p) => (p.variations ?? []).slice(0, MAX_VARIATIONS_PER_PRODUCT).map((v) => v.id));
      const variations = await fetchVariations(ctx, api, ids, budget);
      let skippedTypes = 0, invalid = 0, synthesized = 0;
      for (const item of r.data) {
        if (emitted >= max) break;
        if (item.type === "grouped" || item.type === "external") {
          skippedTypes++;
          continue;
        }
        const mapped = mapWooProduct(item, variations, checkedAt);
        const fp = finalizeProduct(mapped.draft, { baseUrl: ctx.baseUrl });
        if (!fp.ok) {
          invalid++;
          continue;
        }
        synthesized += mapped.synthesized;
        emitted++;
        yield fp.product;
      }
      if (skippedTypes) ctx.log({ level: "info", msg: `Skipped ${skippedTypes} grouped/external products on page ${page}` });
      if (invalid) ctx.log({ level: "warn", msg: `${invalid} products on page ${page} failed validation` });
      if (synthesized) ctx.log({ level: "warn", msg: `${synthesized} variations used parent price/stock`, data: { partial: true } });
      page++;
    }
  },

  // verify.ts maps an AdapterError with status 404 to variant_gone.
  async fetchOffer(ctx, product, variantExternalId): Promise<Offer> {
    const api = await resolveWooApi(ctx);
    if (!api) throw new AdapterError("unavailable", "woocommerce");
    const r = await getJson<WooItem>(ctx, wooUrl(api, `/products/${variantExternalId ?? product.external_id}`));
    if (!r.ok || !r.data) throw new AdapterError("unavailable", "woocommerce", r.status);
    const offer = offerOf(r.data, new Date().toISOString(), product.url);
    if (!offer.price) throw new AdapterError("unavailable", "woocommerce", r.status);
    return { ...offer, price: offer.price, checked_at: offer.checked_at! };
  },
};
