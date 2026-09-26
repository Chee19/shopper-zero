import "server-only";
import type {
  AccessMethod, CheckoutConnectorId, DomRecipe, Platform, ReadinessReport, Store, StoreStatus, StoreStrategy,
  StoreSummary,
} from "@/contracts";
import { LIST_STORES_MAX_LIMIT } from "@/contracts";
import { appUrl, flags } from "@/shared/env";
import { AppError, toAppError } from "@/shared/errors";
import { normalizeStoreUrl, type NormalizedStoreUrl } from "@/shared/slug";
import { db } from "@/infrastructure/database/client";
import { toStore, toStoreSummary, type StoreRow } from "@/infrastructure/database/mappers";
import { STORE_SELECT } from "@/infrastructure/database/selects";
import type { Json, TablesUpdate } from "@/infrastructure/database/types.gen";
import { asJson, clampInt, isMalformed, isUniqueViolation, isUuid } from "@/infrastructure/database/util";

/** WS2 CCR-2 / WS5 CCR-7: the one row → Store mapper for server code (= toStore(row, appUrl())). */
export function rowToStore(row: StoreRow): Store {
  return toStore(row, appUrl());
}

async function getStoreWhere(column: "id" | "slug" | "domain", value: string): Promise<Store | null> {
  const { data, error } = await db().from("stores").select(STORE_SELECT).eq(column, value).maybeSingle();
  if (error) {
    if (isMalformed(error)) return null;
    throw toAppError(error);
  }
  return data ? rowToStore(data) : null;
}

export async function getStoreById(id: string): Promise<Store | null> {
  if (!isUuid(id)) return null;
  return getStoreWhere("id", id);
}

export async function getStoreBySlug(slug: string): Promise<Store | null> {
  return getStoreWhere("slug", slug);
}

export async function getStoreByDomain(domain: string): Promise<Store | null> {
  return getStoreWhere("domain", domain);
}

/** ref = uuid | slug | domain | URL. Opted-out stores are returned (callers decide). */
export async function resolveStore(ref: string): Promise<Store | null> {
  const r = ref.trim();
  if (!r) return null;
  if (isUuid(r)) return getStoreById(r);
  if (r.includes(".") || r.includes("/")) {
    let domain: string;
    try {
      domain = normalizeStoreUrl(r, { allowPrivate: flags.allowPrivateStoreHosts() }).domain;
    } catch {
      return null;
    }
    return getStoreByDomain(domain);
  }
  return getStoreBySlug(r.toLowerCase());
}

