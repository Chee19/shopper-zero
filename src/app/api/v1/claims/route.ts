import { z } from "zod";
import { claimInstructions, type CheckResult, type ClaimView } from "@/components/claim/types";
import type { ClaimMethod, Store, StoreClaim } from "@/lib/contracts";
import { AppError, isAppError } from "@/lib/errors";
import { json, parseJsonBody, preflight, route } from "@/lib/http";
import { UI_MOCK } from "@/components/lib/flags";
import { MOCK_CLAIM_TOKEN, mockClaimView } from "@/app/(site)/_lib/mock";
import { checkDns, checkMeta } from "./_verify";

const Method = z.enum(["dns_txt", "meta_tag"]);
const Slug = z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/);
const ClaimRequest = z.discriminatedUnion("action", [
  z.object({ slug: Slug, action: z.literal("start"), method: Method.optional() }),
  z.object({ slug: Slug, action: z.literal("rotate"), method: Method }),
  z.object({ slug: Slug, action: z.literal("verify"), method: Method }),
  z.object({ slug: Slug, action: z.enum(["opt_out", "opt_in"]), method: Method }),
]);
type ClaimRequest = z.infer<typeof ClaimRequest>;

function view(store: Store, claim: StoreClaim): ClaimView {
  const host = new URL(store.base_url).hostname;
  return {
    slug: store.slug,
    domain: store.domain,
    status: claim.verified_at ? "verified" : "pending",
    token: claim.token,
    method: claim.method,
    verified_at: claim.verified_at,
    opted_out: store.opted_out,
    instructions: claimInstructions(host, claim.token),
  };
}

/** Either method verifies the same token, whatever the claim was created with (spec 05 §7.5). */
function check(method: ClaimMethod, host: string, token: string): Promise<CheckResult> {
  return method === "dns_txt" ? checkDns(host, token) : checkMeta(host, token);
}

/** Re-verification for opt-out/opt-in/rotate: the requested method first, then the other one. */
async function checkAny(preferred: ClaimMethod, host: string, token: string): Promise<CheckResult> {
  const first = await check(preferred, host, token);
  if (first.ok) return first;
  const second = await check(preferred === "dns_txt" ? "meta_tag" : "dns_txt", host, token);
  return second.ok ? second : first;
}

export const OPTIONS = preflight;

export const POST = route<unknown>("claims", async (req, _ctx, { requestId }) => {
  const body = await parseJsonBody(req, ClaimRequest);
  if (UI_MOCK) return json(mockResponse(body), { requestId });

  const db = await import("@/lib/db");
  const store = await db.getStoreBySlug(body.slug);
  if (!store) throw new AppError("not_found", `No store called ${body.slug}`);
  const host = new URL(store.base_url).hostname; // only the stored host is ever contacted, never user input

  switch (body.action) {
    case "start": {
      const claim = (await db.getClaim(store.id)) ?? (await db.getOrCreateClaim(store.id, body.method ?? "dns_txt"));
      return json({ claim: view(store, claim) }, { requestId });
    }
    case "rotate": {
      // Only pending claims rotate: rotating a verified claim would un-verify it while stores.claimed_at stays set.
      const current = await db.getClaim(store.id);
      if (current?.verified_at) throw new AppError("forbidden", "This store is already verified; its token can't be rotated");
      const claim = await db.upsertClaim(store.id, body.method);
      return json({ claim: view(store, claim) }, { requestId });
    }
    case "verify": {
      const claim = await db.getClaim(store.id);
      if (!claim) throw new AppError("not_found", "Start the claim first");
      const result = await check(body.method, host, claim.token);
      if (!result.ok) return json({ claim: view(store, claim), check: result }, { requestId });
      if (!claim.verified_at) {
        try {
          // Token-conditional: a rotate that landed during the check makes this throw `conflict`.
          await db.markClaimVerified(store.id, claim.token);
        } catch (e) {
          if (!(isAppError(e) && e.code === "conflict")) throw e;
          const fresh = (await db.getClaim(store.id)) ?? claim;
          const hint = "The token changed while we checked. Publish the new token and verify again.";
          return json({ claim: view(store, fresh), check: { ...result, ok: false, hint } }, { requestId });
        }
      }
      // Remember the method that actually verified (non-rotating update), so later re-checks use it.
      if (claim.method !== result.method) await db.getOrCreateClaim(store.id, result.method);
      const fresh = (await db.getClaim(store.id)) ?? claim;
      return json({ claim: view(store, fresh), check: result }, { requestId });
    }
    case "opt_out":
    case "opt_in": {
      const claim = await db.getClaim(store.id);
      if (!claim) throw new AppError("not_found", "Start the claim first");
      const result = await checkAny(body.method, host, claim.token);
      if (!result.ok) throw new AppError("forbidden", "Re-verification failed", { check: result });
      if (!claim.verified_at) await db.markClaimVerified(store.id, claim.token); // conflict (409) if rotated mid-check
      if (claim.method !== result.method) await db.getOrCreateClaim(store.id, result.method);
      await db.setStoreOptOut(store.id, body.action === "opt_out");
      const [freshStore, freshClaim] = await Promise.all([db.getStoreBySlug(store.slug), db.getClaim(store.id)]);
      return json({ claim: view(freshStore ?? store, freshClaim ?? claim), check: result }, { requestId });
    }
  }
});

/** UI_MOCK: fixture views; verify succeeds for tokens starting with "mock" (stateless). */
function mockResponse(body: ClaimRequest) {
  const base = mockClaimView(body.slug);
  if (!base) throw new AppError("not_found", `No store called ${body.slug}`);
  const ok = (method: ClaimMethod): CheckResult => ({ method, ok: base.token.startsWith("mock"), observed: [base.token] });
  const verified: ClaimView = { ...base, status: "verified", verified_at: new Date().toISOString() };
  switch (body.action) {
    case "start":
      return { claim: base };
    case "rotate": {
      const token = `${MOCK_CLAIM_TOKEN.slice(0, 4)}${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
      return { claim: mockClaimView(body.slug, { token, method: body.method }) };
    }
    case "verify":
      return { claim: { ...verified, method: body.method }, check: ok(body.method) };
    case "opt_out":
    case "opt_in":
      return { claim: { ...verified, opted_out: body.action === "opt_out" }, check: ok(body.method) };
  }
}
