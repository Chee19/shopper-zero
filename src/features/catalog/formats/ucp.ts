// src/lib/formats/ucp.ts  (WS3; pure)
// UCP product shape for MCP + REST catalog outputs (B7, spec 03 §6.4) and UCP discovery profiles (§6.6).
// Structure mirrors Shopify's live UCP MCP / profile responses. ShoperZero extras live under `_shoperzero`.
import type { IndexedProduct, IndexedVariant, Money, PaymentRailId } from "@/contracts";
import { PAYMENT_HANDLER_IDS, UCP_SUPPORTED_VERSIONS, UCP_VERSION } from "@/contracts";
import { cartPermalink } from "@/features/catalog/formats/permalink";
import { isAvailable, plainDescription, truncate } from "@/features/catalog/formats/text";

/**
 * Path of the composed agent MCP server (catalog + crawl + checkout). /api/mcp currently serves WS4's
 * mock-only checkout server, so every surface advertises this one (mirrors Shopify's /api/ucp/mcp).
 */
export const MCP_PATH = "/api/ucp/mcp";

// ---------------- envelope ----------------

export const CAP_SEARCH = "dev.ucp.shopping.catalog.search";
export const CAP_LOOKUP = "dev.ucp.shopping.catalog.lookup";

export function ucpEnvelope(capabilities: string[]) {
  return {
    version: UCP_VERSION,
    status: "success",
    capabilities: Object.fromEntries(capabilities.map((c) => [c, [{ version: UCP_VERSION }]])),
  };
}

export interface UcpMessage {
  type: "info" | "warning" | "error";
  code: string;
  content: string;
}

// ---------------- product ----------------

export type UcpMode = "summary" | "full";
export interface SelectedOption {
  name: string;
  label: string;
}
export interface VariantInput {
  id: string;
  match: "exact" | "featured";
}

export interface ToUcpOptions {
  base: string;
  /** Keep only these variants (in product order). Omitted = all (capped per mode). */
  variantIds?: string[];
  /** Search relevance; emitted as _shoperzero.score. */
  score?: number;
  /** Echoed on the product; option values gain {exists, available}. */
  selected?: SelectedOption[];
  /** lookup_catalog: per-variant `inputs` tags. */
  inputs?: Record<string, VariantInput[]>;
  /** get_product verify: variants re-checked live get _shoperzero.verified and price_range is recomputed. */
  verifiedIds?: string[];
}

const SUMMARY_VARIANTS = 10;
const FULL_VARIANTS = 100;
const SUMMARY_MEDIA = 3;
const FULL_MEDIA = 20;
const SUMMARY_TAGS = 10;
const SUMMARY_DESCRIPTION = 280;
const FULL_DESCRIPTION = 5000;

const eqi = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

/** Case-insensitive: does the variant carry every selected pair? */
export function variantMatches(v: Pick<IndexedVariant, "options">, selected: SelectedOption[]): boolean {
  return selected.every((s) => {
    const key = Object.keys(v.options).find((k) => eqi(k, s.name));
    return key !== undefined && eqi(v.options[key], s.label);
  });
}

function minMax(values: Money[]): { min: Money; max: Money } | null {
  if (values.length === 0) return null;
  const currency = values[0].currency;
  const same = values.filter((m) => m.currency === currency);
  let min = same[0];
  let max = same[0];
  for (const m of same) {
    if (m.amount < min.amount) min = m;
    if (m.amount > max.amount) max = m;
  }
  return { min: { ...min }, max: { ...max } };
}

const hasListPrice = (v: IndexedVariant) => !!v.offer.compare_at && v.offer.compare_at.amount > v.offer.price.amount;

