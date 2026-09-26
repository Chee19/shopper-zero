import "server-only";
import type {
  ApiErrorCode, CrawlContext, IndexedVariant, NormalizedVariant, Offer, VerifyOfferFn,
} from "@/contracts";
import { getVariantForVerify, updateVariantOffer } from "@/infrastructure/database";
import { variantKey } from "@/infrastructure/database/upsert-row";
import { log } from "@/shared/log";
import { adapters } from "./adapters";
import { AdapterError, OfferVerificationError, type OfferVerificationReason } from "./errors";
import { createFetcher, type BlockReason, type Fetcher } from "./fetch";
import { extractJsonLdProduct } from "./jsonld";
import { loadRobots, type RobotsInfo } from "./robots";
import { storeTarget } from "./url";

const DEFAULT_MAX_AGE_MS = 60_000;
const LIVE_BUDGET_MS = 8_000;
const ROBOTS_TTL_MS = 10 * 60_000;

interface OfferCacheEntry { offer: Offer; at: number }
const offerCache = new Map<string, OfferCacheEntry>();
interface RobotsCacheEntry { info: RobotsInfo; at: number }
const robotsCache = new Map<string, RobotsCacheEntry>();

// ponytail: sweep-on-write bounds these maps without a timer; fine at verifyOffer's call volume.
function purgeExpired<K>(map: Map<K, { at: number }>, ttlMs: number, now: number): void {
  for (const [k, v] of map) if (now - v.at > ttlMs) map.delete(k);
}

function setOfferCache(variantId: string, offer: Offer): void {
  const now = Date.now();
  purgeExpired(offerCache, DEFAULT_MAX_AGE_MS, now);
  offerCache.set(variantId, { offer, at: now });
}

async function robotsFor(fetcher: Fetcher, origin: string): Promise<RobotsInfo> {
  const now = Date.now();
  purgeExpired(robotsCache, ROBOTS_TTL_MS, now);
  const host = new URL(origin).host;
  const hit = robotsCache.get(host);
  if (hit) {
    fetcher.robots = hit.info;
    return hit.info;
  }
  const info = await loadRobots(fetcher, origin);
  robotsCache.set(host, { info, at: now });
  return info;
}

function fail(reason: OfferVerificationReason, code: ApiErrorCode, message: string, lastKnown: Offer | null): never {
  log.warn("crawl.verify.failed", { reason, code });
  throw new OfferVerificationError(reason, lastKnown, code, message);
}

// Maps a fetch/robots block into the §5.12 error table; "blocked" for bot protection, "unreachable" otherwise.
function failBlocked(blocked: BlockReason, lastKnown: Offer | null): never {
  if (blocked === "timeout" || blocked === "deadline") fail("unreachable", "upstream_timeout", "Store timed out", lastKnown);
  if (blocked === "robots" || blocked === "content_signal" || blocked === "challenge" || blocked === "forbidden") {
    fail("blocked", "upstream_blocked", "Store blocked the request", lastKnown);
  }
  fail("unreachable", "upstream_error", "Store unreachable", lastKnown);
}

const sortedOptions = (o: Record<string, string>) => JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

