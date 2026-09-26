import "server-only";
import * as cheerio from "cheerio";
import type { Availability, Money, NormalizedProduct } from "@/lib/contracts";
import { parsePrice } from "@/lib/money";
import { decodeEntities, finalizeProduct, type DraftProduct, type DraftVariant } from "./normalize";
import { canonicalizeProductUrl } from "./url";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema.org JSON-LD is untyped
export type JsonLdNode = Record<string, any>;

export const arr = <T,>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const SCHEMA_PREFIX = /^(?:https?:)?\/\/schema\.org\/|^schema:/i;
export const typesOf = (n: unknown): string[] =>
  n && typeof n === "object" ? arr((n as JsonLdNode)["@type"]).map((t) => String(t).replace(SCHEMA_PREFIX, "")) : [];
export const isType = (n: unknown, ...types: string[]) => typesOf(n).some((t) => types.includes(t));

// Tolerates HTML comment/CDATA wrappers, trailing commas, raw control chars and concatenated objects.
export function safeJson(text: string): unknown {
  const t = text.replace(/^\s*(?:<!--|\/\/\s*<!\[CDATA\[)/, "").replace(/(?:-->|\/\/\s*\]\]>)\s*$/, "").trim().replace(/;\s*$/, "");
  for (const cand of [t, t.replace(/[\u0000-\u001F]+/g, " ").replace(/,\s*([}\]])/g, "$1")]) {
    try {
      return JSON.parse(cand);
    } catch {}
  }
  try {
    return JSON.parse(`[${t.replace(/}\s*{/g, "},{")}]`);
  } catch {
    return null;
  }
}

// Flattens arrays, @graph, mainEntity and ItemList elements; hasVariant/offers stay nested.
export function parseJsonLdNodes(html: string | cheerio.CheerioAPI): JsonLdNode[] {
  const $ = typeof html === "string" ? cheerio.load(html) : html;
  const out: JsonLdNode[] = [];
  const walk = (v: unknown) => {
    for (const n of arr(v as JsonLdNode | JsonLdNode[])) {
      if (!n || typeof n !== "object") continue;
      out.push(n);
      if (n["@graph"]) walk(n["@graph"]);
      if (n.mainEntity) walk(n.mainEntity);
      if (n.itemListElement) walk(arr(n.itemListElement).map((e: JsonLdNode) => e?.item ?? e));
    }
  };
  $('script[type*="ld+json" i]').each((_, el) => walk(safeJson($(el).text() ?? "")));
  return out;
}

export type JsonLdMiss = "no_jsonld" | "no_product" | "no_price" | "no_currency" | "invalid";
export interface JsonLdResult { product: NormalizedProduct | null; miss: JsonLdMiss | null; nodes: number }

const isRecord = (v: unknown): v is JsonLdNode => !!v && typeof v === "object" && !Array.isArray(v);
type Deref = (v: unknown) => unknown;

// @id ref: an object whose only meaningful key is @id resolves to the indexed node (02 5.7 rule 4).
function makeDeref(byId: Map<string, JsonLdNode>): Deref {
  return (v) => (isRecord(v) && typeof v["@id"] === "string" && v["@type"] === undefined && byId.has(v["@id"]) ? byId.get(v["@id"]) : v);
}
const derefRecord = (deref: Deref, v: unknown): JsonLdNode | null => {
  const d = deref(v);
  return isRecord(d) ? d : null;
};
function nameOf(v: unknown, deref: Deref): string | null {
  if (typeof v === "string") return v;
  const d = derefRecord(deref, v);
  return d && typeof d.name === "string" ? d.name : null;
}
function gtinOf(n: JsonLdNode): string | null {
  const v = n.gtin ?? n.gtin13 ?? n.gtin12 ?? n.gtin14 ?? n.gtin8 ?? n.isbn ?? null;
  return v != null ? String(v) : null;
}

