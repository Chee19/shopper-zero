/* eslint-disable @typescript-eslint/no-unused-vars -- stub parameters, removed with the T+60 bodies */
import "server-only";
import type {
  AccessMethod, CheckoutConnectorId, DomRecipe, Platform, ReadinessReport, Store, StoreStatus, StoreStrategy,
  StoreSummary,
} from "@/lib/contracts";
import { appUrl } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { toStore, type StoreRow } from "./mappers";

/** WS2 CCR-2 / WS5 CCR-7: the one row → Store mapper for server code (= toStore(row, appUrl())). */
export function rowToStore(row: StoreRow): Store {
  return toStore(row, appUrl());
}

// TODO(WS1 T+60)
export async function getStoreById(id: string): Promise<Store | null> {
  throw new AppError("not_implemented", "getStoreById");
}

// TODO(WS1 T+60)
export async function getStoreBySlug(slug: string): Promise<Store | null> {
  throw new AppError("not_implemented", "getStoreBySlug");
}

// TODO(WS1 T+60)
export async function getStoreByDomain(domain: string): Promise<Store | null> {
  throw new AppError("not_implemented", "getStoreByDomain");
}

// TODO(WS1 T+60)
/** ref = uuid | slug | domain | URL. Opted-out stores are returned (callers decide). */
export async function resolveStore(ref: string): Promise<Store | null> {
  throw new AppError("not_implemented", "resolveStore");
}

// TODO(WS1 T+60)
export async function listStores(opts?: {
  query?: string; platform?: Platform; has_checkout?: boolean; status?: StoreStatus;
  include_opted_out?: boolean; limit?: number; offset?: number;
}): Promise<StoreSummary[]> {
  throw new AppError("not_implemented", "listStores");
}

// TODO(WS1 T+60)
/** Find by normalized domain or insert {status:'pending'}; resolves slug collisions with -2, -3... */
export async function upsertStoreForUrl(rawUrl: string): Promise<{ store: Store; created: boolean }> {
  throw new AppError("not_implemented", "upsertStoreForUrl");
}

export interface StorePatch {
  name?: string | null; platform?: Platform; currency?: string | null; country?: string | null;
  status?: StoreStatus; strategy?: StoreStrategy | null; checkout_connector?: CheckoutConnectorId;
  last_crawled_at?: string | null; opted_out?: boolean; metadata?: Record<string, unknown>;
  best_method?: AccessMethod | "none" | null; dom_recipe?: DomRecipe | null; latest_scan_id?: string | null;
  base_url?: string;                // redirect updates (WS2)
  checkout_methods?: string[];      // legacy init.sql column stores.checkout_methods (display only)
}

// TODO(WS1 T+60)
export async function updateStore(id: string, patch: StorePatch): Promise<Store> {
  throw new AppError("not_implemented", "updateStore");
}

// TODO(WS1 T+60)
/** Merges into stores.readiness[phase] without touching the other phase. */
export async function setStoreReadiness(id: string, phase: "before" | "after", report: ReadinessReport): Promise<void> {
  throw new AppError("not_implemented", "setStoreReadiness");
}
