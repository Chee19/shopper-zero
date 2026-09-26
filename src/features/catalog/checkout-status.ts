// src/lib/agent/checkout-status.ts  (WS3)
// The single switch that decides whether profiles, llms.txt and openapi advertise agent checkout.
import type { PaymentRailId, Store } from "@/contracts";
import { optionalEnv } from "@/shared/env";
import type { ProfileCheckout } from "@/features/catalog/formats/ucp";

/** WS3 flips this to true once WS4's MCP checkout milestone (04 M6) passes end to end. */
export const CHECKOUT_TOOLS_LIVE: boolean = false;

/** Stripe-only MVP (DECISIONS, 26 Sep): the Stripe handler is advertised only with a test key. */
export function enabledRails(): PaymentRailId[] {
  const r: PaymentRailId[] = [];
  if (optionalEnv("STRIPE_SECRET_KEY")?.startsWith("sk_test_")) r.push("stripe_spt");
  return r;
}

/**
 * THE switch every surface reads (03 §4.7): checkout tools are live AND at least one payment rail is
 * configured. Profiles, llms.txt, openapi and /api/v1/stores/{slug} all go through this.
 */
export const checkoutLive = () => CHECKOUT_TOOLS_LIVE && enabledRails().length > 0;

/**
 * B10: the source of truth is WS4's resolveCheckoutConnector(store). WS4 does not export
 * @/features/checkout/connectors yet, so this uses the spec 03 §4.7 fallback (stores.checkout_connector,
 * which WS2 fills from resolveCheckoutConnector). Switch once WS4 lands it.
 */
export const agentCheckoutFor = (s: Pick<Store, "checkout_connector">) =>
  checkoutLive() && s.checkout_connector !== "handoff";

/** Profile checkout block, or null when checkout must not be claimed (see checkoutLive). */
export function profileCheckout(claim: boolean): ProfileCheckout | null {
  if (!claim || !checkoutLive()) return null;
  return { rails: enabledRails() };
}
