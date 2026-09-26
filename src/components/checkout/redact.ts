import type { CheckoutSession, ShippingOption } from "../lib/contracts";
import { initials } from "../lib/format";

/**
 * The timeline's view of a checkout. PII rule (spec 05 §7.4): buyer email/phone and address lines never reach the page,
 * not even in the serialized props, so redaction happens before anything is passed to a client component.
 */
export type PublicCheckout = Omit<CheckoutSession, "buyer" | "fulfillment"> & {
  ship_to: { initials: string; city: string; region?: string; country: string } | null;
  shipping: { options: ShippingOption[]; selected_option_id?: string } | null;
};

export function redactCheckout(c: CheckoutSession | null): PublicCheckout | null {
  if (!c) return null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { buyer, fulfillment, ...rest } = c;
  const a = fulfillment?.address;
  return {
    ...rest,
    ship_to: a ? { initials: initials(a.name), city: a.city, ...(a.region ? { region: a.region } : {}), country: a.country } : null,
    shipping: fulfillment ? { options: fulfillment.options ?? [], ...(fulfillment.selected_option_id ? { selected_option_id: fulfillment.selected_option_id } : {}) } : null,
  };
}
