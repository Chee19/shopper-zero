// src/lib/db/upsert-row.ts: pure mapping NormalizedProduct -> upsert_product_batch payload row.
import { createHash } from "node:crypto";
import {
  NormalizedProductSchema, type Availability, type NormalizedProduct, type NormalizedVariant,
} from "@/lib/contracts";
import { fromMinor } from "@/lib/money";
import { shortHash, slugify } from "@/lib/slug";

/** One element of the p_products JSON array consumed by public.upsert_product_batch(). */
export interface ProductUpsertRow {
  handle: string;
  url: string;
  external_id: string | null;
  title: string;
  description_text: string | null;
  description_html: string | null;
  brand: string | null;
  product_type: string | null;
  category: string | null;
  tags: string[];
  options: { name: string; values: string[] }[];
  images: string[];
  currency: string;
  price: string;                       // legacy numeric column, decimal string of price_min_minor
  availability: Availability;          // legacy products.availability
  price_min_minor: number;
  price_max_minor: number;
  available: boolean;
  source: string;
  gtin: string | null;
  raw: unknown;
  content_hash: string;
  variants: VariantUpsertRow[];
}
export interface VariantUpsertRow {
  external_id: string;
  title: string;
  options: Record<string, string>;
  sku: string | null;
  gtin: string | null;
  price_minor: number;
  compare_at_minor: number | null;
  currency: string;
  availability: Availability;
  available: boolean;
  inventory_quantity: number | null;
  image_url: string | null;
  url: string | null;
  checked_at: string;
}

const RAW_MAX_BYTES = 100_000;
const isAvailable = (a: Availability) => a === "in_stock" || a === "preorder";

/** Stable per-product variant key: source id > sku > option/title slug > "default". */
export function variantKey(v: NormalizedVariant): string {
  if (v.external_id) return v.external_id;
  if (v.sku) return `sku:${v.sku}`;
  const optionValues = Object.values(v.options);
  // slugify drops non-Latin/symbol characters ("赤 M" and "青 M" both -> "m"), so always add a hash of the raw value.
  const optKey = (x: string) => `opt:${slugify(x) || "x"}-${shortHash(x)}`;
  if (optionValues.length) return optKey(optionValues.join("-"));
  if (v.title && v.title !== "Default Title") return optKey(v.title);
  return "default";
}

export type BuildResult =
  | { ok: true; row: ProductUpsertRow }
  | { ok: false; url: string; reason: string };

/** Validates + maps one product. Never throws. */
export function buildUpsertRow(input: unknown): BuildResult {
  const parsed = NormalizedProductSchema.safeParse(input);
  const url = typeof (input as { url?: unknown })?.url === "string" ? (input as { url: string }).url : "?";
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, url, reason: `invalid: ${issue.path.join(".")} ${issue.message}` };
  }
  const p: NormalizedProduct = parsed.data;
  const currency = p.variants[0].offer.price.currency;
  if (p.variants.some((v) => v.offer.price.currency !== currency)) {
    return { ok: false, url, reason: "mixed_currency" };
  }

  const seen = new Map<string, number>();
  const variants: VariantUpsertRow[] = p.variants.map((v) => {
    const base = variantKey(v);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return {
      external_id: n === 1 ? base : `${base}~${n}`,
      title: v.title,
      options: v.options,
      sku: v.sku,
      gtin: v.gtin,
      price_minor: v.offer.price.amount,
      compare_at_minor: v.offer.compare_at?.amount ?? null,
      currency,
      availability: v.offer.availability,
      available: isAvailable(v.offer.availability),
      inventory_quantity: v.inventory_quantity,
      image_url: v.image_url,
      url: v.offer.url,
      checked_at: v.offer.checked_at,
    };
  });

  const prices = variants.map((v) => v.price_minor);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avs = variants.map((v) => v.availability);
  const availability: Availability = avs.includes("in_stock") ? "in_stock"
    : avs.includes("preorder") ? "preorder"
    : avs.every((a) => a === "out_of_stock") ? "out_of_stock" : "unknown";

  let raw: unknown = p.raw ?? {};
  try {
    if (JSON.stringify(raw).length > RAW_MAX_BYTES) raw = { _truncated: true };
  } catch {
    raw = { _unserializable: true };
  }

  const row: Omit<ProductUpsertRow, "content_hash"> = {
    handle: p.handle.trim(),
    url: p.url,
    external_id: p.external_id,
    title: p.title.trim(),
    description_text: p.description_text?.slice(0, 20_000) ?? null,
    description_html: p.description_html?.slice(0, 50_000) ?? null,
    brand: p.brand,
    product_type: p.product_type,
    category: p.category,
    tags: [...new Set(p.tags.map((t) => t.trim()).filter(Boolean))],
    options: p.options,
    images: [...new Set(p.images.map((i) => i.url))].slice(0, 20),
    currency,
    price: fromMinor(min, currency),
    availability,
    price_min_minor: min,
    price_max_minor: max,
    available: variants.some((v) => v.available),
    source: p.source,
    gtin: p.variants.length === 1 ? p.variants[0].gtin : null,
    raw,
    variants,
  };
  // Hash everything except raw and observation timestamps, so unchanged products hash equal.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted keys
  const { raw: _raw, variants: vs, ...rest } = row;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted keys
  const hashInput = JSON.stringify({ ...rest, variants: vs.map(({ checked_at: _c, ...v }) => v) });
  const content_hash = createHash("sha1").update(hashInput).digest("hex");
  return { ok: true, row: { ...row, content_hash } };
}

/** Makes handles unique within one batch: later duplicates get "-" + 6 hex chars of hash(url). */
export function dedupeHandles(rows: ProductUpsertRow[]): ProductUpsertRow[] {
  const byHandle = new Map<string, string>(); // handle -> url
  return rows.map((r) => {
    const prevUrl = byHandle.get(r.handle);
    if (prevUrl === undefined || prevUrl === r.url) {
      byHandle.set(r.handle, r.url);
      return r;
    }
    const handle = `${r.handle}-${shortHash(r.url).slice(0, 6)}`;
    byHandle.set(handle, r.url);
    return { ...r, handle };
  });
}
