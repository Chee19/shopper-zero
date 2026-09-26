import "server-only";
import * as cheerio from "cheerio";
import { NormalizedProductSchema, type Money, type NormalizedProduct, type NormalizedVariant } from "@/lib/contracts";
import { variantKey } from "@/lib/db/upsert-row";
import { handleFromUrl, slugify } from "@/lib/slug";
import { canonicalizeProductUrl } from "./url";

export type DraftVariant = Omit<NormalizedVariant, "offer"> & {
  offer: Omit<NormalizedVariant["offer"], "checked_at" | "price"> & { price: Money | null; checked_at?: string };
};
export type DraftProduct = Omit<NormalizedProduct, "handle" | "variants"> & {
  handle?: string | null;
  variants: DraftVariant[];
};

export function decodeEntities(s: string): string {
  return cheerio.load(s, null, false).root().text();
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const space = head.lastIndexOf(" ");
  return space > max * 0.8 ? head.slice(0, space) : head;
}

export function htmlToText(html: string, max = 5000): string {
  const stripped = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
  return cut(collapse(decodeEntities(stripped)), max);
}

function absUrl(u: string | null | undefined, base: string): string | null {
  if (!u || !URL.canParse(u, base)) return null;
  const abs = new URL(u, base);
  return abs.protocol === "https:" || abs.protocol === "http:" ? abs.href : null;
}

const PLACEHOLDER_IMG = /placeholder|no-image|noimage/i;
const validMoney = (m: { amount: number; currency: string } | null | undefined) =>
  !!m && Number.isSafeInteger(m.amount) && m.amount >= 0 && /^[A-Z]{3}$/.test(m.currency);
const opt = (s: string | null | undefined, max: number) => (s ? s.slice(0, max) : null);

// The one gate for every tier's output: returns a product that passes NormalizedProductSchema, or a reason.
export function finalizeProduct(
  draft: DraftProduct,
  ctx: { baseUrl: string },
): { ok: true; product: NormalizedProduct } | { ok: false; reason: string } {
  const title = collapse(decodeEntities(draft.title ?? "")).slice(0, 300);
  if (!title) return { ok: false, reason: "no_title" };
  const url = absUrl(draft.url, ctx.baseUrl);
  if (!url) return { ok: false, reason: "bad_url" };
  const canonical = canonicalizeProductUrl(url, ctx.baseUrl);
  const handle = slugify(draft.handle ?? "", 255) || handleFromUrl(canonical);

  const now = new Date().toISOString();
  const seen = new Set<string>();
  const variants: NormalizedVariant[] = [];
  for (const v of draft.variants) {
    if (!validMoney(v.offer.price)) continue;
    const options = Object.fromEntries(
      Object.entries(v.options).filter(([k, val]) => k && val).map(([k, val]) => [k.slice(0, 255), String(val).slice(0, 255)]),
    );
    const variant: NormalizedVariant = {
      external_id: opt(v.external_id, 255),
      title: (collapse(v.title ?? "") || Object.values(options).join(" / ") || "Default Title").slice(0, 500),
      options,
      sku: opt(v.sku, 255),
      gtin: opt(v.gtin, 64),
      image_url: absUrl(v.image_url, canonical),
      inventory_quantity: Number.isSafeInteger(v.inventory_quantity) ? v.inventory_quantity : null,
      offer: {
        price: v.offer.price!,
        compare_at: validMoney(v.offer.compare_at) && v.offer.compare_at!.currency === v.offer.price!.currency ? v.offer.compare_at : null,
        availability: v.offer.availability,
        url: absUrl(v.offer.url, canonical),
        checked_at: v.offer.checked_at ?? now,
      },
    };
    const key = variantKey(variant);
    if (seen.has(key)) continue;
    seen.add(key);
    variants.push(variant);
    if (variants.length === 250) break;
  }
  if (!variants.length) return { ok: false, reason: "no_price" };

  const images = [...new Map(
    draft.images.flatMap((img) => {
      const u = absUrl(img.url, canonical);
      return u && !PLACEHOLDER_IMG.test(u) ? [[u, { url: u, ...(img.alt ? { alt: img.alt } : {}) }] as const] : [];
    }),
  ).values()].slice(0, 12);

  let options = draft.options.filter((o) => o.name).slice(0, 10);
  if (!options.length) {
    const byName = new Map<string, string[]>();
    for (const v of variants) {
      for (const [name, value] of Object.entries(v.options)) {
        const values = byName.get(name) ?? byName.set(name, []).get(name)!;
        if (!values.includes(value)) values.push(value);
      }
    }
    options = [...byName].slice(0, 10).map(([name, values]) => ({ name, values }));
  }

  const descText = draft.description_text ?? (draft.description_html ? htmlToText(draft.description_html) : null);
  const parsed = NormalizedProductSchema.safeParse({
    external_id: opt(draft.external_id, 255),
    url: canonical,
    handle,
    title,
    description_html: draft.description_html || null,
    description_text: descText ? cut(collapse(descText), 5000) || null : null,
    brand: opt(draft.brand && collapse(decodeEntities(draft.brand)), 255),
    product_type: opt(draft.product_type && collapse(decodeEntities(draft.product_type)), 255),
    category: opt(draft.category && collapse(decodeEntities(draft.category)), 500),
    tags: [...new Set(draft.tags.map((t) => collapse(decodeEntities(t)).slice(0, 100)).filter(Boolean))].slice(0, 30),
    images,
    options,
    variants,
    source: draft.source,
    raw: draft.raw,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: `invalid: ${issue.path.join(".")} ${issue.message}` };
  }
  return { ok: true, product: parsed.data };
}

export function modeCurrency(products: NormalizedProduct[]): string | null {
  const counts = new Map<string, number>();
  for (const p of products) {
    const c = p.variants[0]?.offer.price.currency;
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
