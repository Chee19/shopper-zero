import "server-only";
import type { Availability, CrawlContext, Offer, PlatformAdapter } from "@/contracts";
import { toMinor } from "@/shared/money";
import { AdapterError } from "../errors";
import { getJson } from "../fetch";
import { finalizeProduct, type DraftProduct, type DraftVariant } from "../normalize";

const PAGE_SIZE = 250;
const MAX_PAGES = 20;
const CURRENCY_HTML_RE = /Shopify\.currency\s*=\s*\{"active":"([A-Z]{3})"/;

interface ShopifyVariant {
  id: number; title: string; sku?: string | null; price: string; compare_at_price?: string | null;
  available?: boolean; featured_image?: { src: string } | null;
  option1?: string | null; option2?: string | null; option3?: string | null;
}
interface ShopifyProduct {
  id: number; title: string; handle: string; body_html?: string | null; vendor?: string | null;
  product_type?: string | null; tags?: string[] | string;
  images?: { src: string; alt?: string | null }[];
  options?: { name: string; values: string[] }[];
  variants: ShopifyVariant[];
}
interface ProductsResponse { products: ShopifyProduct[] }

async function resolveCurrency(ctx: CrawlContext): Promise<string | null> {
  const fromHomepage = CURRENCY_HTML_RE.exec(ctx.homepageHtml)?.[1];
  if (fromHomepage) return fromHomepage;
  const cart = await getJson<{ currency?: string }>(ctx, `${ctx.baseUrl}/cart.js`);
  if (cart.ok && cart.data?.currency && /^[A-Z]{3}$/.test(cart.data.currency)) return cart.data.currency;
  const meta = /itemprop=["']priceCurrency["']\s+content=["']([A-Z]{3})["']/i.exec(ctx.homepageHtml)?.[1];
  return meta ?? null;
}

const tagsOf = (t: ShopifyProduct["tags"]): string[] =>
  Array.isArray(t) ? t : typeof t === "string" ? t.split(",").map((s) => s.trim()).filter(Boolean) : [];

function offerOf(v: ShopifyVariant, currency: string, productUrl: string, checkedAt: string): DraftVariant["offer"] {
  const price = toMinor(v.price, currency);
  const compareAt = v.compare_at_price ? toMinor(v.compare_at_price, currency) : null;
  const availability: Availability = v.available ? "in_stock" : "out_of_stock";
  return {
    price: { amount: price, currency },
    compare_at: compareAt !== null && compareAt > price ? { amount: compareAt, currency } : null,
    availability,
    url: `${productUrl}?variant=${v.id}`,
    checked_at: checkedAt,
  };
}

function mapProduct(p: ShopifyProduct, currency: string, baseUrl: string, checkedAt: string): DraftProduct {
  const url = `${baseUrl}/products/${p.handle}`;
  const options = p.options ?? [];
  const variants: DraftVariant[] = p.variants.map((v) => {
    const optValues: [string, string][] = [];
    options.forEach((o, i) => {
      const val = (v as unknown as Record<string, string | null | undefined>)[`option${i + 1}`];
      if (val) optValues.push([o.name, val]);
    });
    return {
      external_id: String(v.id),
      title: v.title,
      options: Object.fromEntries(optValues),
      sku: v.sku || null,
      gtin: null,
      image_url: v.featured_image?.src ?? null,
      inventory_quantity: null,
      offer: offerOf(v, currency, url, checkedAt),
    };
  });
  return {
    external_id: String(p.id),
    url,
    handle: p.handle,
    title: p.title,
    description_html: p.body_html || null,
    description_text: null,
    brand: p.vendor || null,
    product_type: p.product_type || null,
    category: null,
    tags: tagsOf(p.tags),
    images: (p.images ?? []).map((i) => ({ url: i.src, ...(i.alt ? { alt: i.alt } : {}) })),
    options: options.map((o) => ({ name: o.name, values: o.values })),
    variants,
    source: "platform_api",
    raw: p,
  };
}

export const shopify: PlatformAdapter = {
  platform: "shopify",

  async detect(ctx) {
    const r = await getJson<ProductsResponse>(ctx, `${ctx.baseUrl}/products.json?limit=1`);
    return r.ok && Array.isArray(r.data?.products) ? 0.95 : 0;
  },

  async *listProducts(ctx, { max }) {
    const currency = await resolveCurrency(ctx);
    if (!currency) throw new AdapterError("no_currency", "shopify");
    let emitted = 0;
    for (let page = 1; page <= MAX_PAGES && emitted < max && !ctx.signal?.aborted; page++) {
      const checkedAt = new Date().toISOString();
      const r = await getJson<ProductsResponse>(ctx, `${ctx.baseUrl}/products.json?limit=${PAGE_SIZE}&page=${page}`);
      if (!r.ok || !Array.isArray(r.data?.products)) {
        if (page === 1) throw new AdapterError("unavailable", "shopify", r.status);
        ctx.log({ level: "warn", msg: `Shopify page ${page} failed (${r.status}); stopping` });
        break;
      }
      if (!r.data.products.length) break;
      let invalid = 0;
      for (const p of r.data.products) {
        if (emitted >= max) break;
        const fp = finalizeProduct(mapProduct(p, currency, ctx.baseUrl, checkedAt), { baseUrl: ctx.baseUrl });
        if (!fp.ok) {
          invalid++;
          continue;
        }
        emitted++;
        yield fp.product;
      }
      if (invalid) ctx.log({ level: "warn", msg: `${invalid} products on page ${page} failed validation` });
    }
  },

  async fetchOffer(ctx, product, variantExternalId): Promise<Offer> {
    const currency = await resolveCurrency(ctx);
    if (!currency) throw new AdapterError("no_currency", "shopify");
    const r = await getJson<{ variants: (ShopifyVariant & { price: number })[] }>(ctx, `${product.url}.js`);
    if (!r.ok || !r.data) throw new AdapterError("unavailable", "shopify", r.status);
    const wanted = variantExternalId ?? product.external_id;
    const v = r.data.variants.find((x) => String(x.id) === wanted);
    if (!v) throw new AdapterError("unavailable", "shopify", 404);
    // product.js exposes prices as integer cents already, unlike products.json's decimal strings.
    const price = v.price;
    const compareAt = typeof v.compare_at_price === "number" ? v.compare_at_price : null;
    return {
      price: { amount: price, currency },
      compare_at: compareAt !== null && compareAt > price ? { amount: compareAt, currency } : null,
      availability: v.available ? "in_stock" : "out_of_stock",
      url: `${product.url}?variant=${v.id}`,
      checked_at: new Date().toISOString(),
    };
  },
};
