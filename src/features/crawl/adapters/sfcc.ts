import "server-only";
import type { Availability, CrawlContext, Offer, PlatformAdapter } from "@/contracts";
import { toMinor } from "@/shared/money";
import { AdapterError } from "../errors";
import { getJson, getText } from "../fetch";
import { finalizeProduct, type DraftProduct, type DraftVariant } from "../normalize";
import { parseSitemap } from "../sitemap";

// Same shape detect.ts uses to spot an SFCC controller path in the homepage HTML.
const SFCC_SITE = /\/on\/demandware\.store\/(Sites-[A-Za-z0-9_-]+-Site)\/([A-Za-z]{2}(?:_[A-Za-z]{2})?|default)\//;
const PRODUCT_ID = /\/([A-Za-z0-9_\-.]+)\.html(?:$|\?)/;
const MAX_SITEMAPS = 30;
const SAMPLE_SIZE = 5;
const MISS_THRESHOLD = 3;

interface SfccPriceValue { value: number; currency: string }
interface SfccPrice { sales?: SfccPriceValue | null; list?: SfccPriceValue | null; min?: { sales?: SfccPriceValue | null } | null }
interface SfccImage { url: string; alt?: string | null }
interface SfccVariationAttrValue { value: string; displayValue: string; selected?: boolean }
interface SfccVariationAttr { attributeId: string; displayName: string; values: SfccVariationAttrValue[] }
interface SfccProduct {
  id: string; masterid?: string | null; productName: string;
  longDescription?: string | null; shortDescription?: string | null; brand?: string | null;
  images?: { large?: SfccImage[]; small?: SfccImage[] } | null;
  variationAttributes?: SfccVariationAttr[] | null;
  price?: SfccPrice | null;
  available?: boolean; readyToOrder?: boolean;
}
interface VariationResponse { product?: SfccProduct }

interface SiteContext { origin: string; siteId: string; locale: string }

function siteContextOf(ctx: CrawlContext): SiteContext | null {
  const m = SFCC_SITE.exec(ctx.homepageHtml);
  if (!m) return null;
  return { origin: new URL(ctx.baseUrl).origin, siteId: m[1], locale: m[2] };
}

const controllerBase = (site: SiteContext) => `${site.origin}/on/demandware.store/${site.siteId}/${site.locale}`;

async function discoverProductUrls(ctx: CrawlContext, max: number): Promise<string[]> {
  const roots = [`${ctx.baseUrl}/sitemap_index.xml`, `${ctx.baseUrl}/sitemap.xml`, `${ctx.baseUrl}/sitemap_0.xml`];
  const queue = [...roots];
  const seen = new Set<string>();
  const urls = new Set<string>();
  let fetched = 0;
  while (queue.length && fetched < MAX_SITEMAPS && urls.size < max * 4) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const r = await getText(ctx, url);
    fetched++;
    if (!r.ok) continue;
    const parsed = parseSitemap(r.body);
    if (!parsed) continue;
    const productSitemaps = parsed.sitemaps.filter((u) => /product/i.test(u));
    queue.unshift(...productSitemaps);
    if (!productSitemaps.length) queue.push(...parsed.sitemaps.slice(0, 5));
    for (const u of parsed.urls) if (PRODUCT_ID.test(u.loc)) urls.add(u.loc);
  }
  return [...urls];
}

function moneyOf(v: SfccPriceValue | null | undefined): { amount: number; currency: string } | null {
  if (!v) return null;
  try {
    return { amount: toMinor(v.value, v.currency), currency: v.currency };
  } catch {
    return null;
  }
}

function availabilityOf(p: SfccProduct): Availability {
  if (p.available && p.readyToOrder) return "in_stock";
  if (p.available && !p.readyToOrder) return "in_stock";
  return "out_of_stock";
}

function offerOf(p: SfccProduct, url: string, checkedAt: string): DraftVariant["offer"] {
  const price = moneyOf(p.price?.sales) ?? moneyOf(p.price?.min?.sales);
  const compareAt = moneyOf(p.price?.list ?? null);
  return { price, compare_at: compareAt, availability: availabilityOf(p), url, checked_at: checkedAt };
}

