import "server-only";

/**
 * Lazily loads WS1's server-only db helpers, so UI_MOCK renders never import "@/lib/db" or construct a Supabase
 * client (spec 05 §6.1).
 */
export async function loadDb() {
  return import("@/lib/db");
}

/** WS4's checkout service: getCheckout(id) throws when the checkout is missing (or while the stub is in place). */
export async function loadCheckoutService() {
  return import("@/lib/checkout");
}
