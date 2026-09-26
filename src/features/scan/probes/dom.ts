import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Usage } from "@anthropic-ai/sdk/resources/messages";
import * as cheerio from "cheerio";
import { z } from "zod";
import type { AccessProbe, Capabilities, DomRecipe, NormalizedProduct, ProbeSignal } from "@/contracts";
import { NO_CAPABILITIES } from "@/contracts";
import type { FetchResult } from "@/features/crawl/fetch";
import { extractJsonLdProduct } from "@/features/crawl/jsonld";
import { modeCurrency } from "@/features/crawl/normalize";
import { discoverProductUrls, productUrlScore, sameSite, type DiscoveryResult } from "@/features/crawl/sitemap";
import { canonicalizeProductUrl } from "@/features/crawl/url";
import { optionalEnv, requireEnv } from "@/shared/env";
import { isAppError } from "@/shared/errors";
import { log } from "@/shared/log";
import { acpPrice } from "@/shared/money";
import { median, round1, UsageMeter } from "../estimate";
import { CHECKOUT_URL_RE, PAYMENT_IFRAME_RE } from "../guard";
import { buildOutline, readPrice, select, squash, validateRecipe, type Page, type PageKind, type Pages } from "../outline";
import { emptyProbe, statusFrom, type ProbeContext, type ProbeFn } from "../probe";
import { failReason, within } from "./api";

type ProbeError = NonNullable<AccessProbe["error"]>;
type PdpSample = NonNullable<ProbeContext["shared"]["pdpSample"]>;
export interface Tally { ms: number[]; blocked: boolean }

const STAGE_A_MS = 20_000;
// R15 cut the browser stage C, so stage B may run until this much of the probe budget is left for HTTP verification.
const VERIFY_RESERVE_MS = 10_000;
const MIN_MODEL_MS = 5_000;
const RECIPE_MODEL = "claude-sonnet-5";
const PAGE_ORDER: PageKind[] = ["home", "listing", "pdp", "cart"];
const LISTING_PATH = /\/(shop|store|collections?|category|categories|products?)(\/|$)/i;
const LISTING_FALLBACKS = ["/shop", "/collections/all", "/products"];
const CART_PATHS = ["/cart", "/cart.php", "/basket", "/checkout/cart", "/bag"];
const CURRENCY_HINT = /\p{Sc}|\b[A-Z]{3}\b/u;
// Email inputs also sit in newsletter footers and login forms, so only address fields mark a checkout page.
const CHECKOUT_FIELDS = 'input[autocomplete~="address-line1"], input[autocomplete~="street-address"], input[autocomplete~="postal-code"]';

