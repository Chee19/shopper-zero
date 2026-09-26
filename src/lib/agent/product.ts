// src/lib/agent/product.ts  (WS3): get_product / lookup_catalog logic, shared by MCP and REST.
import "server-only";
import type { IndexedProduct, VerifyOfferFn } from "@/lib/contracts";
import { verifyOffer } from "@/lib/crawl";
import { getProduct, lookupProducts } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { isAvailable, mdInline } from "@/lib/formats/text";
import {
  CAP_LOOKUP,
  toUcpProduct,
  ucpEnvelope,
  type SelectedOption,
  type UcpMessage,
  type VariantInput,
} from "@/lib/formats/ucp";
import { selectVariants } from "./select";
import { verifyVariants, type Verification } from "./verify";

export interface ProductDetailOptions {
  verify?: boolean;
  selected?: SelectedOption[];
  /** Injected in tests; defaults to WS2's verifyOffer. */
  verifier?: VerifyOfferFn;
}

export interface ProductDetail {
  /** The (possibly verified) product, for ?format=indexed. */
  indexed: IndexedProduct;
  verification?: Verification;
  /** The get_product body: { ucp, product, verification?, messages }. */
  body: {
    ucp: ReturnType<typeof ucpEnvelope>;
    product: ReturnType<typeof toUcpProduct>;
    verification?: Verification;
    messages: UcpMessage[];
  };
}

export async function productDetail(ref: string, opts: ProductDetailOptions = {}): Promise<ProductDetail> {
  const found = await getProduct(ref);
  if (!found) throw new AppError("not_found", `No product with id '${ref}'. Ids come from search_catalog results.`);

  const sel = selectVariants(found, ref, opts.selected);
  const messages = [...sel.messages];
  let product = found;
  let verification: Verification | undefined;
  let verifiedIds: string[] | undefined;
  if (opts.verify) {
    const r = await verifyVariants(found, sel.variantIds, opts.verifier ?? verifyOffer);
    product = r.product;
    verification = r.verification;
    verifiedIds = r.verifiedIds;
    messages.push(...r.messages);
  }

  const ucpProduct = toUcpProduct(product, "full", {
    base: appUrl(),
    variantIds: sel.variantIds,
    selected: sel.selected,
    verifiedIds,
  });
  return {
    indexed: product,
    verification,
    body: {
      ucp: ucpEnvelope([CAP_LOOKUP]),
      product: ucpProduct,
      ...(verification ? { verification } : {}),
      messages,
    },
  };
}

export function productSummary(body: ProductDetail["body"]): string {
  const p = body.product;
  const store = p._shoperzero.store;
  const v = body.verification;
  const verified = v ? (v.ok ? "; verified live" : "; live check incomplete") : "";
  return `${mdInline(p.title, 120)} (${mdInline(store.name ?? store.domain, 80)}): ${p.variants.length} variants${verified}.`;
}

const LOOKUP_VARIANT_CAP = 25;

/** lookup_catalog (spec 03 §4.2). */
export async function lookupCatalog(refs: string[]) {
  const { products, not_found } = await lookupProducts(refs);
  const base = appUrl();
  const out = products.map((p) => {
    const ordered = [...p.variants].sort((a, b) => a.position - b.position);
    const variantIdSet = new Set(ordered.map((v) => v.id));
    const inputs: Record<string, VariantInput[]> = {};
    const tag = (variantId: string, input: VariantInput) => (inputs[variantId] ??= []).push(input);

    // uuids resolve case-insensitively in Postgres, so compare lower-cased; tags echo the caller's ref.
    const variantOf = (r: string) => (variantIdSet.has(r.toLowerCase()) ? r.toLowerCase() : null);
    const exactRefs = refs.filter((r) => variantOf(r));
    const exact = exactRefs.map((r) => variantOf(r) as string);
    const productRefs = refs.filter((r) => {
      if (variantOf(r)) return false;
      const lr = r.toLowerCase();
      return lr === p.id || lr === `${p.store.slug}:${p.seq}`.toLowerCase() || r === String(p.seq);
    });
    for (const r of exactRefs) tag(variantOf(r) as string, { id: r, match: "exact" });

    let variantIds: string[];
    if (productRefs.length || exact.length === 0) {
      const featured = ordered.find(isAvailable) ?? ordered[0];
      for (const r of productRefs.length ? productRefs : [p.id]) tag(featured.id, { id: r, match: "featured" });
      // All variants, capped at 25, always keeping every tagged one.
      const tagged = new Set([featured.id, ...exact]);
      const room = Math.max(0, LOOKUP_VARIANT_CAP - tagged.size);
      const rest = new Set(ordered.filter((v) => !tagged.has(v.id)).slice(0, room).map((v) => v.id));
      variantIds = ordered.filter((v) => tagged.has(v.id) || rest.has(v.id)).map((v) => v.id);
    } else {
      variantIds = ordered.filter((v) => exact.includes(v.id)).map((v) => v.id);
    }
    return toUcpProduct(p, "full", { base, variantIds, inputs });
  });

  return {
    ucp: ucpEnvelope([CAP_LOOKUP]),
    products: out,
    not_found,
    messages: not_found.map((id): UcpMessage => ({ type: "info", code: "not_found", content: id })),
  };
}
