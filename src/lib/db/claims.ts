/* eslint-disable @typescript-eslint/no-unused-vars -- stub parameters, removed with the T+60 bodies */
import "server-only";
import type { ClaimMethod, StoreClaim } from "@/lib/contracts";
import { AppError } from "@/lib/errors";

// TODO(WS1 T+60)
/** Creates or rotates the claim token for a store. */
export async function upsertClaim(storeId: string, method: ClaimMethod): Promise<StoreClaim> {
  throw new AppError("not_implemented", "upsertClaim");
}

// TODO(WS1 T+60)
/** Non-rotating: returns the existing claim (updating only `method` if it differs), else creates one. Use for page loads. */
export async function getOrCreateClaim(storeId: string, method?: ClaimMethod): Promise<StoreClaim> {
  throw new AppError("not_implemented", "getOrCreateClaim");
}

// TODO(WS1 T+60)
export async function getClaim(storeId: string): Promise<StoreClaim | null> {
  throw new AppError("not_implemented", "getClaim");
}

// TODO(WS1 T+60)
/** Sets store_claims.verified_at and stores.claimed_at = now(). */
export async function markClaimVerified(storeId: string): Promise<void> {
  throw new AppError("not_implemented", "markClaimVerified");
}

// TODO(WS1 T+60)
export async function setStoreOptOut(storeId: string, optedOut: boolean): Promise<void> {
  throw new AppError("not_implemented", "setStoreOptOut");
}