const clip = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}...` : s);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isHtml = (res: FetchResult) => res.ok && /html/i.test(res.headers.get("content-type") ?? "");

async function getPage(ctx: ProbeContext, tally: Tally, url: string, deadline: number): Promise<FetchResult> {
  const res = await ctx.fetcher.get(url, { kind: "html", retries: 1, timeoutMs: Math.max(1000, deadline - Date.now()) });
  if (res.status) tally.ms.push(res.ms);
  if (res.blocked === "challenge" || res.blocked === "forbidden") tally.blocked = true;
  return res;
}

// ---------- stage A: sitemap + JSON-LD over HTTP ----------

export interface StageA {
  discovery: DiscoveryResult | null;
  pdps: PdpSample;
  products: NormalizedProduct[];
  currency: string | null;
  caps: Capabilities;
  signals: ProbeSignal[];
}

async function samplePdps(ctx: ProbeContext, tally: Tally, d: DiscoveryResult, deadline: number): Promise<PdpSample> {
  const score = (u: string) => productUrlScore(u, ctx.detection.platform);
  const urls = d.urls.map((u) => u.loc).sort((a, b) => score(b) - score(a)).slice(0, 3);
  const checkedAt = new Date().toISOString();
  return Promise.all(urls.map(async (url) => {
    const res = await getPage(ctx, tally, url, deadline);
    if (!res.ok) return { url, html: "", product: null, miss: res.blocked ?? `http_${res.status}` };
    const r = extractJsonLdProduct(res.body, res.finalUrl, { defaultCurrency: ctx.store.currency, checkedAt, baseUrl: ctx.target.baseUrl });
    return { url, html: res.body, product: r.product, miss: r.miss };
  }));
}

export async function stageA(ctx: ProbeContext, tally: Tally, deadline: number): Promise<StageA> {
  const { detection } = ctx;
  const discovery = ctx.shared.discovery ?? await within(discoverProductUrls(ctx.fetcher, ctx.target, ctx.robots, {
    platform: detection.platform, hint: detection.hint, max: 50, homepageHtml: detection.homepage.html,
    budgetMs: Math.max(0, deadline - Date.now() - 5000),
  }), deadline - 3000, ctx.signal, null);
  const pdps = ctx.shared.pdpSample
    ?? (discovery ? await within(samplePdps(ctx, tally, discovery, deadline), deadline, ctx.signal, []) : []);
  if (pdps.some((p) => p.miss === "challenge" || p.miss === "forbidden")) tally.blocked = true;

  const products = pdps.flatMap((p) => (p.product ? [p.product] : []));
  const k = products.length;
  const n = discovery?.urls.length ?? 0;
  const priced = products.find((p) => p.variants.some((v) => v.offer.availability !== "unknown"));
  const offer = priced?.variants.find((v) => v.offer.availability !== "unknown")?.offer;
  const multi = products.find((p) => p.variants.length > 1);
  const signals: ProbeSignal[] = [
    {
      id: "sitemap_products", label: "Product URLs in sitemap", ok: n > 0,
      detail: discovery ? `${n} product URLs${discovery.source === "html_links" ? " (homepage links, no sitemap)" : ""}` : "Discovery timed out",
    },
    {
      id: "jsonld_product", label: "JSON-LD Product on product pages", ok: k > 0,
      detail: pdps.length ? `${k}/${pdps.length} pages` : "No product pages to sample", ...(products[0] ? { url: products[0].url } : {}),
    },
    {
      id: "jsonld_offer", label: "JSON-LD price and availability", ok: !!offer,
      detail: offer ? `${acpPrice(offer.price)}, ${offer.availability}` : "No offer with a price and a known availability",
      ...(priced ? { url: priced.url } : {}),
    },
    {
      id: "jsonld_variants", label: "JSON-LD variants", ok: !!multi,
      detail: multi ? clip(`${multi.variants.length} variants on "${multi.title}"`) : "No product with more than one variant",
      ...(multi ? { url: multi.url } : {}),
    },
  ];
  const caps: Capabilities = {
    ...NO_CAPABILITIES,
    catalog: n >= 3 && k >= 1,
    product_detail: k >= 1,
    price_availability: !!offer,
    variants: !!multi,
  };
  return { discovery, pdps, products, currency: ctx.store.currency ?? modeCurrency(products), caps, signals };
}

// ---------- stage B: Claude maps selectors from page outlines ----------

const RecipeSchema = z.object({
  search_input: z.string().nullable(), product_card: z.string().nullable(), product_link: z.string().nullable(),
  title: z.string().nullable(), price: z.string().nullable(), variant_picker: z.string().nullable(),
  add_to_cart: z.string().nullable(), cart_link: z.string().nullable(), checkout_link: z.string().nullable(),
  notes: z.string().describe("One or two sentences on anything unusual, e.g. 'add to cart is an AJAX drawer'."),
});
export type Recipe = z.infer<typeof RecipeSchema>;

const SYSTEM = `You map an online store's page structure for an AI shopping agent.
You get compact outlines of the home, listing, product and cart pages. Return one CSS selector per field.
Prefer stable selectors: #id, [name=], [data-*], [aria-label], [itemprop], form[action*=], href patterns.
Avoid :nth-child and generated class names (random hashes). product_link must match anchors that open product
pages from the home or listing page; product_card the repeating card element; title and price are on the product
page; variant_picker the size/colour control; add_to_cart the product page's add button or submit; cart_link the
header cart/bag link; checkout_link the cart page's proceed-to-checkout link. Use null when absent.
Never return selectors for payment, login or personal-data fields.`;

export interface Outline { page: PageKind; url: string; outline: string }
export interface RecipeResult { recipe: Recipe | null; usage: Usage | null; error: ProbeError | null }

export async function buildRecipe(outlines: Outline[], opts: { signal: AbortSignal; timeoutMs: number }): Promise<RecipeResult> {
  const fail = (code: string, message: string, usage: Usage | null = null): RecipeResult => ({ recipe: null, usage, error: { code, message } });
  // The SDK parser throws on truncated or refused output; returning null lets stop_reason be checked first.
  const format = {
    ...zodOutputFormat(RecipeSchema),
    parse: (text: string): Recipe | null => {
      try {
        return RecipeSchema.parse(JSON.parse(text));
      } catch {
        return null;
      }
    },
  };
  try {
    const client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
    const res = await client.messages.parse({
      model: RECIPE_MODEL,
      max_tokens: 8000,
      output_config: { effort: "low", format },
      system: SYSTEM,
      messages: [{ role: "user", content: outlines.map((o) => `### ${o.page} (${o.url})\n${o.outline}`).join("\n\n") }],
    }, { signal: opts.signal, timeout: opts.timeoutMs });
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") {
      return fail(res.stop_reason, `The recipe call stopped with ${res.stop_reason}.`, res.usage);
    }
    if (!res.parsed_output) return fail("invalid_output", "The recipe did not match the expected schema.", res.usage);
    return { recipe: res.parsed_output, usage: res.usage, error: null };
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError || err instanceof Anthropic.APIConnectionTimeoutError) {
      return fail("timeout", "The recipe call ran out of time.");
    }
    if (err instanceof Anthropic.APIError) return fail("model_error", clip(`Claude API error: ${err.message}`));
    if (isAppError(err)) return fail(err.code, err.message);
    throw err;
  }
}

