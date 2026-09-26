// src/lib/formats/acp.ts  (WS3; pure)
// ACP / OpenAI product feed rows: one per variant (spec 03 §6.3). Unknown values are omitted,
// never emitted as null, "" or "null".
import type { Availability, IndexedProduct, Store } from "@/contracts";
import { acpPrice } from "@/shared/money";
import { plainDescription, truncate } from "@/features/catalog/formats/text";

export type AcpAvailability = "in_stock" | "out_of_stock" | "pre_order" | "backorder" | "unknown";
export type AcpRow = Record<string, string | boolean | string[] | Record<string, string>>;

const AVAILABILITY: Record<Availability, AcpAvailability> = {
  in_stock: "in_stock",
  out_of_stock: "out_of_stock",
  preorder: "pre_order",
  unknown: "unknown",
};

const GTIN = /^\d{8}$|^\d{12,14}$/;

const optionValue = (options: Record<string, string>, re: RegExp) => {
  const key = Object.keys(options).find((k) => re.test(k));
  return key ? options[key] : undefined;
};

/** Drops keys whose value is unknown (undefined, null, "", empty array/object). Keeps insertion order. */
function compact(row: Record<string, unknown>): AcpRow {
  const out: AcpRow = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || v === null || v === "" || v === "null") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0) continue;
    out[k] = v as AcpRow[string];
  }
  return out;
}

export function toAcpRows(
  products: IndexedProduct[],
  store: Pick<Store, "name" | "domain" | "base_url">,
): { rows: AcpRow[]; skipped: number } {
  const rows: AcpRow[] = [];
  let skipped = 0;
  const seller = store.name ?? store.domain;
  for (const p of products) {
    const multi = p.variants.length > 1;
    const description = truncate(plainDescription(p) || p.title, 5000);
    const variants = [...p.variants].sort((a, b) => a.position - b.position);
    for (const v of variants) {
      const url = v.offer.url ?? p.url;
      const image = v.image_url ?? p.images[0]?.url;
      if (!url || !image) {
        skipped++;
        continue;
      }
      const onSale = !!v.offer.compare_at && v.offer.compare_at.amount > v.offer.price.amount;
      rows.push(
        compact({
          item_id: v.id,
          title: truncate(multi ? `${p.title} - ${v.title}` : p.title, 150),
          description,
          url,
          brand: p.brand ?? seller,
          seller_name: seller,
          image_url: image,
          price: onSale ? acpPrice(v.offer.compare_at!) : acpPrice(v.offer.price),
          sale_price: onSale ? acpPrice(v.offer.price) : undefined,
          availability: AVAILABILITY[v.offer.availability] ?? "unknown",
          group_id: multi ? p.id : undefined,
          listing_has_variations: multi ? true : undefined,
          variant_dict: multi ? v.options : undefined,
          gtin: v.gtin && GTIN.test(v.gtin) ? v.gtin : undefined,
          product_category: p.category ?? p.product_type,
          additional_image_urls: p.images.slice(1, 10).map((i) => i.url),
          color: optionValue(v.options, /^colou?r$/i),
          size: optionValue(v.options, /^size$/i),
          seller_url: store.base_url,
          is_eligible_search: true,
          is_eligible_checkout: false,
        }),
      );
    }
  }
  return { rows, skipped };
}

/** JSONL body: one object per line, "\n"-terminated. */
export const toJsonl = (rows: AcpRow[]) => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
