// src/lib/agent/verify.ts  (WS3): live re-check around WS2's verifyOffer (get_product verify: true).
import type { IndexedProduct, IndexedVariant, Offer, VerifyOfferFn } from "@/lib/contracts";
import { isAppError } from "@/lib/errors";
import { isAvailable } from "@/lib/formats/text";
import type { UcpMessage } from "@/lib/formats/ucp";
import { acpPrice } from "@/lib/money";

export const VERIFY_MAX_VARIANTS = 5;
export const VERIFY_TIMEOUT_MS = 8_000;

export interface Verification {
  verified_at: string;
  ok: boolean;
  changed_variant_ids: string[];
  errors: string[];
}

export interface VerifyResult {
  product: IndexedProduct; // a copy with re-checked offers applied
  verifiedIds: string[];
  verification: Verification;
  messages: UcpMessage[];
}

class VerifyTimeout extends Error {}

function withDeadline<T>(p: Promise<T>, deadline: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new VerifyTimeout("timeout")), Math.max(0, deadline - Date.now()));
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Re-checks up to 5 of `variantIds` (available first) in parallel under one 8 s deadline.
 * Never throws: failures become warnings and the indexed data is kept.
 */
export async function verifyVariants(
  product: IndexedProduct,
  variantIds: string[],
  verifier: VerifyOfferFn,
  opts: { timeoutMs?: number } = {},
): Promise<VerifyResult> {
  const p: IndexedProduct = { ...product, variants: product.variants.map((v) => ({ ...v, offer: { ...v.offer } })) };
  const wanted = new Set(variantIds);
  const pool = p.variants.filter((v) => wanted.has(v.id));
  const targets = [...pool.filter(isAvailable), ...pool.filter((v) => !isAvailable(v))].slice(0, VERIFY_MAX_VARIANTS);

  const deadline = Date.now() + (opts.timeoutMs ?? VERIFY_TIMEOUT_MS);
  const settled = await Promise.allSettled(targets.map((v) => withDeadline(verifier(v.id), deadline)));

  const messages: UcpMessage[] = [];
  const warned = new Set<string>();
  const warn = (code: string, content: string) => {
    if (warned.has(code)) return;
    warned.add(code);
    messages.push({ type: "warning", code, content });
  };
  const verifiedIds: string[] = [];
  const changed: string[] = [];
  const errors: string[] = [];

  settled.forEach((r, i) => {
    const v = targets[i];
    if (r.status === "fulfilled") {
      if (applyOffer(v, r.value, messages)) changed.push(v.id);
      verifiedIds.push(v.id);
      return;
    }
    const e = r.reason;
    if (isAppError(e) && e.code === "not_implemented") {
      errors.push(`${v.id}: verify_unavailable`);
      warn("verify_unavailable", "Live verification is not available yet; showing indexed data.");
    } else if (isAppError(e) && e.code === "not_found") {
      errors.push(`${v.id}: no_longer_sold`);
      if (isAvailable(v)) changed.push(v.id);
      v.offer.availability = "out_of_stock";
      warn("no_longer_sold", `${v.title}: no longer sold on the merchant's site.`);
    } else {
      errors.push(`${v.id}: ${e instanceof VerifyTimeout ? "timeout" : isAppError(e) ? e.code : "verify_failed"}`);
      warn("verify_failed", `Could not reach the merchant; showing indexed data from ${v.offer.checked_at}.`);
    }
  });

  p.available = p.variants.some(isAvailable);
  return {
    product: p,
    verifiedIds,
    verification: {
      verified_at: new Date().toISOString(),
      ok: targets.length > 0 && errors.length === 0,
      changed_variant_ids: changed,
      errors,
    },
    messages,
  };
}

/** Overwrites the variant's offer; returns true when price or availability changed. */
function applyOffer(v: IndexedVariant, next: Offer, messages: UcpMessage[]): boolean {
  const prev = v.offer;
  const priceChanged = prev.price.amount !== next.price.amount || prev.price.currency !== next.price.currency;
  const availabilityChanged = prev.availability !== next.availability;
  if (priceChanged) {
    messages.push({ type: "info", code: "price_changed", content: `${v.title}: was ${acpPrice(prev.price)}, now ${acpPrice(next.price)}` });
  }
  if (availabilityChanged) {
    messages.push({
      type: "info",
      code: "availability_changed",
      content: `${v.title}: was ${prev.availability}, now ${next.availability}`,
    });
  }
  v.offer = { ...prev, price: next.price, compare_at: next.compare_at, availability: next.availability, checked_at: next.checked_at, url: next.url ?? prev.url };
  return priceChanged || availabilityChanged;
}