export function toUcpVariant(v: IndexedVariant, p: IndexedProduct, opts: { inputs?: VariantInput[]; verified?: boolean } = {}) {
  return {
    id: v.id,
    ...(v.sku ? { sku: v.sku } : {}),
    ...(v.gtin ? { barcodes: [{ type: "gtin", value: v.gtin }] } : {}),
    title: v.title,
    price: v.offer.price,
    ...(hasListPrice(v) ? { list_price: v.offer.compare_at } : {}),
    availability: { available: isAvailable(v) },
    options: Object.entries(v.options).map(([name, label]) => ({ name, label })),
    media: v.image_url ? [{ type: "image", url: v.image_url }] : [],
    url: v.offer.url ?? p.url,
    checkout_url: cartPermalink(p.store, p, v, 1),
    ...(opts.inputs?.length ? { inputs: opts.inputs } : {}),
    _shoperzero: {
      seq: v.seq,
      checked_at: v.offer.checked_at,
      inventory_quantity: v.inventory_quantity,
      ...(opts.verified ? { verified: true } : {}),
    },
  };
}

function pickVariants(p: IndexedProduct, mode: UcpMode, variantIds?: string[]): IndexedVariant[] {
  const ordered = [...p.variants].sort((a, b) => a.position - b.position);
  if (variantIds) {
    const want = new Set(variantIds);
    return ordered.filter((v) => want.has(v.id)).slice(0, FULL_VARIANTS);
  }
  if (mode === "full") return ordered.slice(0, FULL_VARIANTS);
  // summary: available first, stable by position
  return [...ordered.filter(isAvailable), ...ordered.filter((v) => !isAvailable(v))].slice(0, SUMMARY_VARIANTS);
}

function ucpOptions(p: IndexedProduct, selected?: SelectedOption[]) {
  return p.options.map((o) => ({
    name: o.name,
    values: o.values.map((label) => {
      if (!selected?.length) return { label };
      // Selection with this option replaced by this value.
      const probe = [...selected.filter((s) => !eqi(s.name, o.name)), { name: o.name, label }];
      const matching = p.variants.filter((v) => variantMatches(v, probe));
      return { label, exists: matching.length > 0, available: matching.some(isAvailable) };
    }),
  }));
}

/** Returns a UcpProduct (00 §6.8); the concrete shape is inferred so callers keep field types. */
export function toUcpProduct(p: IndexedProduct, mode: UcpMode, opts: ToUcpOptions) {
  const variants = pickVariants(p, mode, opts.variantIds);
  const verified = new Set(opts.verifiedIds ?? []);
  const plain = plainDescription(p);
  const description =
    mode === "summary"
      ? { plain: truncate(plain, SUMMARY_DESCRIPTION) }
      : {
          plain: truncate(plain, FULL_DESCRIPTION),
          ...(p.description_html ? { html: p.description_html } : {}),
        };
  const categories = [...new Set([p.category, p.product_type].filter((c): c is string => !!c))].map((value) => ({
    value,
    taxonomy: "merchant",
  }));
  const priceRange = (opts.verifiedIds?.length ? minMax(variants.map((v) => v.offer.price)) : null) ?? p.price_range;
  const listPriceRange = minMax(variants.filter(hasListPrice).map((v) => v.offer.compare_at as Money));
  const media = p.images
    .slice(0, mode === "summary" ? SUMMARY_MEDIA : FULL_MEDIA)
    .map((i) => ({ type: "image", url: i.url, alt: i.alt ?? p.title }));

  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    description,
    url: p.url,
    categories,
    price_range: priceRange,
    ...(listPriceRange ? { list_price_range: listPriceRange } : {}),
    media,
    options: ucpOptions(p, opts.selected),
    ...(opts.selected?.length ? { selected: opts.selected } : {}),
    variants: variants.map((v) => toUcpVariant(v, p, { inputs: opts.inputs?.[v.id], verified: verified.has(v.id) })),
    tags: mode === "summary" ? p.tags.slice(0, SUMMARY_TAGS) : p.tags,
    _shoperzero: {
      store: p.store,
      brand: p.brand,
      available: p.available,
      checkout_methods: p.checkout_methods,
      variants_count: p.variants.length,
      source: p.source,
      seq: p.seq,
      ...(opts.score !== undefined ? { score: opts.score } : {}),
      updated_at: p.updated_at,
      products_json_url: `${opts.base}/s/${p.store.slug}/products/${p.handle}.json`,
    },
  };
}

