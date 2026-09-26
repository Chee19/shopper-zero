import "server-only";
import type { AccessMethod, CheckoutConnectorId, DomRecipe, Store } from "@/contracts";
import { optionalEnv } from "@/shared/env";

// R6 stand-in for WS4's connectors/index.ts (04 section 8.0), non-stretch rules only.
// Swap the import to "@/features/checkout/connectors" once that ships; the signature already matches.
export type ConnectorStore = Pick<Store, "domain" | "base_url" | "platform"> & {
  best_method?: AccessMethod | "none" | null;
  dom_recipe?: DomRecipe | null;
};

export function checkoutAllowlist(): string[] {
  const hosts = (optionalEnv("CHECKOUT_ALLOWED_DOMAINS") ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const demo = optionalEnv("WOO_DEMO_URL");
  if (demo && URL.canParse(demo)) hosts.push(new URL(demo).host.toLowerCase());
  return [...new Set(hosts)];
}

const hostOf = (s: ConnectorStore) => (URL.canParse(s.base_url) ? new URL(s.base_url).host.toLowerCase() : "");

export function resolveCheckoutConnector(store: ConnectorStore): CheckoutConnectorId {
  const allowlisted = checkoutAllowlist().includes(hostOf(store));
  if (optionalEnv("CHECKOUT_FORCE_HANDOFF") === "1") return "handoff"; // dev only, before M2 (04 section 10)
  if (allowlisted && store.platform === "woocommerce") return "woo_store_api";
  return "handoff";
}