function siteLinks(page: Page, ctx: ProbeContext): string[] {
  const out = new Set<string>();
  page.$("a[href]").each((_, el) => {
    const href = page.$(el).attr("href");
    if (!href || !URL.canParse(href, page.url)) return;
    const u = canonicalizeProductUrl(href, page.url);
    if (sameSite(u, ctx.target) && ctx.robots.isAllowed(u)) out.add(u);
  });
  return [...out];
}

export async function fetchPages(ctx: ProbeContext, a: StageA, tally: Tally, deadline: number): Promise<Pages> {
  const { homepage, platform } = ctx.detection;
  const home: Page = { kind: "home", url: homepage.finalUrl, $: cheerio.load(homepage.html) };
  const homeLinks = siteLinks(home, ctx);
  const first = async (kind: PageKind, urls: string[]): Promise<Page | undefined> => {
    for (const url of new Set(urls)) {
      if (Date.now() > deadline - 2000) return undefined;
      const res = await getPage(ctx, tally, url, deadline);
      // A listing or cart that redirects to the homepage is not one.
      if (isHtml(res) && res.finalUrl !== home.url) return { kind, url: res.finalUrl, $: cheerio.load(res.body) };
    }
    return undefined;
  };
  const listingLink = homeLinks.find((u) => LISTING_PATH.test(new URL(u).pathname) && productUrlScore(u, platform) <= 0);
  const base = ctx.target.baseUrl;
  const [listing, cart] = await Promise.all([
    first("listing", [...(listingLink ? [listingLink] : []), ...LISTING_FALLBACKS.map((p) => base + p)]),
    first("cart", CART_PATHS.map((p) => base + p)),
  ]);
  const sampled = a.pdps.find((p) => p.product) ?? a.pdps.find((p) => p.html);
  const linked = [...homeLinks, ...(listing ? siteLinks(listing, ctx) : [])].find((u) => productUrlScore(u, platform) > 0);
  const pdp = sampled
    ? { kind: "pdp" as const, url: sampled.url, $: cheerio.load(sampled.html) }
    : await first("pdp", linked ? [linked] : []);
  return { home, listing, pdp, cart };
}

export interface StageB { recipe: DomRecipe | null; pages: Pages; usage: Usage | null; error: ProbeError | null; signals: ProbeSignal[] }

