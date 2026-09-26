import "server-only";
import { connection } from "next/server";
import type {
  CheckoutEvent, CheckoutSession, CrawlRun, IndexedProduct, ScanReport, Store, StoreSummary,
} from "@/components/lib/contracts";
import { REPLAY_ID_RE, SCAN_ID_RE } from "@/components/lib/flags";
import type { CheckoutReplay, ScanReplay } from "@/components/realtime/types";
import { loadCheckoutService, loadDb } from "./db";
import { UI_MOCK, appUrl } from "./env";
import {
  MOCK_CHECKOUTS, MOCK_SCANS, MOCK_STORES, mockProducts, mockScanReplay, mockStoreBySlug, withAppUrl,
} from "./mock";

export type ScanView = {
  scan: ScanReport;
  store: Store | null;
  run: CrawlRun | null;              // only when ?run= is present (indexing phase)
  replay: ScanReplay | null;         // only for replay ids
  /** Replays only: where "Replay complete" links (the real store page if it exists, the fixture page in mock mode). */
  replayStoreHref: string | null;
};

export const isUuid = (id: string) => SCAN_ID_RE.test(id);

export async function getScanView(id: string, runId?: string): Promise<ScanView | null> {
  await connection();
  if (REPLAY_ID_RE.test(id)) {
    const replay = mockScanReplay(id);
    if (!replay) return null;
    const store = withAppUrl(replay.store, appUrl());
    let replayStoreHref: string | null = null;
    if (UI_MOCK) {
      replayStoreHref = `/stores/${store.slug}?from_scan=${id}`;
    } else {
      const db = await loadDb();
      const real = await db.getStoreBySlug(store.slug).catch(() => null);
      if (real) replayStoreHref = `/stores/${real.slug}?from_scan=${id}`;
    }
    return {
      scan: replay.final,
      store,
      run: null,
      replay: { ...replay, store, indexing: { ...replay.indexing, store: withAppUrl(replay.indexing.store, appUrl()) } },
      replayStoreHref,
    };
  }
  if (!isUuid(id) || UI_MOCK) return null;
  const db = await loadDb();
  const scan = await db.getScan(id);
  if (!scan) return null;
  const [store, run] = await Promise.all([
    db.getStoreById(scan.store_id),
    runId && isUuid(runId) ? db.getCrawlRun(runId) : Promise.resolve(null),
  ]);
  return { scan, store, run: run && run.store_id === scan.store_id ? run : null, replay: null, replayStoreHref: null };
}

function mockSummary(s: Store): StoreSummary {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { readiness, strategy, dom_recipe, ...rest } = withAppUrl(s, appUrl());
  return { ...rest, grade_before: readiness.before?.grade ?? null, grade_after: readiness.after?.grade ?? null };
}

export async function getRecentStores(limit = 6): Promise<StoreSummary[]> {
  await connection();
  if (UI_MOCK) {
    return [...MOCK_STORES]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, limit)
      .map(mockSummary);
  }
  try {
    const db = await loadDb();
    const stores = await db.listStores({ limit: Math.max(limit, 20) });
    return stores.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, limit);
  } catch {
    return [];
  }
}

export async function listAllStores(limit = 50): Promise<StoreSummary[] | null> {
  await connection();
  if (UI_MOCK) return MOCK_STORES.slice(0, limit).map(mockSummary);
  try {
    const db = await loadDb();
    return await db.listStores({ limit });
  } catch {
    return null;
  }
}

export type StoreView = {
  store: Store;
  products: IndexedProduct[];
  total: number;
  scan: ScanReport | null;
  latestRun: CrawlRun | null;
};

export async function getStoreView(slug: string, fromScan?: string): Promise<StoreView | null> {
  await connection();
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return null;
  const replayScan = fromScan && REPLAY_ID_RE.test(fromScan) ? (MOCK_SCANS[fromScan] ?? null) : null;

  if (UI_MOCK) {
    const fixture = mockStoreBySlug(slug);
    if (!fixture) return null;
    const store = withAppUrl(fixture, appUrl());
    const products = store.opted_out ? [] : mockProducts(slug);
    const scan = replayScan ?? (store.latest_scan_id ? (MOCK_SCANS[store.latest_scan_id] ?? null) : null);
    return { store, products, total: products.length === 0 ? 0 : store.product_count, scan, latestRun: null };
  }

  const db = await loadDb();
  const store = await db.getStoreBySlug(slug);
  if (!store) return null;
  const [page, scan, latestRun] = await Promise.all([
    store.opted_out ? Promise.resolve({ products: [], total: 0 }) : db.listStoreProducts(store.id, { limit: 48, page: 1 }),
    replayScan
      ? Promise.resolve(replayScan)
      : fromScan && isUuid(fromScan)
        ? db.getScan(fromScan).then((s) => (s && s.store_id === store.id ? s : null))
        : db.getLatestScanForStore(store.id),
    store.status === "crawling" ? db.getLatestCrawlRun(store.id) : Promise.resolve(null),
  ]);
  return { store, products: page.products, total: page.total, scan, latestRun };
}

export async function getStoreBySlug(slug: string): Promise<Store | null> {
  await connection();
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return null;
  if (UI_MOCK) {
    const s = mockStoreBySlug(slug);
    return s ? withAppUrl(s, appUrl()) : null;
  }
  const db = await loadDb();
  return db.getStoreBySlug(slug);
}

export async function getCheckoutView(id: string): Promise<{ checkout: CheckoutSession | null; events: CheckoutEvent[] } | null> {
  await connection();
  if (!isUuid(id)) return null;
  if (UI_MOCK) {
    const r = Object.values(MOCK_CHECKOUTS).find((c) => c.checkout.id === id);
    return r ? { checkout: r.checkout, events: r.frames.map((f) => f.event) } : null;
  }
  const [db, svc] = await Promise.all([loadDb(), loadCheckoutService()]);
  let checkout: CheckoutSession | null = null;
  try {
    checkout = await svc.getCheckout(id);
  } catch {
    checkout = null;
  }
  const events = await svc.listCheckoutEvents(id).catch(() => db.listCheckoutEvents(id)).catch(() => []);
  return { checkout, events };
}

export function getCheckoutReplay(name: string): CheckoutReplay | null {
  return Object.prototype.hasOwnProperty.call(MOCK_CHECKOUTS, name) ? MOCK_CHECKOUTS[name]! : null;
}

/**
 * Newest checkout_events row's checkout_id. There is no db helper for it and direct selects are only allowed in WS5
 * client components (spec 00 §4.11), so follow mode resolves the latest checkout in the browser (public read).
 */
export async function getLatestCheckoutId(): Promise<string | null> {
  await connection();
  return null;
}

/** Request-time clock for relative times in server components (pages call this after their data reads). */
export function serverNow(): number {
  return Date.now();
}
