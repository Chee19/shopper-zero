import "server-only";
import * as cheerio from "cheerio";
import type { Capabilities, Platform, ProbeSignal } from "@/lib/contracts";
import { NO_CAPABILITIES } from "@/lib/contracts";
import { wooApiBases, wooUrl } from "@/lib/crawl/adapters/woocommerce";
import { ROBOTS_TOKEN, type FetchKind, type FetchResult } from "@/lib/crawl/fetch";
import { parseSitemap } from "@/lib/crawl/sitemap";
import { assertPublicHost } from "@/lib/crawl/url";
import { flags } from "@/lib/env";
import { log } from "@/lib/log";
import { median, round1 } from "../estimate";
import { emptyProbe, statusFrom, type ProbeContext, type ProbeFn, type UcpDiscovery } from "../probe";
import { STANDARD_SIGNAL_IDS } from "../score";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untrusted store JSON, every field is checked before use
type J = Record<string, any>;

const BUDGET_MS = 25_000;
const REQUEST = { timeoutMs: 8000, retries: 1 };
const MCP_TIMEOUT_MS = 8000;
const MAX_RPC_CHARS = 1_000_000;
const BLOCKING = new Set(["challenge", "forbidden", "robots", "content_signal"]);

const LABELS = {
  ucp_profile: "UCP profile",
  ucp_capabilities: "UCP capabilities",
  mcp_endpoint: "MCP endpoint",
  acp_feed: "ACP product feed",
  products_json: "products.json",
  shopify_cart: "Shopify cart API",
  woo_store_api: "WooCommerce Store API",
  woo_cart: "WooCommerce cart API",
  magento_graphql: "Magento GraphQL",
  magento_cart: "Magento guest cart",
  squarespace_json: "Squarespace JSON",
  sfcc_product_variation: "SFCC Product-Variation",
  bigcommerce_cart: "BigCommerce cart API",
} as const;
type SignalId = keyof typeof LABELS;
const ORDER = Object.keys(LABELS);

const PLATFORM_SIGNALS: Partial<Record<Platform, SignalId[]>> = {
  woocommerce: ["woo_store_api", "woo_cart"],
  magento: ["magento_graphql", "magento_cart"],
  squarespace: ["squarespace_json"],
  sfcc: ["sfcc_product_variation"],
  bigcommerce: ["bigcommerce_cart"],
};

interface Outcome { ok: boolean; detail: string; url?: string; caps?: Partial<Capabilities>; products?: unknown[] }
interface Env {
  ctx: ProbeContext;
  base: string;
  origin: string;
  get(url: string, kind?: FetchKind, headers?: Record<string, string>): Promise<FetchResult>;
  getJson(url: string, headers?: Record<string, string>): Promise<{ res: FetchResult; data: unknown }>;
  seen(res: FetchResult): void;
  latency(ms: number): void;
}

