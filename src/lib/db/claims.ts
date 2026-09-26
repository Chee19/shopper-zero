import "server-only";
import { randomUUID } from "node:crypto";
import type { ClaimMethod, StoreClaim } from "@/lib/contracts";
import { AppError, toAppError } from "@/lib/errors";
import { db } from "./client";
import { iso, isoOrNull } from "./mappers";
import type { Tables } from "./types.gen";
import { isUniqueViolation, isUuid } from "./util";

const newToken = (): string => randomUUID().replaceAll("-", "");

const toStoreClaim = (r: Tables<"store_claims">): StoreClaim => ({
  store_id: r.store_id,
  method: r.method as ClaimMethod,
  token: r.token,
  verified_at: isoOrNull(r.verified_at),
  created_at: iso(r.created_at),
});

/** Creates or rotates the claim token for a store. */
export async function upsertClaim(storeId: string, method: ClaimMethod): Promise<StoreClaim> {
  const { data, error } = await db()
    .from("store_claims")
    .upsert({ store_id: storeId, method, token: newToken(), verified_at: null }, { onConflict: "store_id" })
    .select("*")
    .single();
  if (error) throw toAppError(error);
  return toStoreClaim(data);
}

/** Non-rotating: returns the existing claim (updating only `method` if it differs), else creates one. Use for page loads. */
export async function getOrCreateClaim(storeId: string, method?: ClaimMethod): Promise<StoreClaim> {
  const existing = await getClaim(storeId);
  if (existing) {
    if (!method || method === existing.method) return existing;
    const { data, error } = await db()
      .from("store_claims")
      .update({ method })
      .eq("store_id", storeId)
      .select("*")
      .single();
    if (error) throw toAppError(error);
    return toStoreClaim(data);
  }
  const { data, error } = await db()
    .from("store_claims")
    .insert({ store_id: storeId, method: method ?? "dns_txt", token: newToken() })
    .select("*")
    .single();
  if (error) {
    // A concurrent page load created it first: return that one (the token must not rotate).
    if (isUniqueViolation(error)) {
      const raced = await getClaim(storeId);
      if (raced) return raced;
    }
    throw toAppError(error);
  }
  return toStoreClaim(data);
}

export async function getClaim(storeId: string): Promise<StoreClaim | null> {
  if (!isUuid(storeId)) return null;
  const { data, error } = await db().from("store_claims").select("*").eq("store_id", storeId).maybeSingle();
  if (error) throw toAppError(error);
  return data ? toStoreClaim(data) : null;
}

/** Sets store_claims.verified_at and stores.claimed_at = now(). */
export async function markClaimVerified(storeId: string): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("store_claims")
    .update({ verified_at: now })
    .eq("store_id", storeId)
    .select("store_id")
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!data) throw new AppError("not_found", "No claim for this store", { store_id: storeId });
  const { error: storeErr } = await db().from("stores").update({ claimed_at: now }).eq("id", storeId);
  if (storeErr) throw toAppError(storeErr);
}

export async function setStoreOptOut(storeId: string, optedOut: boolean): Promise<void> {
  const { data, error } = await db()
    .from("stores")
    .update({ opted_out: optedOut })
    .eq("id", storeId)
    .select("id")
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!data) throw new AppError("not_found", "Store not found", { id: storeId });
}
