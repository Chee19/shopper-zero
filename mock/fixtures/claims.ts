import { claimInstructions, type ClaimView } from "@/components/claim/types";
import { MOCK_STORES } from "./stores";

export const MOCK_CLAIM_TOKEN = "mock9f2c4e1a7b";

/** A pending ClaimView for any fixture store (berlinpackaging-com is the documented one). */
export function mockClaimView(slug: string, over: Partial<ClaimView> = {}): ClaimView | null {
  const store = MOCK_STORES.find((s) => s.slug === slug);
  if (!store) return null;
  const host = new URL(store.base_url).hostname;
  const token = over.token ?? MOCK_CLAIM_TOKEN;
  return {
    slug,
    domain: store.domain,
    status: "pending",
    token,
    method: "dns_txt",
    verified_at: null,
    opted_out: store.opted_out,
    instructions: claimInstructions(host, token),
    ...over,
  };
}