export const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const list = (v: unknown): J[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object" && !Array.isArray(x)) : []);
const distinct = (xs: unknown[]) => new Set(xs.map(String)).size;
const clip = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}...` : s);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function parseJson(body: string): unknown {
  if (!body || body.trimStart().startsWith("<")) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export function failReason(res: FetchResult): string {
  return res.blocked ? `blocked: ${res.blocked}` : res.status ? `HTTP ${res.status}` : "no response";
}

// Resolves to fallback at the deadline or on abort, and never rejects.
export async function within<T>(p: Promise<T>, deadline: number, signal: AbortSignal, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  const stop = new Promise<T>((resolve) => {
    onAbort = () => resolve(fallback);
    if (signal.aborted) return resolve(fallback);
    signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(onAbort, Math.max(0, deadline - Date.now()));
  });
  try {
    return await Promise.race([p.catch(() => fallback), stop]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

// ---------- UCP profile and MCP server card, shared with checks.ts ----------

export function ucpDiscovery(ctx: ProbeContext): Promise<UcpDiscovery> {
  return (ctx.shared.ucp ??= discoverUcp(ctx));
}

async function discoverUcp(ctx: ProbeContext): Promise<UcpDiscovery> {
  const url = `${ctx.target.origin}/.well-known/ucp`;
  const res = await ctx.fetcher.get(url, { kind: "json", ...REQUEST });
  const profile = res.ok ? parseUcp(parseJson(res.body), url) : null;
  if (profile?.mcpEndpoint) return { url, res, profile, card: null };
  let card: UcpDiscovery["card"] = null;
  // Draft path, contested between the singular and plural file name (06 section 6).
  for (const name of ["server-card.json", "server-cards.json"]) {
    const cardUrl = `${ctx.target.origin}/.well-known/mcp/${name}`;
    const r = await ctx.fetcher.get(cardUrl, { kind: "json", ...REQUEST });
    const data = r.ok ? parseJson(r.body) : null;
    card = { url: cardUrl, res: r, ok: data !== null && typeof data === "object", endpoint: cardEndpoint(data, cardUrl) };
    if (card.ok) break;
  }
  return { url, res, profile, card };
}

function parseUcp(data: unknown, base: string): UcpDiscovery["profile"] {
  const ucp = obj(obj(data).ucp);
  if (typeof ucp.version !== "string") return null;
  const capabilities = Array.isArray(ucp.capabilities)
    ? list(ucp.capabilities).map((c) => String(c.name))
    : Object.keys(obj(ucp.capabilities));
  // 2026-08-25 lists {transport, endpoint} per service; the 2026-01 drafts nested {mcp: {endpoint}}.
  const mcp = Object.values(obj(ucp.services))
    .flatMap((s) => list(Array.isArray(s) ? s : [s]))
    .map((s) => (s.transport === "mcp" ? s.endpoint : obj(s.mcp).endpoint))
    .find((e): e is string => typeof e === "string" && URL.canParse(e, base));
  return { version: ucp.version, capabilities, mcpEndpoint: mcp ? new URL(mcp, base).href : null };
}

// UNVERIFIED: SEP-2127 is an open draft, so accept a registry-style remotes[].url or a top-level endpoint/url.
function cardEndpoint(data: unknown, base: string): string | null {
  const cards = Array.isArray(data) ? list(data) : [obj(data), ...list(obj(data).servers)];
  for (const c of cards) {
    for (const e of [...list(c.remotes).map((r) => r.url), c.endpoint, c.url]) {
      if (typeof e === "string" && URL.canParse(e, base)) return new URL(e, base).href;
    }
  }
  return null;
}

// ---------- MCP tools/list (the only non-GET request the api probe makes) ----------

const MCP_LIST = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const MCP_INIT = {
  jsonrpc: "2.0", id: 0, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: ROBOTS_TOKEN, version: "0.1" } },
};

async function mcpToolsList(endpoint: string, userAgent: string): Promise<{ tools: string[] | null; ms: number; detail: string }> {
  await assertPublicHost(endpoint, flags.allowPrivateStoreHosts());
  const post = async (msg: { id: number }, session: string | null) => {
    const started = Date.now();
    const res = await fetch(endpoint, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(MCP_TIMEOUT_MS),
      headers: {
        "User-Agent": userAgent, "Content-Type": "application/json", Accept: "application/json, text/event-stream",
        ...(session ? { "Mcp-Session-Id": session } : {}),
      },
      body: JSON.stringify(msg),
    });
    const reply = obj(await readRpc(res, msg.id));
    return { res, reply, ms: Date.now() - started };
  };
  const toolsOf = (reply: J) => (Array.isArray(obj(reply.result).tools) ? list(reply.result.tools).map((t) => String(t.name)) : null);

  let r = await post(MCP_LIST, null);
  let tools = toolsOf(r.reply);
  if (!tools) {
    // UNVERIFIED across servers: stateful ones want initialize first, then the session id on each request.
    const init = await post(MCP_INIT, null);
    if (init.res.ok) {
      r = await post(MCP_LIST, init.res.headers.get("mcp-session-id"));
      tools = toolsOf(r.reply);
    }
  }
  const error = typeof obj(r.reply.error).message === "string" ? `: ${r.reply.error.message}` : "";
  return { tools, ms: r.ms, detail: tools ? `${tools.length} tools via tools/list` : `tools/list failed (HTTP ${r.res.status}${error})` };
}

// Streamable HTTP may answer with SSE and keep the stream open, so stop at the first message carrying our id.
async function readRpc(res: Response, id: number): Promise<unknown> {
  if (!res.body) return null;
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const text = await res.text();
    return text.length > MAX_RPC_CHARS ? null : parseJson(text);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const match = (event: string) => {
    const data = event.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
    const msg = parseJson(data);
    return obj(msg).id === id ? msg : null;
  };
  let buf = "";
  try {
    while (buf.length < MAX_RPC_CHARS) {
      const { value, done } = await reader.read();
      if (done) return match(buf);
      buf += value;
      const events = buf.split(/\r?\n\r?\n/);
      buf = events.pop() ?? "";
      for (const ev of events) {
        const msg = match(ev);
        if (msg) return msg;
      }
    }
    return null;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

// ---------- signals (02 section 6.3 table) ----------

const SHOPIFY_CURRENCY = /Shopify\.currency\s*=\s*\{"active":"([A-Z]{3})"/;
const META_CURRENCY = /itemprop=["']priceCurrency["'][^>]*content=["']([A-Z]{3})["']/i;
const MAGENTO_PROBE_QUERY = `{ products(search: "", pageSize: 5, currentPage: 1) { total_count items {
  __typename sku name stock_status description { html } image { url }
  price_range { minimum_price { final_price { value currency } } } } } }`;
const MAGENTO_CART_QUERY = '{cart(cart_id:"shoperzero-probe"){id}}';
const JSON_CT = { "Content-Type": "application/json" };
const SQUARESPACE_COLLECTION = /\/([^/]+)\/p\/[^/]+$/;
const SFCC_SITE = /\/on\/demandware\.store\/(Sites-[A-Za-z0-9_-]+-Site)\/([A-Za-z]{2}(?:_[A-Za-z]{2})?|default)\//;
const SFCC_PID = /\/([A-Za-z0-9_\-.]+)\.html(?:$|\?)/;

// 02 section 5.5.5 lookup order: homepage script, cart.js, then priceCurrency meta.
async function shopifyCurrency(e: Env): Promise<string | null> {
  const html = e.ctx.detection.homepage.html;
  const fromHtml = SHOPIFY_CURRENCY.exec(html)?.[1];
  if (fromHtml) return fromHtml;
  const { res, data } = await e.getJson(`${e.base}/cart.js`);
  const c = obj(data).currency;
  if (res.ok && typeof c === "string" && /^[A-Z]{3}$/.test(c)) return c;
  return META_CURRENCY.exec(html)?.[1] ?? null;
}

async function wooListing(e: Env): Promise<{ api: string | null; url: string | null; res: FetchResult | null; items: J[] }> {
  const hit = e.ctx.detection.probes.woocommerce;
  const bases = wooApiBases(e.base);
  const first = hit?.ok ? bases.find((a) => hit.url.startsWith(a)) : undefined;
  let res: FetchResult | null = null;
  for (const api of first ? [first, ...bases.filter((b) => b !== first)] : bases) {
    const url = wooUrl(api, "/products", { per_page: 5 });
    const r = await e.getJson(url);
    res = r.res;
    if (r.res.ok && Array.isArray(r.data)) return { api, url, res, items: list(r.data) };
  }
  return { api: null, url: null, res, items: [] };
}

async function sfccPids(e: Env): Promise<string[]> {
  const queue = e.ctx.robots.sitemaps.length ? [...e.ctx.robots.sitemaps] : [`${e.base}/sitemap_index.xml`];
  const pids = new Set<string>();
  for (let fetched = 0; queue.length && fetched < 3 && pids.size < 3; fetched++) {
    const res = await e.get(queue.shift()!, "xml");
    const parsed = res.ok ? parseSitemap(res.body) : null;
    if (!parsed) continue;
    const product = parsed.sitemaps.filter((u) => /product/i.test(u));
    queue.unshift(...(product.length ? product : parsed.sitemaps.slice(0, 2)));
    for (const u of parsed.urls) {
      const m = SFCC_PID.exec(u.loc);
      if (m) pids.add(m[1]);
    }
  }
  return [...pids];
}

const SIGNALS: Record<SignalId, (e: Env) => Promise<Outcome>> = {
  async ucp_profile(e) {
    const d = await ucpDiscovery(e.ctx);
    e.seen(d.res);
    if (!d.profile) return { ok: false, detail: d.res.ok ? "/.well-known/ucp has no ucp.version" : `No UCP profile (${failReason(d.res)})` };
    return { ok: true, url: d.url, detail: `UCP ${d.profile.version}` };
  },

  async ucp_capabilities(e) {
    const { url, profile } = await ucpDiscovery(e.ctx);
    if (!profile) return { ok: false, detail: "No UCP profile" };
    const has = (c: string) => profile.capabilities.includes(`dev.ucp.shopping.${c}`);
    if (!has("catalog.search") && !has("catalog.lookup")) return { ok: false, url, detail: "UCP profile declares no catalog capability" };
    return {
      ok: true, url, detail: "inferred from UCP spec",
      caps: { catalog: true, product_detail: true, price_availability: true, cart: has("cart"), checkout_reachable: has("checkout") },
    };
  },

  async mcp_endpoint(e) {
    const d = await ucpDiscovery(e.ctx);
    if (d.card) e.seen(d.card.res);
    const endpoint = d.profile?.mcpEndpoint ?? d.card?.endpoint ?? null;
    if (!endpoint) return { ok: false, detail: d.card?.ok ? "MCP server card has no endpoint URL" : "No MCP endpoint advertised" };
    if (!e.ctx.robots.isAllowed(endpoint)) return { ok: false, url: endpoint, detail: "MCP endpoint disallowed by robots.txt" };
    const r = await mcpToolsList(endpoint, e.ctx.fetcher.userAgent);
    if (!r.tools) return { ok: false, url: endpoint, detail: r.detail };
    e.latency(r.ms);
    const t = new Set(r.tools);
    const detail = t.has("get_product") || t.has("lookup_catalog");
    return {
      ok: true, url: endpoint, detail: r.detail,
      caps: {
        catalog: t.has("search_catalog"), product_detail: detail, price_availability: detail,
        cart: t.has("create_cart"), checkout_reachable: t.has("create_checkout"),
      },
    };
  },

  async acp_feed(e) {
    const home = e.ctx.detection.homepage;
    const pageUrl = home.finalUrl || `${e.base}/`;
    const $ = cheerio.load(home.html);
    const links = $('link[rel~="alternate"]')
      .filter((_, el) => /^application\/(x-ndjson|jsonl)\b/i.test($(el).attr("type") ?? ""))
      .map((_, el) => $(el).attr("href") ?? "").get()
      .filter((h) => URL.canParse(h, pageUrl))
      .map((h) => new URL(h, pageUrl).href);
    // UNVERIFIED: ACP feeds are pushed, not discoverable, so the well-known path is speculative (06 section 4).
    for (const url of [...links.slice(0, 2), `${e.origin}/.well-known/acp.json`]) {
      const res = await e.get(url, "text");
      if (!res.ok) continue;
      const whole = parseJson(res.body);
      const rows = Array.isArray(whole) ? list(whole) : list(res.body.split("\n", 200).map(parseJson));
      const valid = rows.filter((r) => r.item_id != null && r.price != null && r.availability != null);
      if (!valid.length) continue;
      return {
        ok: true, url, detail: `${valid.length} ACP feed rows sampled`, products: valid.map((r) => r.item_id),
        caps: { catalog: distinct(valid.map((r) => r.item_id)) >= 3, price_availability: valid.some((r) => r.availability !== "unknown") },
      };
    }
    return { ok: false, detail: links.length ? "Feed link has no ACP rows" : "No ACP feed advertised" };
  },

  async products_json(e) {
    const url = `${e.base}/products.json?limit=5`;
    const { res, data } = await e.getJson(url);
    const items = res.ok ? list(obj(data).products) : [];
    const priced = items.filter((p) => list(p.variants).some((v) => v.price != null && typeof v.available === "boolean"));
    if (!priced.length) return { ok: false, url, detail: res.ok ? "products.json lists no priced products" : `No products.json (${failReason(res)})` };
    const handle = priced[0].handle;
    const [page, currency] = await Promise.all([
      typeof handle === "string" ? e.get(`${e.base}/products/${encodeURIComponent(handle)}.js`) : null,
      shopifyCurrency(e),
    ]);
    return {
      ok: true, url, detail: `${items.length} products listed, currency ${currency ?? "unknown"}`,
      products: items.map((p) => p.id ?? p.handle),
      caps: {
        catalog: distinct(items.map((p) => p.id ?? p.handle)) >= 3, product_detail: !!page?.ok,
        price_availability: !!currency, variants: items.some((p) => list(p.variants).length > 1),
      },
    };
  },

  async shopify_cart(e) {
    const url = `${e.base}/cart.js`;
    const { res, data } = await e.getJson(url);
    if (!res.ok || !Array.isArray(obj(data).items)) return { ok: false, url, detail: res.ok ? "cart.js has no items array" : `No cart.js (${failReason(res)})` };
    return { ok: true, url, detail: "inferred (Shopify)", caps: { cart: true, checkout_reachable: true } };
  },

  async woo_store_api(e) {
    const w = await wooListing(e);
    if (!w.api) return { ok: false, detail: `No Store API (${w.res ? failReason(w.res) : "no response"})` };
    const priced = w.items.filter((p) => obj(p.prices).price != null);
    if (!priced.length) return { ok: false, url: w.url ?? undefined, detail: "Store API lists no priced products" };
    const page = await e.get(wooUrl(w.api, `/products/${priced[0].id}`));
    return {
      ok: true, url: w.url ?? undefined, detail: `${w.items.length} products listed`, products: w.items.map((p) => p.id),
      caps: {
        catalog: distinct(w.items.map((p) => p.id)) >= 3, product_detail: page.ok,
        price_availability: priced.some((p) => typeof obj(p.prices).currency_code === "string" && typeof p.is_in_stock === "boolean"),
        variants: w.items.some((p) => p.type === "variable" && list(p.variations).length > 0),
      },
    };
  },

  async woo_cart(e) {
    const w = await wooListing(e);
    const url = wooUrl(w.api ?? wooApiBases(e.base)[0], "/cart");
    const res = await e.get(url);
    if (!res.ok || !res.headers.get("cart-token")) return { ok: false, url, detail: res.ok ? "No Cart-Token header" : `Cart API unavailable (${failReason(res)})` };
    // We never GET /checkout in a scan: on the Store API that creates a draft order.
    return { ok: true, url, detail: "inferred: Store API /checkout", caps: { cart: true, checkout_reachable: true } };
  },

  async magento_graphql(e) {
    const url = `${e.base}/graphql?query=${encodeURIComponent(MAGENTO_PROBE_QUERY)}`;
    const { res, data } = await e.getJson(url, JSON_CT);
    const items = res.ok ? list(obj(obj(obj(data).data).products).items) : [];
    const price = (i: J) => obj(obj(obj(i.price_range).minimum_price).final_price);
    const priced = items.filter((i) => price(i).value != null && typeof i.stock_status === "string");
    if (!priced.length) {
      const gqlError = list(obj(data).errors)[0]?.message;
      const detail = gqlError ? `GraphQL error: ${gqlError}` : res.ok ? "GraphQL lists no priced products" : `No GraphQL (${failReason(res)})`;
      return { ok: false, url, detail };
    }
    return {
      ok: true, url, detail: `${items.length} products listed`, products: items.map((i) => i.sku),
      caps: {
        catalog: distinct(items.map((i) => i.sku)) >= 3, product_detail: items.some((i) => typeof i.name === "string"),
        price_availability: priced.some((i) => typeof price(i).currency === "string"),
        variants: items.some((i) => i.__typename === "ConfigurableProduct"),
      },
    };
  },

  async magento_cart(e) {
    const url = `${e.base}/graphql?query=${encodeURIComponent(MAGENTO_CART_QUERY)}`;
    const { res, data } = await e.getJson(url, JSON_CT);
    const message = String(list(obj(data).errors)[0]?.message ?? "");
    // UNVERIFIED: a "cart not found" error is taken as proof the guest cart API exists.
    if (!/could not find a cart|cart_id/i.test(message)) return { ok: false, url, detail: `No guest cart API (${message || failReason(res)})` };
    return { ok: true, url, detail: "inferred", caps: { cart: true, checkout_reachable: true } };
  },

  async squarespace_json(e) {
    const sitemap = await e.get(`${e.base}/sitemap.xml`, "xml");
    const fromSitemap = (sitemap.ok ? parseSitemap(sitemap.body)?.urls ?? [] : []).flatMap((u) => {
      const m = URL.canParse(u.loc) ? SQUARESPACE_COLLECTION.exec(new URL(u.loc).pathname) : null;
      return m ? [m[1]] : [];
    });
    let last: FetchResult | null = null;
    for (const collection of [...new Set([...fromSitemap, "shop", "store", "products"])].slice(0, 4)) {
      const url = `${e.base}/${collection}?format=json`;
      const { res, data } = await e.getJson(url);
      last = res;
      const items = res.ok ? list(obj(data).items).filter((i) => list(i.variants).length) : [];
      const variants = (i: J) => list(i.variants);
      if (!items.some((i) => variants(i).some((v) => obj(v.priceMoney).value != null))) continue;
      return {
        ok: true, url, detail: `${items.length} products in /${collection}`, products: items.map((i) => i.id),
        caps: {
          catalog: distinct(items.map((i) => i.id)) >= 3, product_detail: items.some((i) => typeof i.title === "string"),
          price_availability: items.some((i) => variants(i).some((v) =>
            typeof obj(v.priceMoney).currency === "string" && (v.unlimited === true || typeof v.qtyInStock === "number"))),
          variants: items.some((i) => variants(i).length > 1),
        },
      };
    }
    return { ok: false, detail: last && !last.ok ? `No shop collection JSON (${failReason(last)})` : "No shop collection with priced variants" };
  },

  async sfcc_product_variation(e) {
    const site = SFCC_SITE.exec(e.ctx.detection.homepage.html);
    if (!site) return { ok: false, detail: "No SFCC site id on the homepage" };
    const pids = await sfccPids(e);
    if (!pids.length) return { ok: false, detail: "No product .html URLs in the sitemap" };
    const url = `${e.origin}/on/demandware.store/${site[1]}/${site[2]}/Product-Variation?pid=${encodeURIComponent(pids[0])}&quantity=1`;
    const { res, data } = await e.getJson(url);
    const p = obj(obj(data).product);
    const sales = obj(obj(p.price).sales ?? obj(obj(p.price).min).sales);
    if (!res.ok || typeof p.productName !== "string" || sales.value == null || typeof p.available !== "boolean") {
      return { ok: false, url, detail: res.ok ? "Product-Variation returned no priced product" : `Product-Variation unavailable (${failReason(res)})` };
    }
    return {
      ok: true, url, detail: `Product ${pids[0]} priced via Product-Variation`, products: [pids[0]],
      caps: {
        catalog: pids.length >= 3, product_detail: true,
        price_availability: typeof sales.currency === "string", variants: list(p.variationAttributes).length > 0,
      },
    };
  },

  async bigcommerce_cart(e) {
    const url = `${e.origin}/api/storefront/carts`;
    const { res, data } = await e.getJson(url);
    if (!res.ok || !Array.isArray(data)) return { ok: false, url, detail: res.ok ? "Cart API did not return an array" : `No cart API (${failReason(res)})` };
    return { ok: true, url, detail: "Storefront cart API answers", caps: { cart: true } };
  },
};

// ---------- probe ----------

export const apiProbe: ProbeFn = async (ctx) => {
  const started = Date.now();
  const deadline = Math.min(ctx.deadline, started + BUDGET_MS);
  const caps: Capabilities = { ...NO_CAPABILITIES };
  const signals: ProbeSignal[] = [];
  const products = new Set<string>();
  const latencies: number[] = [];
  let blocked = false;
  let done = false;

  const memo = new Map<string, Promise<FetchResult>>();
  const env: Env = {
    ctx, base: ctx.target.baseUrl, origin: ctx.target.origin,
    seen(res) {
      if (done) return;
      if (res.ok) latencies.push(res.ms);
      if (res.blocked && BLOCKING.has(res.blocked)) blocked = true;
    },
    latency(ms) {
      if (!done) latencies.push(ms);
    },
    get(url, kind = "json", headers) {
      let p = memo.get(url);
      if (!p) {
        p = ctx.fetcher.get(url, { kind, headers, ...REQUEST }).then((res) => {
          env.seen(res);
          return res;
        });
        memo.set(url, p);
      }
      return p;
    },
    async getJson(url, headers) {
      const res = await env.get(url, "json", headers);
      return { res, data: parseJson(res.body) };
    },
  };

  const record = (id: SignalId, o: Outcome) => {
    if (done) return;
    signals.push({ id, label: LABELS[id], ok: o.ok, detail: clip(o.detail), ...(o.url ? { url: o.url } : {}) });
    signals.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
    if (o.ok) {
      for (const [k, v] of Object.entries(o.caps ?? {})) if (v) caps[k as keyof Capabilities] = true;
      for (const p of o.products ?? []) if (p != null) products.add(String(p));
    }
    const patch = { signals: [...signals], capabilities: { ...caps } };
    Promise.resolve()
      .then(() => ctx.update(patch))
      .catch((err) => log.warn("scan.api.update_failed", { scan_id: ctx.scanId, error: errMsg(err) }));
  };

  const detected = [ctx.detection.platform, ...Object.entries(ctx.detection.probes).filter(([, p]) => p.ok).map(([k]) => k)];
  const ids = [
    ...(STANDARD_SIGNAL_IDS as SignalId[]),
    ...[...new Set(detected)].flatMap((p) => PLATFORM_SIGNALS[p as Platform] ?? []),
  ];
  const runs = ids.map((id) => SIGNALS[id](env)
    .catch((err): Outcome => ({ ok: false, detail: `Probe error: ${errMsg(err)}` }))
    .then((o) => record(id, o)));
  await within(Promise.all(runs), deadline, ctx.signal, []);
  for (const id of ids) if (!signals.some((s) => s.id === id)) record(id, { ok: false, detail: "Timed out" });
  done = true;

  const finished = Date.now();
  const empty = emptyProbe("api");
  return {
    ...empty,
    status: statusFrom(caps, blocked),
    started_at: new Date(started).toISOString(),
    finished_at: new Date(finished).toISOString(),
    duration_ms: finished - started,
    signals,
    capabilities: caps,
    sample_products: Math.min(products.size, 5),
    endpoints: [...new Set(signals.flatMap((s) => (s.ok && s.url ? [s.url] : [])))],
    est_seconds_per_task: latencies.length ? round1((3 * median(latencies)) / 1000) : empty.est_seconds_per_task,
    est_usd_per_task: 0,
  };
};