/** Characters with meaning in a PostgREST or() filter or a LIKE pattern become the single-char wildcard. */
const ilikeTerm = (q: string): string => q.replace(/[%_*,()"'\\:]/g, "_");

export async function listStores(opts?: {
  query?: string; platform?: Platform; has_checkout?: boolean; status?: StoreStatus;
  include_opted_out?: boolean; limit?: number; offset?: number;
}): Promise<StoreSummary[]> {
  const o = opts ?? {};
  const limit = clampInt(o.limit, 1, LIST_STORES_MAX_LIMIT, 20);
  const offset = clampInt(o.offset, 0, Number.MAX_SAFE_INTEGER, 0);
  let q = db().from("stores").select(STORE_SELECT);
  const term = o.query?.trim();
  if (term) {
    const t = ilikeTerm(term);
    q = q.or(`name.ilike.%${t}%,domain.ilike.%${t}%`);
  }
  if (o.platform === "unknown") q = q.or("platform.is.null,platform.eq.unknown");
  else if (o.platform) q = q.eq("platform", o.platform);
  if (o.has_checkout === true) q = q.neq("checkout_connector", "handoff");
  else if (o.has_checkout === false) q = q.eq("checkout_connector", "handoff");
  if (o.status) q = q.eq("status", o.status);
  if (!o.include_opted_out) q = q.eq("opted_out", false);
  const { data, error } = await q
    .order("product_count", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw toAppError(error);
  const base = appUrl();
  return (data ?? []).map((row) => toStoreSummary(row, base));
}

const SLUG_MAX_ATTEMPTS = 20;

/** Find by normalized domain or insert {status:'pending'}; resolves slug collisions with -2, -3... */
export async function upsertStoreForUrl(rawUrl: string): Promise<{ store: Store; created: boolean }> {
  let n: NormalizedStoreUrl;
  try {
    n = normalizeStoreUrl(rawUrl, { allowPrivate: flags.allowPrivateStoreHosts() });
  } catch (e) {
    const reason = e instanceof Error ? e.message.replace(/^invalid_store_url:\s*/, "") : "invalid";
    throw new AppError("validation_error", "Invalid store URL", { url: rawUrl, reason });
  }
  const existing = await getStoreByDomain(n.domain);
  if (existing) return { store: existing, created: false };

  for (let attempt = 1; attempt <= SLUG_MAX_ATTEMPTS; attempt++) {
    const slug = attempt === 1 ? n.slug : `${n.slug}-${attempt}`;
    const { data, error } = await db()
      .from("stores")
      .insert({ domain: n.domain, base_url: n.base_url, slug, status: "pending", platform: null })
      .select(STORE_SELECT)
      .single();
    if (!error) return { store: rowToStore(data), created: true };
    if (!isUniqueViolation(error)) throw toAppError(error);
    // A 23505 on the domain means a concurrent request created the store first.
    if (/domain/.test(`${error.message} ${error.details ?? ""}`)) {
      const raced = await getStoreByDomain(n.domain);
      if (raced) return { store: raced, created: false };
    }
  }
  throw new AppError("conflict", "Could not allocate a unique store slug", { domain: n.domain, slug: n.slug });
}

export interface StorePatch {
  name?: string | null; platform?: Platform; currency?: string | null; country?: string | null;
  status?: StoreStatus; strategy?: StoreStrategy | null; checkout_connector?: CheckoutConnectorId;
  last_crawled_at?: string | null; opted_out?: boolean; metadata?: Record<string, unknown>;
  best_method?: AccessMethod | "none" | null; dom_recipe?: DomRecipe | null; latest_scan_id?: string | null;
  base_url?: string;                // redirect updates (WS2)
  checkout_methods?: string[];      // legacy init.sql column stores.checkout_methods (display only)
}

export async function updateStore(id: string, patch: StorePatch): Promise<Store> {
  const u: TablesUpdate<"stores"> = {};
  if (patch.name !== undefined) u.name = patch.name;
  if (patch.platform !== undefined) u.platform = patch.platform;
  if (patch.currency !== undefined) u.currency = patch.currency;
  if (patch.country !== undefined) u.country = patch.country;
  if (patch.status !== undefined) u.status = patch.status;
  if (patch.strategy !== undefined) u.strategy = asJson(patch.strategy);
  if (patch.checkout_connector !== undefined) u.checkout_connector = patch.checkout_connector;
  if (patch.last_crawled_at !== undefined) u.last_crawled_at = patch.last_crawled_at;
  if (patch.opted_out !== undefined) u.opted_out = patch.opted_out;
  if (patch.best_method !== undefined) u.best_method = patch.best_method;
  if (patch.dom_recipe !== undefined) u.dom_recipe = asJson(patch.dom_recipe);
  if (patch.latest_scan_id !== undefined) u.latest_scan_id = patch.latest_scan_id;
  if (patch.base_url !== undefined) u.base_url = patch.base_url;
  if (patch.checkout_methods !== undefined) u.checkout_methods = patch.checkout_methods;
  if (patch.metadata !== undefined) {
    // Merged, not replaced: one SQL update (metadata || patch), so concurrent writers keep each other's keys.
    await mergeStoreJson(id, { p_metadata: asJson(patch.metadata) });
  }
  if (Object.keys(u).length === 0) {
    const store = await getStoreById(id);
    if (!store) throw new AppError("not_found", "Store not found", { id });
    return store;
  }
  const { data, error } = await db().from("stores").update(u).eq("id", id).select(STORE_SELECT).maybeSingle();
  if (error) throw toAppError(error);
  if (!data) throw new AppError("not_found", "Store not found", { id });
  return rowToStore(data);
}

/** Merges into stores.readiness[phase] without touching the other phase (one SQL update). */
export async function setStoreReadiness(id: string, phase: "before" | "after", report: ReadinessReport): Promise<void> {
  await mergeStoreJson(id, { p_readiness: asJson({ [phase]: report }) });
}

/** Shallow jsonb merge into stores.metadata / stores.readiness (service-role RPC). Throws not_found. */
async function mergeStoreJson(id: string, patch: { p_metadata?: Json; p_readiness?: Json }): Promise<void> {
  if (!isUuid(id)) throw new AppError("not_found", "Store not found", { id });
  const { data, error } = await db().rpc("merge_store_json", { p_store_id: id, ...patch });
  if (error) throw toAppError(error);
  if (!data) throw new AppError("not_found", "Store not found", { id });
}