export async function stageB(ctx: ProbeContext, a: StageA, tally: Tally, deadline: number): Promise<StageB> {
  const none = (error: ProbeError, pages: Pages = {}, usage: Usage | null = null): StageB => ({
    recipe: null, pages, usage, error, signals: [{ id: "recipe_built", label: "DOM recipe", ok: false, detail: clip(error.message) }],
  });
  const noTime: ProbeError = { code: "time_budget", message: "Not enough time left for the recipe call." };
  if (!optionalEnv("ANTHROPIC_API_KEY")) return none({ code: "not_implemented", message: "Recipe skipped: ANTHROPIC_API_KEY is not set." });
  if (deadline - Date.now() < MIN_MODEL_MS) return none(noTime);
  const pages = await within(fetchPages(ctx, a, tally, deadline), deadline, ctx.signal, null);
  if (!pages) return none({ code: "timeout", message: "Fetching the recipe pages ran out of time." });
  const remaining = deadline - Date.now();
  if (remaining < MIN_MODEL_MS) return none(noTime, pages);

  const outlines = PAGE_ORDER.flatMap((kind) => {
    const p = pages[kind];
    return p ? [{ page: kind, url: p.url, outline: buildOutline(p.$, kind === "home") }] : [];
  });
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(remaining)]);
  const built = await buildRecipe(outlines, { signal, timeoutMs: remaining });
  if (!built.recipe) return none(built.error ?? { code: "invalid_output", message: "No recipe." }, pages, built.usage);

  const raw = built.recipe;
  const { recipe, valid } = validateRecipe(raw, pages, a.currency ?? "USD");
  const field = (id: string, label: string, f: "product_link" | "add_to_cart" | "cart_link"): ProbeSignal => ({
    id, label, ok: valid.includes(f),
    detail: clip(recipe[f] ?? (raw[f] ? `Rejected: ${raw[f]}` : "Not found on the fetched pages")),
  });
  return {
    recipe, pages, usage: built.usage, error: null,
    signals: [
      { id: "recipe_built", label: "DOM recipe", ok: valid.length > 0, detail: `${valid.length}/9 selectors valid` },
      field("recipe_product_link", "Product link selector", "product_link"),
      field("recipe_add_to_cart", "Add to cart selector", "add_to_cart"),
      field("recipe_cart_link", "Cart link selector", "cart_link"),
    ],
  };
}

// ---------- HTTP-only verification (R15: no browser stage C) ----------

function hrefsOf(page: Page, sel: string): string[] {
  const out = new Set<string>();
  select(page.$, sel)?.each((_, el) => {
    const $el = page.$(el);
    const href = $el.attr("href") ?? $el.find("a[href]").attr("href") ?? $el.closest("a[href]").attr("href");
    if (href && URL.canParse(href, page.url) && /^https?:/i.test(new URL(href, page.url).protocol)) {
      out.add(canonicalizeProductUrl(href, page.url));
    }
  });
  return [...out];
}

export interface Verification { caps: Partial<Capabilities>; signals: ProbeSignal[] }

export async function verifyOverHttp(
  ctx: ProbeContext, recipe: DomRecipe, pages: Pages, currency: string | null, tally: Tally, deadline: number,
): Promise<Verification> {
  const caps: Partial<Capabilities> = {};
  let product: ProbeSignal = { id: "recipe_http_verified", label: "Recipe followed over HTTP", ok: false, detail: "No product link to follow" };
  const links = [pages.listing, pages.home]
    .map((p) => (p && recipe.product_link ? hrefsOf(p, recipe.product_link).filter((u) => sameSite(u, ctx.target)) : []))
    .find((l) => l.length) ?? [];
  for (const url of links.slice(0, 2)) {
    if (Date.now() > deadline - 1000) break;
    const res = await getPage(ctx, tally, url, deadline);
    if (!isHtml(res)) {
      product = { ...product, detail: `Product page ${failReason(res)}`, url };
      continue;
    }
    const $ = cheerio.load(res.body);
    const title = recipe.title ? squash(select($, recipe.title)?.first().text() ?? "", 60) : "";
    if (!title) {
      product = { ...product, detail: "The title selector matched nothing on the product page", url };
      continue;
    }
    const price = recipe.price ? readPrice($, recipe.price, currency ?? "USD") : null;
    // 02 section 6.1: a visible, enabled add-to-cart counts as in stock.
    const inStock = !!recipe.add_to_cart && (select($, recipe.add_to_cart)?.not("[disabled]").length ?? 0) > 0;
    caps.product_detail = true;
    caps.catalog = links.length >= 3;
    caps.price_availability = !!price && inStock && (currency != null || CURRENCY_HINT.test(price.text));
    product = {
      ...product, ok: !!price, url: res.finalUrl,
      detail: clip(price ? `"${title}" at ${price.text}${inStock ? ", in stock" : ""}` : `"${title}", but the price selector did not parse`),
    };
    break;
  }

  let checkout: ProbeSignal = { id: "recipe_checkout", label: "Checkout page over HTTP", ok: false, detail: "No checkout link on the cart page" };
  // Express-pay links (PayPal, Shop Pay, Klarna) start a payment, so they are never followed.
  const checkoutUrl = pages.cart && recipe.checkout_link
    ? hrefsOf(pages.cart, recipe.checkout_link).find((u) => !PAYMENT_IFRAME_RE.test(u)) : undefined;
  if (checkoutUrl && Date.now() < deadline - 1000) {
    const res = await getPage(ctx, tally, checkoutUrl, deadline);
    const reached = isHtml(res) && (CHECKOUT_URL_RE.test(res.finalUrl) || cheerio.load(res.body)(CHECKOUT_FIELDS).length > 0);
    caps.checkout_reachable = reached;
    checkout = {
      ...checkout, ok: reached, url: checkoutUrl,
      detail: reached ? "Checkout page reached, nothing submitted"
        : isHtml(res) ? clip(`Landed on ${new URL(res.finalUrl).pathname}, not a checkout page`) : `Checkout ${failReason(res)}`,
    };
  }

  const cart: ProbeSignal = { id: "recipe_cart", label: "Add to cart", ok: false, detail: "add to cart not browser-verified" };
  return { caps, signals: [product, checkout, cart] };
}