const AVAIL: Record<string, Availability> = {
  instock: "in_stock", limitedavailability: "in_stock", onlineonly: "in_stock", true: "in_stock",
  preorder: "preorder", presale: "preorder", backorder: "preorder",
  outofstock: "out_of_stock", soldout: "out_of_stock", discontinued: "out_of_stock", instoreonly: "out_of_stock",
};
// InStoreOnly maps to out_of_stock on purpose: an agent cannot buy it online (differs from 05).
export const mapAvailability = (v: unknown): Availability =>
  AVAIL[String(v ?? "").split("/").pop()!.toLowerCase().replace(/[^a-z]/g, "")] ?? "unknown";

interface OfferRead {
  price: Money | null;
  compareAt: Money | null;
  availability: Availability;
  url: string | null;
  sku: string | null;
  name: string | null;
  noCurrency: boolean; // a price was present but no 3-letter currency could be resolved
}

function flattenOffers(offersRaw: JsonLdNode | JsonLdNode[] | undefined, deref: Deref): JsonLdNode[] {
  const flat: JsonLdNode[] = [];
  for (const raw of arr(offersRaw)) {
    const o = derefRecord(deref, raw);
    if (!o) continue;
    if (isType(o, "AggregateOffer") && o.offers) {
      for (const child of arr(o.offers)) {
        const c = derefRecord(deref, child);
        if (c) flat.push(c);
      }
    } else {
      flat.push(o);
    }
  }
  return flat;
}

const LIST_PRICE_TYPE = /StrikethroughPrice|ListPrice|MSRP|SRP/i;

function offerFromNode(o: JsonLdNode, fallbackCurrency: string | null): OfferRead {
  const specs = arr(o.priceSpecification).filter(isRecord);
  const listSpec = specs.find((s) => LIST_PRICE_TYPE.test(String(s.priceType ?? "")));
  const saleSpec = specs.find((s) => s !== listSpec && s.price != null);
  const raw = o.price ?? o.lowPrice ?? saleSpec?.price ?? (specs.length === 1 ? specs[0].price : undefined);
  const curRaw = String(o.priceCurrency ?? saleSpec?.priceCurrency ?? listSpec?.priceCurrency ?? fallbackCurrency ?? "").toUpperCase();
  const currencyValid = /^[A-Z]{3}$/.test(curRaw);
  const amount = parsePrice(raw, currencyValid ? curRaw : "XXX");
  const price = amount != null && amount > 0 && currencyValid ? { amount, currency: curRaw } : null;
  const noCurrency = amount != null && amount > 0 && !currencyValid;
  const listAmount = price && listSpec?.price != null ? parsePrice(listSpec.price, curRaw) : null;
  const compareAt = price && listAmount != null && listAmount > price.amount ? { amount: listAmount, currency: curRaw } : null;
  return {
    price, compareAt, availability: mapAvailability(o.availability),
    url: typeof o.url === "string" ? o.url : null,
    sku: o.sku != null ? String(o.sku) : null,
    name: typeof o.name === "string" ? o.name : null,
    noCurrency,
  };
}

function readOffers(offersRaw: JsonLdNode | JsonLdNode[] | undefined, deref: Deref, fallbackCurrency: string | null): OfferRead[] {
  return flattenOffers(offersRaw, deref).map((o) => offerFromNode(o, fallbackCurrency));
}

function bestOffer(offers: OfferRead[]): OfferRead | null {
  const priced = offers.filter((o): o is OfferRead & { price: Money } => o.price != null);
  priced.sort((a, b) => (a.availability === "in_stock" ? 0 : 1) - (b.availability === "in_stock" ? 0 : 1) || a.price.amount - b.price.amount);
  return priced[0] ?? null;
}

const DEFAULT_OPTION_PROPS = ["color", "size", "material", "pattern"];
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function optionValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object") return isRecord(v) && typeof v.name === "string" ? v.name : null;
  return String(v);
}

