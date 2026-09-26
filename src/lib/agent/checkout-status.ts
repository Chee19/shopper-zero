// src/lib/agent/checkout-status.ts  (WS3)
// The single switch that decides whether profiles, llms.txt and openapi advertise agent checkout.
import type { PaymentRailId, Store } from "@/lib/contracts";
import { optionalEnv } from "@/lib/env";
import type { ProfileCheckout } from "@/lib/formats/ucp";

/** WS3 flips this to true once WS4's MCP checkout milestone (04 M6) passes end to end. */
export const CHECKOUT_TOOLS_LIVE: boolean = false;

/** Same env rules as WS4's paymentHandlers(): Stripe if a key is set, x402 if a pay-to address is set. */
export function enabledRails(): PaymentRailId[] {
  const r: PaymentRailId[] = [];
  if (optionalEnv("STRIPE_SECRET_KEY")) r.push("stripe_spt");
  if (optionalEnv("X402_PAY_TO")) r.push("x402");
  return r;
}

/**
 * B10: the source of truth is WS4's resolveCheckoutConnector(store). WS4 does not export
 * @/lib/checkout/connectors yet, so this uses the spec 03 §4.7 fallback (stores.checkout_connector,
 * which WS2 fills from resolveCheckoutConnector). Switch once WS4 lands it.
 */
export const agentCheckoutFor = (s: Pick<Store, "checkout_connector">) =>
  CHECKOUT_TOOLS_LIVE && s.checkout_connector !== "handoff";

/** Profile checkout block, or null when checkout must not be claimed (not live, not this store, or no rails). */
export function profileCheckout(claim: boolean): ProfileCheckout | null {
  if (!CHECKOUT_TOOLS_LIVE || !claim) return null;
  const rails = enabledRails();
  if (rails.length === 0) return null; // never claim checkout with no way to pay
  return {
    rails,
    stripeEnvironment: optionalEnv("STRIPE_SECRET_KEY")?.startsWith("sk_live_") ? "live" : "test",
    x402Network: optionalEnv("X402_NETWORK") ?? "eip155:84532",
    x402Facilitator: optionalEnv("X402_FACILITATOR_URL") ?? "https://x402.org/facilitator",
  };
}