function mapProduct(p: SfccProduct, pdpUrl: string, checkedAt: string): DraftProduct {
  const selected = Object.fromEntries(
    (p.variationAttributes ?? []).flatMap((a) => {
      const v = a.values.find((x) => x.selected);
      return v ? [[a.displayName, v.displayValue]] : [];
    }),
  );
  const images = [...(p.images?.large ?? p.images?.small ?? [])].map((i) => ({ url: i.url, ...(i.alt ? { alt: i.alt } : {}) }));
  const variant: DraftVariant = {
    external_id: p.id,
    title: Object.values(selected).join(" / ") || p.productName,
    options: selected,
    sku: null,
    gtin: null,
    image_url: images[0]?.url ?? null,
    inventory_quantity: null,
    offer: offerOf(p, pdpUrl, checkedAt),
  };
  return {
    // live shape uses lowercase "masterid" (spec's masterId was UNVERIFIED and doesn't exist).
    external_id: p.masterid ?? p.id,
    url: pdpUrl,
    handle: null,
    title: p.productName,
    description_html: p.longDescription || p.shortDescription || null,
    description_text: null,
    brand: p.brand ?? null,
    product_type: null,
    category: null,
    tags: [],
    images,
    options: (p.variationAttributes ?? []).map((a) => ({ name: a.displayName, values: a.values.map((v) => v.displayValue) })),
    variants: [variant],
    source: "platform_api",
    raw: p,
  };
}

export const sfcc: PlatformAdapter = {
  platform: "sfcc",

  async detect(ctx) {
    return siteContextOf(ctx) ? 0.95 : 0;
  },

  async *listProducts(ctx, { max }) {
    const site = siteContextOf(ctx);
    if (!site) throw new AdapterError("unavailable", "sfcc");
    const cb = controllerBase(site);
    const urls = await discoverProductUrls(ctx, max);
    if (!urls.length) throw new AdapterError("unavailable", "sfcc");

    let emitted = 0;
    let checked = 0;
    let misses = 0;
    for (const url of urls) {
      if (emitted >= max || ctx.signal?.aborted) break;
      const pid = PRODUCT_ID.exec(url)?.[1];
      if (!pid) continue;
      checked++;
      const checkedAt = new Date().toISOString();
      const r = await getJson<VariationResponse>(ctx, `${cb}/Product-Variation?pid=${encodeURIComponent(pid)}&quantity=1`);
      const product = r.data?.product;
      if (!r.ok || !product?.productName) {
        misses++;
        // "first page" for SFCC is the first sample of 5: bail out only if nothing has landed yet.
        if (checked === SAMPLE_SIZE && misses >= MISS_THRESHOLD && emitted === 0) {
          throw new AdapterError("unavailable", "sfcc", r.status);
        }
        continue;
      }
      const fp = finalizeProduct(mapProduct(product, url, checkedAt), { baseUrl: ctx.baseUrl });
      if (fp.ok) {
        emitted++;
        yield fp.product;
      }
    }
  },

  async fetchOffer(ctx, product, variantExternalId): Promise<Offer> {
    const site = siteContextOf(ctx);
    if (!site) throw new AdapterError("unavailable", "sfcc");
    const cb = controllerBase(site);
    const pid = variantExternalId ?? product.external_id;
    const r = await getJson<VariationResponse>(ctx, `${cb}/Product-Variation?pid=${encodeURIComponent(pid ?? "")}&quantity=1`);
    const p = r.data?.product;
    if (!r.ok || !p?.productName) throw new AdapterError("unavailable", "sfcc", r.status || 404);
    const offer = offerOf(p, product.url, new Date().toISOString());
    if (!offer.price) throw new AdapterError("unavailable", "sfcc");
    return { ...offer, price: offer.price, checked_at: offer.checked_at! };
  },
};
