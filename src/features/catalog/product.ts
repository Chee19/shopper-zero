// src/lib/agent/product.ts  (WS3): get_product / lookup_catalog logic, shared by MCP and REST.
import "server-only";
import type { IndexedProduct, VerifyOfferFn } from "@/contracts";
import { verifyOffer } from "@/features/crawl";
import { getProduct, lookupProducts } from "@/infrastructure/database";
import { appUrl } from "@/shared/env";
import { AppError } from "@/shared/errors";
import { plainInline } from "@/features/catalog/formats/text";
import {
  CAP_LOOKUP,
  toUcpProduct,
  ucpEnvelope,
  type SelectedOption,
  type UcpMessage,
} from "@/features/catalog/formats/ucp";
import { shapeLookup } from "@/features/catalog/lookup";
import { selectVariants } from "@/features/catalog/select";
import { verifyVariants, type Verification } from "@/features/catalog/verify";

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
  return `${plainInline(p.title)} (${plainInline(store.name ?? "", 80) || plainInline(store.domain, 80)}): ${p.variants.length} variants${verified}.`;
}

/** lookup_catalog (spec 03 §4.2). */
export async function lookupCatalog(refs: string[]) {
  const { products, not_found } = await lookupProducts(refs);
  return shapeLookup(products, not_found, refs, appUrl());
}