// ---------------- profiles (/.well-known/ucp) ----------------

/** Versions served at /.well-known/ucp/{version} (everything supported except the current one). */
export const OLDER_UCP_VERSIONS: readonly string[] = UCP_SUPPORTED_VERSIONS.filter((v) => v !== UCP_VERSION);

/** Payment handler entry version (our own handler spec date). */
const HANDLER_VERSION = "2026-09-26";

export interface ProfileCheckout {
  rails: PaymentRailId[];
}

export interface BuildUcpProfileOptions {
  base: string;
  /** Per-store profile when set (endpoint gets ?store=, supported_versions = {}). */
  store?: { slug: string };
  version?: string;
  /** Checkout is claimed only when this is set (checkoutLive() and, per store, agentCheckoutFor). */
  checkout?: ProfileCheckout | null;
}

const ucpSpec = (v: string, path: string) => `https://ucp.dev/${v}/${path}`;

function capability(v: string, specPath: string, schemaFile: string, extra: Record<string, unknown> = {}) {
  return [{ version: v, spec: ucpSpec(v, specPath), schema: ucpSpec(v, `schemas/shopping/${schemaFile}`), ...extra }];
}

export function buildUcpProfile({ base, store, version = UCP_VERSION, checkout = null }: BuildUcpProfileOptions) {
  const v = version;
  const capabilities: Record<string, unknown> = {
    [CAP_SEARCH]: capability(v, "specification/shopping/catalog/", "catalog_search.json"),
    [CAP_LOOKUP]: capability(v, "specification/shopping/catalog/", "catalog_lookup.json"),
  };
  const paymentHandlers: Record<string, unknown> = {};
  if (checkout) {
    capabilities["dev.ucp.shopping.checkout"] = capability(v, "specification/shopping/checkout/", "checkout.json");
    capabilities["dev.ucp.shopping.fulfillment"] = capability(
      v,
      "specification/shopping/extensions/fulfillment/",
      "fulfillment.json",
      { extends: ["dev.ucp.shopping.checkout"] },
    );
    capabilities["dev.ucp.shopping.order"] = capability(v, "specification/shopping/order/", "order.json");
    // Stripe-only MVP: the Stripe test handler is the only one we advertise; environment is always "test".
    for (const rail of checkout.rails) {
      if (rail !== "stripe_spt") continue;
      const id = PAYMENT_HANDLER_IDS[rail];
      paymentHandlers[id] = [
        {
          id,
          version: HANDLER_VERSION,
          spec: `${base}/llms.txt`,
          config: { rail, accepted: ["card"], credential_type: "spt", environment: "test" },
        },
      ];
    }
  }

  const isCurrentRoot = !store && v === UCP_VERSION;
  const supportedVersions = store
    ? {}
    : isCurrentRoot
      ? Object.fromEntries(OLDER_UCP_VERSIONS.map((o) => [o, `${base}/.well-known/ucp/${o}`]))
      : undefined; // versioned root profiles omit it

  return {
    ucp: {
      version: v,
      ...(supportedVersions !== undefined ? { supported_versions: supportedVersions } : {}),
      services: {
        "dev.ucp.shopping": [
          {
            version: v,
            spec: ucpSpec(v, "specification/overview/"),
            transport: "mcp",
            endpoint: store ? `${base}${MCP_PATH}?store=${encodeURIComponent(store.slug)}` : `${base}${MCP_PATH}`,
            schema: ucpSpec(v, "services/shopping/mcp.openrpc.json"),
          },
        ],
      },
      capabilities,
      payment_handlers: paymentHandlers,
    },
  };
}