function optionsOf(n: JsonLdNode, variesBy: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const prop of variesBy.length ? variesBy : DEFAULT_OPTION_PROPS) {
    const val = optionValue(n[prop]);
    if (val) out[titleCase(prop)] = val;
  }
  if (!variesBy.length) {
    for (const p of arr(n.additionalProperty).filter(isRecord)) {
      if (typeof p.name === "string" && p.value != null) out[p.name] = String(p.value);
    }
  }
  return out;
}

function imagesOf(nodes: JsonLdNode[], deref: Deref, base: string): { url: string }[] {
  const urls = nodes
    .flatMap((n) => arr(n.image).map((v) => deref(v)))
    .map((img) => (typeof img === "string" ? img : isRecord(img) ? (img.url ?? img.contentUrl) : null))
    .filter((u): u is string => typeof u === "string" && URL.canParse(u, base))
    .map((u) => new URL(u, base).href);
  return [...new Set(urls)].slice(0, 12).map((url) => ({ url }));
}

function variantFromNode(n: JsonLdNode, o: OfferRead, variesBy: string[], checkedAt: string, pageUrl: string): DraftVariant {
  const gtin = gtinOf(n);
  const skuRaw = n.sku ?? n.mpn ?? null;
  const externalRaw = n.sku ?? n.productID ?? gtin ?? o.sku ?? null;
  return {
    external_id: externalRaw != null ? String(externalRaw) : null,
    title: decodeEntities(typeof n.name === "string" ? n.name : "").trim(),
    options: optionsOf(n, variesBy),
    sku: skuRaw != null ? String(skuRaw) : null,
    gtin,
    image_url: null,
    inventory_quantity: null,
    offer: {
      price: o.price,
      compare_at: o.compareAt,
      availability: o.availability,
      url: (typeof n.url === "string" ? n.url : null) ?? o.url ?? pageUrl,
      checked_at: checkedAt,
    },
  };
}

// One node, >=2 offers with distinct sku/name (rule 6): each offer becomes its own variant.
// Uses the offer's own sku/productID first, not the shared product node's, so variants stay distinct.
function variantFromOffer(o: OfferRead, main: JsonLdNode, checkedAt: string, pageUrl: string): DraftVariant {
  const productName = typeof main.name === "string" ? decodeEntities(main.name).trim() : "";
  let title = o.name ?? "";
  if (productName && title.startsWith(productName)) title = title.slice(productName.length).replace(/^[\s\-:|/]+/, "").trim();
  if (!title) title = o.sku ?? "";
  const gtin = gtinOf(main);
  const externalRaw = o.sku ?? main.productID ?? gtin ?? null;
  return {
    external_id: externalRaw != null ? String(externalRaw) : null,
    title,
    options: {},
    sku: o.sku ?? null,
    gtin,
    image_url: null,
    inventory_quantity: null,
    offer: { price: o.price, compare_at: o.compareAt, availability: o.availability, url: o.url ?? pageUrl, checked_at: checkedAt },
  };
}

