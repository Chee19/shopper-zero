// src/lib/agent/lookup.ts  (WS3; pure): lookup_catalog tagging and variant narrowing.
import type { IndexedProduct } from "@/lib/contracts";
import { isAvailable } from "@/lib/formats/text";
import { CAP_LOOKUP, toUcpProduct, ucpEnvelope, type UcpMessage, type VariantInput } from "@/lib/formats/ucp";

const LOOKUP_VARIANT_CAP = 25;

/**
 * Shapes lookupProducts() output into the lookup_catalog body (spec 03 §4.2). Only refs that resolved
 * (not in not_found) are tagged: exact for variant ids, featured for product refs.
 */
export function shapeLookup(products: IndexedProduct[], not_found: string[], allRefs: string[], base: string) {
  const missing = new Set(not_found);
  const refs = allRefs.filter((r) => !missing.has(r));
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