// ---------- probe ----------

export const domProbe: ProbeFn = async (ctx) => {
  const started = Date.now();
  const tally: Tally = { ms: [], blocked: false };
  const caps: Capabilities = { ...NO_CAPABILITIES };
  const probe: AccessProbe = { ...emptyProbe("dom", "running"), started_at: new Date(started).toISOString() };
  let error: ProbeError | undefined;
  let usage: Usage | null = null;

  const publish = async (signals: ProbeSignal[], more: Partial<Capabilities> = {}) => {
    probe.signals.push(...signals);
    for (const [key, v] of Object.entries(more)) if (v) caps[key as keyof Capabilities] = true;
    const patch = { signals: [...probe.signals], capabilities: { ...caps }, ...(probe.recipe ? { recipe: probe.recipe } : {}) };
    await ctx.update(patch).catch((err) => log.warn("scan.dom.update_failed", { scan_id: ctx.scanId, error: errMsg(err) }));
  };

  const a = await stageA(ctx, tally, Math.min(ctx.deadline, started + STAGE_A_MS));
  await publish(a.signals, a.caps);

  // Store- and model-side failures past stage A are reported, never thrown, so stage A's result stands.
  try {
    if (!ctx.signal.aborted) {
      const b = await stageB(ctx, a, tally, ctx.deadline - VERIFY_RESERVE_MS);
      usage = b.usage;
      if (b.error) error = b.error;
      if (b.recipe) probe.recipe = b.recipe;
      await publish(b.signals);
      if (b.recipe && !ctx.signal.aborted) {
        const v = await verifyOverHttp(ctx, b.recipe, b.pages, a.currency, tally, ctx.deadline - 500);
        await publish(v.signals, v.caps);
      }
    }
  } catch (err) {
    error = { code: "probe_error", message: clip(errMsg(err)) };
  }
  if (error) log.warn("scan.dom.recipe_failed", { scan_id: ctx.scanId, code: error.code, msg: error.message });

  const finished = Date.now();
  const meter = new UsageMeter(RECIPE_MODEL);
  if (usage) meter.add(usage);
  return {
    ...probe,
    status: statusFrom(caps, tally.blocked),
    finished_at: new Date(finished).toISOString(),
    duration_ms: finished - started,
    capabilities: caps,
    sample_products: a.products.length || (caps.product_detail ? 1 : 0),
    // 02 section 6.5 without a browser: 4 pages x median page latency + 2 s.
    est_seconds_per_task: tally.ms.length ? round1((4 * median(tally.ms)) / 1000 + 2) : probe.est_seconds_per_task,
    est_usd_per_task: usage ? meter.usd() : probe.est_usd_per_task,
    ...(error ? { error } : {}),
  };
};