export function extractJsonLdProduct(
  html: string,
  pageUrl: string,
  opts: { defaultCurrency: string | null; checkedAt: string; baseUrl: string },
): JsonLdResult {
  const $ = cheerio.load(html);
  const nodes = parseJsonLdNodes($);
  if (!nodes.length) return { product: null, miss: "no_jsonld", nodes: 0 };

  const byId = new Map<string, JsonLdNode>(nodes.filter((n) => typeof n["@id"] === "string").map((n) => [n["@id"], n]));
  const deref = makeDeref(byId);
  const canon = (u: unknown): string | null => (typeof u === "string" ? canonicalizeProductUrl(u, pageUrl) : null);
  const page = canon(pageUrl);

  const metaCurrency = $('meta[itemprop="priceCurrency"], meta[property="product:price:currency"]').first().attr("content") ?? null;
  const fallbackCur = metaCurrency ? metaCurrency.toUpperCase() : opts.defaultCurrency;

  const groups = nodes.filter((n) => isType(n, "ProductGroup"));
  const products = nodes.filter((n) => isType(n, "Product", "IndividualProduct"));
  if (!groups.length && !products.length) return { product: null, miss: "no_product", nodes: nodes.length };

  let main: JsonLdNode;
  let variantNodes: JsonLdNode[];
  const group = groups.find((g) => canon(g.url) === page) ?? groups[0];
  if (group) {
    main = group;
    const gid = group.productGroupID;
    const derefedVariants = arr(group.hasVariant).map((v) => derefRecord(deref, v)).filter((v): v is JsonLdNode => v != null);
    const groupMembers = products.filter((p) => derefRecord(deref, p.isVariantOf) === group || (gid != null && p.inProductGroupWithID === gid));
    variantNodes = [...new Set([...derefedVariants, ...groupMembers])];
  } else {
    main = products.find((p) => canon(p.url) === page || arr(p.offers).some((o) => canon(derefRecord(deref, o)?.url) === page))
      ?? products.find((p) => p.offers) ?? products[0];
    const isVariantOfRef = derefRecord(deref, main.isVariantOf);
    const key = main.inProductGroupWithID ?? isVariantOfRef?.["@id"];
    variantNodes = key != null
      ? products.filter((p) => p.inProductGroupWithID === key || derefRecord(deref, p.isVariantOf)?.["@id"] === key)
      : [main];
    if (products.length > 3 && !canon(main.url) && variantNodes.length === 1) {
      // Many unrelated products, none matching the page: a listing page, not a PDP.
      return { product: null, miss: "no_product", nodes: nodes.length };
    }
  }

  const variesBy = arr(group?.variesBy).map((v) => String(v).replace(SCHEMA_PREFIX, ""));
  const variants: DraftVariant[] = [];
  for (const vn of variantNodes.length ? variantNodes : [main]) {
    const offersSrc = vn.offers ?? (vn === main ? undefined : main.offers);
    const offers = readOffers(offersSrc, deref, fallbackCur);
    const distinct = new Set(offers.map((o) => o.sku ?? o.name).filter((x): x is string => !!x));
    if (variantNodes.length <= 1 && offers.length >= 2 && distinct.size >= 2) {
      for (const o of offers) if (o.price) variants.push(variantFromOffer(o, main, opts.checkedAt, pageUrl));
      continue;
    }
    const o = bestOffer(offers);
    if (!o) continue;
    variants.push(variantFromNode(vn, o, variesBy, opts.checkedAt, pageUrl));
  }
  if (!variants.length) {
    const anyNoCurrency = [...variantNodes, main].some((vn) => readOffers(vn.offers, deref, fallbackCur).some((o) => o.noCurrency));
    return { product: null, miss: anyNoCurrency ? "no_currency" : "no_price", nodes: nodes.length };
  }

  const allNodes = [main, ...variantNodes];
  const externalIdRaw = main.productGroupID ?? main.productID ?? main.sku ?? main.mpn ?? null;
  const draft: DraftProduct = {
    external_id: externalIdRaw != null ? String(externalIdRaw) : null,
    url: page ?? pageUrl,
    title: decodeEntities(typeof main.name === "string" ? main.name : "").trim(),
    description_html: typeof main.description === "string" && /</.test(main.description) ? main.description : null,
    description_text: typeof main.description === "string" ? decodeEntities(main.description) : null,
    brand: nameOf(main.brand, deref) ?? nameOf(main.manufacturer, deref),
    product_type: null,
    category: typeof main.category === "string" ? main.category.split(">").pop()!.trim() : null,
    tags: [],
    images: imagesOf(allNodes, deref, pageUrl),
    options: [],
    variants,
    source: "jsonld",
    raw: { nodes: allNodes.slice(0, 50) },
  };
  const result = finalizeProduct(draft, { baseUrl: opts.baseUrl });
  return result.ok ? { product: result.product, miss: null, nodes: nodes.length } : { product: null, miss: "invalid", nodes: nodes.length };
}
