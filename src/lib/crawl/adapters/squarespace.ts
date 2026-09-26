import "server-only";
import type { Availability, CrawlContext, Offer, PlatformAdapter } from "@/lib/contracts";
import { toMinor } from "@/lib/money";
import { AdapterError } from "../errors";
import { getJson, getText } from "../fetch";
import { finalizeProduct, type DraftProduct, type DraftVariant } from "../normalize";
import { parseSitemap } from "../sitemap";

const MAX_PAGES = 20;
const FALLBACK_COLLECTIONS = ["shop", "store", "products"];
const COLLECTION_RE = /\/([^/]+)\/p\/[^/]+$/;

interface SquarespaceMoney { currency: string; value: string }
interface SquarespaceVariant {
  id: string; sku?: string | null; price?: number | null;
  priceMoney?: SquarespaceMoney | null; salePriceMoney?: SquarespaceMoney | null; onSale?: boolean;
  unlimited?: boolean; qtyInStock?: number | null; attributes?: Record<string, string> | null;
}
interface SquarespaceItem {
  id: string; fullUrl: string; urlId: string; title: string;
  body?: string | null; excerpt?: string | null;
  tags?: string[] | null; categories?: string[] | null; productType?: number | null;
  assetUrl?: string | null; items?: { assetUrl?: string }[] | null;
  variants: SquarespaceVariant[];
}
interface CollectionResponse {
  items?: SquarespaceItem[];
  pagination?: { nextPage?: boolean; nextPageOffset?: number };
  website?: { baseCurrency?: string };
}

const PRODUCT_TYPE_NAMES: Record<number, string> = { 1: "Physical", 2: "Digital", 3: "Service", 4: "Gift Card" };

async function discoverCollections(ctx: CrawlContext): Promise<string[]> {
  const found = new Set<string>();
  const queue = [`${ctx.baseUrl}/sitemap.xml`];
  const seen = new Set<string>();
  let fetched = 0;
  while (queue.length && fetched < 5) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const r = await getText(ctx, url);
    fetched++;
    if (!r.ok) continue;
    const parsed = parseSitemap(r.body);
    if (!parsed) continue;
    queue.push(...parsed.sitemaps.slice(0, 5));
    for (const u of parsed.urls) {
      const m = COLLECTION_RE.exec(new URL(u.loc).pathname);
      if (m) found.add(m[1]);
    }
  }
  return found.size ? [...found] : FALLBACK_COLLECTIONS;
}

// legacy shape (UNVERIFIED): no priceMoney, `price` is already integer cents.
function moneyOf(m: SquarespaceMoney | null | undefined, legacyPrice: number | null | undefined, fallbackCurrency: string | null): { amount: number; currency: string } | null {
  if (m) {
    try {
      return { amount: toMinor(m.value, m.currency), currency: m.currency };
    } catch {
      return null;
    }
  }
  if (typeof legacyPrice === "number" && fallbackCurrency) return { amount: legacyPrice, currency: fallbackCurrency };
  return null;
}

function offerOf(v: SquarespaceVariant, fallbackCurrency: string | null, checkedAt: string): DraftVariant["offer"] {
  const price = v.onSale ? moneyOf(v.salePriceMoney, v.price, fallbackCurrency) : moneyOf(v.priceMoney, v.price, fallbackCurrency);
  const compareAt = v.onSale ? moneyOf(v.priceMoney, null, fallbackCurrency) : null;
  const availability: Availability = v.unlimited || (v.qtyInStock ?? 0) > 0 ? "in_stock" : "out_of_stock";
  return { price, compare_at: compareAt, availability, url: null, checked_at: checkedAt };
}

function mapItem(item: SquarespaceItem, baseUrl: string, fallbackCurrency: string | null, checkedAt: string): DraftProduct {
  const url = new URL(item.fullUrl, baseUrl).href;
  const variants: DraftVariant[] = item.variants.map((v) => ({
    external_id: v.id,
    title: Object.values(v.attributes ?? {}).join(" / "),
    options: v.attributes ?? {},
    sku: v.sku || null,
    gtin: null,
    image_url: null,
    inventory_quantity: v.unlimited ? null : v.qtyInStock ?? null,
    offer: offerOf(v, fallbackCurrency, checkedAt),
  }));
  const images = [
    ...(item.assetUrl ? [{ url: item.assetUrl }] : []),
    ...(item.items ?? []).flatMap((g) => (g.assetUrl ? [{ url: g.assetUrl }] : [])),
  ];
  return {
    external_id: item.id,
    url,
    handle: item.urlId,
    title: item.title,
    description_html: item.body || item.excerpt || null,
    description_text: null,
    brand: null,
    product_type: item.productType != null ? PRODUCT_TYPE_NAMES[item.productType] ?? null : null,
    category: item.categories?.[0] ?? null,
    tags: item.tags ?? [],
    images,
    options: [],
    variants,
    source: "platform_api",
    raw: item,
  };
}

export const squarespace: PlatformAdapter = {
  platform: "squarespace",

  async detect(ctx) {
    const r = await getJson<{ website?: unknown }>(ctx, `${ctx.baseUrl}/?format=json`);
    return r.ok && r.data && "website" in r.data ? 0.95 : 0;
  },

  async *listProducts(ctx, { max }) {
    const collections = await discoverCollections(ctx);
    let emitted = 0;
    let anyCollectionValid = false;
    for (const collection of collections) {
      if (emitted >= max || ctx.signal?.aborted) break;
      let offset: number | undefined;
      for (let page = 0; page < MAX_PAGES && emitted < max; page++) {
        const checkedAt = new Date().toISOString();
        const qs = offset !== undefined ? `&offset=${offset}` : "";
        const r = await getJson<CollectionResponse>(ctx, `${ctx.baseUrl}/${collection}?format=json${qs}`);
        if (!r.ok || !r.data?.items) {
          if (page === 0) break; // not a shop collection; try the next candidate
          ctx.log({ level: "warn", msg: `Squarespace collection ${collection} page ${page} failed (${r.status}); stopping` });
          break;
        }
        if (page === 0) {
          if (!r.data.items.some((i) => i.variants?.length)) break; // not a product collection
          anyCollectionValid = true;
        }
        const currency = r.data.website?.baseCurrency ?? null;
        let invalid = 0;
        for (const item of r.data.items) {
          if (emitted >= max) break;
          if (!item.variants?.length) continue;
          const fp = finalizeProduct(mapItem(item, ctx.baseUrl, currency, checkedAt), { baseUrl: ctx.baseUrl });
          if (!fp.ok) {
            invalid++;
            continue;
          }
          emitted++;
          yield fp.product;
        }
        if (invalid) ctx.log({ level: "warn", msg: `${invalid} products in ${collection} failed validation` });
        if (!r.data.pagination?.nextPage) break;
        offset = r.data.pagination.nextPageOffset;
      }
    }
    if (!anyCollectionValid && emitted === 0) throw new AdapterError("unavailable", "squarespace");
  },

  async fetchOffer(ctx, product, variantExternalId): Promise<Offer> {
    const r = await getJson<{ item?: SquarespaceItem }>(ctx, `${product.url}?format=json`);
    if (!r.ok || !r.data?.item) throw new AdapterError("unavailable", "squarespace", r.status);
    const variant = r.data.item.variants.find((v) => v.id === variantExternalId);
    if (!variant) throw new AdapterError("unavailable", "squarespace", 404);
    const offer = offerOf(variant, null, new Date().toISOString());
    if (!offer.price) throw new AdapterError("unavailable", "squarespace");
    return { ...offer, price: offer.price, url: product.url, checked_at: offer.checked_at! };
  },
};