// §5.12 step 3: equal variantKey, then sku, then options, then "exactly one variant".
function matchVariant(candidates: NormalizedVariant[], existing: IndexedVariant): NormalizedVariant | null {
  const key = variantKey(existing);
  const byKey = candidates.find((c) => variantKey(c) === key);
  if (byKey) return byKey;
  if (existing.sku) {
    const bySku = candidates.find((c) => c.sku === existing.sku);
    if (bySku) return bySku;
  }
  if (Object.keys(existing.options).length) {
    const existingOptions = sortedOptions(existing.options);
    const byOptions = candidates.find((c) => sortedOptions(c.options) === existingOptions);
    if (byOptions) return byOptions;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function changedFrom(previous: Offer, offer: Offer): { price: boolean; availability: boolean } {
  return {
    price: previous.price.amount !== offer.price.amount || previous.price.currency !== offer.price.currency,
    availability: previous.availability !== offer.availability,
  };
}

// §5.12 step 3: adapter.fetchOffer when the strategy tier is platform_api, else GET + JSON-LD.
async function fetchLiveOffer(
  fetcher: Fetcher,
  row: NonNullable<Awaited<ReturnType<typeof getVariantForVerify>>>,
  deadline: number,
): Promise<Offer> {
  const { variant, product, store } = row;
  const target = storeTarget(store);
  await robotsFor(fetcher, target.origin);
  const adapter = store.strategy?.tier === "platform_api" && store.strategy.adapter ? adapters[store.strategy.adapter] : undefined;

  if (adapter?.fetchOffer) {
    const ctx: CrawlContext = {
      domain: store.domain, baseUrl: target.baseUrl, homepageHtml: "", headers: new Headers(),
      fetch: fetcher.asFetch(), log: () => {}, signal: AbortSignal.timeout(Math.max(0, deadline - Date.now())),
    };
    try {
      return await adapter.fetchOffer(ctx, { url: product.url, external_id: product.external_id }, variant.external_id);
    } catch (e) {
      if (e instanceof AdapterError && (e.httpStatus === 404 || e.httpStatus === 410)) {
        fail("variant_gone", "upstream_error", "Variant no longer exists", variant.offer);
      }
      fail("unreachable", "upstream_error", "Adapter lookup failed", variant.offer);
    }
  }

  const url = variant.offer.url ?? product.url;
  const res = await fetcher.get(url, { kind: "html", retries: 1 });
  if (res.blocked) failBlocked(res.blocked, variant.offer);
  if (!res.ok) {
    if (res.status === 404 || res.status === 410) fail("product_gone", "upstream_error", "Product page is gone", variant.offer);
    fail("unreachable", "upstream_error", `Store returned ${res.status}`, variant.offer);
  }
  const extracted = extractJsonLdProduct(res.body, res.finalUrl, {
    defaultCurrency: store.currency, checkedAt: new Date().toISOString(), baseUrl: target.baseUrl,
  });
  if (!extracted.product) fail("no_price", "upstream_error", `No price parsed (${extracted.miss})`, variant.offer);
  const matched = matchVariant(extracted.product.variants, variant);
  if (!matched) fail("variant_gone", "upstream_error", "Variant no longer matches the page", variant.offer);
  return matched.offer;
}

export async function verifyOfferDetailed(variantId: string, opts?: { maxAgeMs?: number }): Promise<{
  offer: Offer; previous: Offer; source: "live" | "cache";
  changed: { price: boolean; availability: boolean };
}> {
  const row = await getVariantForVerify(variantId);
  if (!row) fail("variant_not_found", "not_found", "Variant not found", null);
  const { variant, store } = row;
  const previous = variant.offer;
  if (store.opted_out) fail("opted_out", "forbidden", "The merchant has opted out of ShoperZero.", previous);

  const maxAgeMs = opts?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = Date.now();
  const cached = offerCache.get(variantId);
  if (cached && now - cached.at < maxAgeMs) {
    return { offer: cached.offer, previous, source: "cache", changed: { price: false, availability: false } };
  }
  if (now - new Date(previous.checked_at).getTime() < maxAgeMs) {
    return { offer: previous, previous, source: "cache", changed: { price: false, availability: false } };
  }

  const deadline = now + LIVE_BUDGET_MS;
  const fetcher = createFetcher({ deadline });
  const offer = await fetchLiveOffer(fetcher, row, deadline);

  await updateVariantOffer(variantId, offer);
  setOfferCache(variantId, offer);
  const changed = changedFrom(previous, offer);
  log.info("crawl.verify.done", { variant_id: variantId, store_id: store.id, changed });
  return { offer, previous, source: "live", changed };
}

export const verifyOffer: VerifyOfferFn = async (variantId) => (await verifyOfferDetailed(variantId)).offer;
