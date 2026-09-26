import "server-only";
import * as cheerio from "cheerio";
import { PLATFORMS, type PlatformAdapter, type Platform } from "@/lib/contracts";
import { adapters } from "./adapters";
import { wooApiBases, wooUrl } from "./adapters/woocommerce";
import type { BlockReason, Fetcher } from "./fetch";
import { isType, parseJsonLdNodes } from "./jsonld";
import type { StoreTarget } from "./url";

type Hint = "shopware" | "opencart" | "ecwid";
type Candidate = Platform | Hint;
type Source = "header" | "html" | "cookie" | "meta";

export interface DetectionResult {
  platform: Platform;
  confidence: number;
  signals: string[];
  hint: Hint | null;
  adapter: PlatformAdapter | null;           // only when a T0 adapter's probe passed
  scores: Partial<Record<Candidate, number>>;
  probes: Record<string, { url: string; status: number; ok: boolean }>;
  homepage: { finalUrl: string; status: number; html: string; headers: Headers };
  siteName: string | null;
  blocked: BlockReason | null;               // homepage blocked: pipeline marks the store blocked/failed
}

interface Rule { p: Candidate; src: Source; re: RegExp; w: number; id: string }
const r = (p: Candidate, src: Source, re: RegExp, w: number, id: string): Rule => ({ p, src, re, w, id });

// Header text is "name: value" lines with lower-case names; cookie text is one cookie name per line.
const RULES: Rule[] = [
  r("shopify", "header", /^(x-shopid|x-shopify-stage):/m, 0.8, "x-shopid"),
  r("shopify", "header", /^powered-by: shopify/im, 0.8, "powered-by"),
  r("shopify", "html", /cdn\.shopify\.com/i, 0.5, "cdn.shopify.com"),
  r("shopify", "html", /Shopify\.theme/i, 0.5, "Shopify.theme"),
  r("shopify", "cookie", /^(_shopify_y|_shopify_s|cart_sig)$/m, 0.5, "_shopify"),
  r("woocommerce", "html", /\/wp-content\/plugins\/woocommerce\//i, 0.6, "plugins/woocommerce"),
  r("woocommerce", "html", /class="[^"]*\bwoocommerce\b/i, 0.3, "class=woocommerce"),
  r("woocommerce", "meta", /^WooCommerce/i, 0.8, "generator"),
  r("woocommerce", "cookie", /^(woocommerce_|wp_woocommerce_session_)/m, 0.5, "woocommerce_"),
  r("woocommerce", "header", /^link:.*rel="https:\/\/api\.w\.org\/"/im, 0.2, "api.w.org"),
  r("magento", "html", /x-magento-init/i, 0.6, "x-magento-init"),
  r("magento", "html", /Magento_[A-Z][A-Za-z]+\//, 0.5, "Magento_Module"),
  r("magento", "html", /mage\/cookies/i, 0.4, "mage/cookies"),
  r("magento", "html", /\/static\/version\d+\/frontend\//i, 0.6, "static/version"),
  r("magento", "cookie", /^(form_key|mage-cache-sessid|private_content_version|mage-cache-storage)$/m, 0.5, "mage-cookie"),
  r("magento", "header", /^(x-magento-tags|x-magento-cache-debug|x-magento-vary):/m, 0.7, "x-magento"),
  r("magento", "html", /\/scripts\/aem\.js[\s\S]*@dropins\/storefront|@dropins\/storefront[\s\S]*\/scripts\/aem\.js/i, 0.3, "eds-dropins"),
  r("bigcommerce", "header", /^x-bc-store-id:/m, 0.9, "x-bc-store-id"),
  r("bigcommerce", "header", /^x-bc-/m, 0.5, "x-bc-"),
  r("bigcommerce", "cookie", /^(SHOP_SESSION_TOKEN|SF-CSRF-TOKEN|fornax_anonymousId|athena_short_visit_id)$/m, 0.5, "bc-cookie"),
  r("bigcommerce", "html", /cdn\d*\.bigcommerce\.com/i, 0.6, "cdn.bigcommerce.com"),
  r("squarespace", "html", /Static\.SQUARESPACE_CONTEXT/i, 0.7, "SQUARESPACE_CONTEXT"),
  r("squarespace", "html", /static1\.squarespace\.com|assets\.squarespace\.com/i, 0.5, "static.squarespace"),
  r("squarespace", "html", /<!-- This is Squarespace\. -->/i, 0.6, "comment"),
  r("squarespace", "cookie", /^(crumb|SS_MID)$/m, 0.3, "crumb"),
  r("sfcc", "html", /\/on\/demandware\.(store|static)\//i, 0.7, "demandware"),
  r("sfcc", "cookie", /^(dwsid|dwanonymous_.*|dwac_.*|__cq_dnt)$/m, 0.6, "dw-cookie"),
  r("wix", "header", /^x-wix-request-id:/m, 0.8, "x-wix-request-id"),
  r("wix", "header", /^server: pepyaka/im, 0.7, "pepyaka"),
  r("wix", "html", /static\.parastorage\.com|static\.wixstatic\.com/i, 0.5, "parastorage"),
  r("wix", "meta", /Wix\.com Website Builder/i, 0.8, "generator"),
  r("prestashop", "cookie", /^PrestaShop-[a-f0-9]{32}$/m, 0.7, "PrestaShop-cookie"),
  r("prestashop", "html", /var prestashop\s*=/i, 0.6, "var prestashop"),
  r("prestashop", "html", /"static_token"/i, 0.3, "static_token"),
  r("prestashop", "html", /\/modules\/ps_/i, 0.3, "modules/ps_"),
  r("prestashop", "meta", /PrestaShop/i, 0.8, "generator"),
  r("shopware", "html", /\/bundles\/storefront\//i, 0.6, "bundles/storefront"),
  r("shopware", "html", /window\.salesChannelId/i, 0.5, "salesChannelId"),
  r("opencart", "cookie", /^OCSESSID$/m, 0.5, "OCSESSID"),
  r("opencart", "html", /index\.php\?route=(common|product)\//i, 0.5, "route="),
  r("opencart", "html", /catalog\/view\/theme\//i, 0.4, "catalog/view/theme"),
  r("ecwid", "html", /app\.ecwid\.com\/script\.js/i, 0.7, "ecwid-script"),
];
const HINTS: Hint[] = ["shopware", "opencart", "ecwid"];
const SFCC_SITE = /\/on\/demandware\.store\/(Sites-[A-Za-z0-9_-]+-Site)\/([A-Za-z]{2}(?:_[A-Za-z]{2})?|default)\//;
const PROBE_WEIGHT = 0.95;

type ProbeResult = { url: string; status: number; ok: boolean };
async function probeJson(f: Fetcher, url: string, ok: (d: unknown) => boolean, headers?: Record<string, string>): Promise<ProbeResult> {
  const { res, data } = await f.getJson(url, { headers, timeoutMs: 8000, retries: 1 });
  return { url, status: res.status, ok: data != null && ok(data) };
}
const obj = (d: unknown) => (d && typeof d === "object" ? (d as Record<string, unknown>) : {});

export const MAGENTO_STORE_CONFIG_QUERY = "{storeConfig{store_code base_currency_code base_url locale product_url_suffix}}";
const PROBES: Partial<Record<Platform, (f: Fetcher, t: StoreTarget) => Promise<ProbeResult>>> = {
  shopify: (f, t) => probeJson(f, `${t.baseUrl}/products.json?limit=1`, (d) => Array.isArray(obj(d).products)),
  woocommerce: async (f, t) => {
    let last: ProbeResult | null = null;
    for (const api of wooApiBases(t.baseUrl)) {
      last = await probeJson(f, wooUrl(api, "/products", { per_page: 1 }), Array.isArray);
      if (last.ok) return last;
    }
    return last!;
  },
  magento: (f, t) => probeJson(
    f, `${t.baseUrl}/graphql?query=${encodeURIComponent(MAGENTO_STORE_CONFIG_QUERY)}`,
    (d) => typeof obj(obj(obj(d).data).storeConfig).store_code === "string",
    { "Content-Type": "application/json" },
  ),
  bigcommerce: (f, t) => probeJson(f, `${t.origin}/api/storefront/carts`, Array.isArray),
  squarespace: (f, t) => probeJson(f, `${t.baseUrl}/?format=json`, (d) => "website" in obj(d)),
};
const BLIND_PROBES: Platform[] = ["woocommerce", "magento", "shopify"];

const noisyOr = (ws: number[]) => 1 - ws.reduce((acc, w) => acc * (1 - w), 1);

export async function detectPlatform(fetcher: Fetcher, target: StoreTarget): Promise<DetectionResult> {
  const home = await fetcher.get(`${target.baseUrl}/`, { kind: "html" });
  const homepage = { finalUrl: home.finalUrl, status: home.status, html: home.body, headers: home.headers };
  const empty = { signals: [] as string[], hint: null, adapter: null, scores: {}, probes: {}, siteName: null };
  if (home.blocked) return { ...empty, platform: "unknown", confidence: 0, homepage, blocked: home.blocked, signals: [`blocked:${home.blocked}`] };

  // An apex to www redirect moves the fetch root, but domainKey (Store.domain) stays the identity.
  const final = new URL(home.finalUrl);
  if (final.origin !== target.origin) {
    target.baseUrl = final.origin + target.baseUrl.slice(target.origin.length);
    target.origin = final.origin;
  }

  const html = home.body.slice(0, 512_000);
  const $ = cheerio.load(html);
  const inputs: Record<Source, string> = {
    header: [...home.headers].map(([k, v]) => `${k}: ${v}`).join("\n"),
    html,
    cookie: home.headers.getSetCookie().map((c) => c.split("=")[0].trim()).join("\n"),
    meta: $('meta[name="generator" i]').map((_, el) => $(el).attr("content") ?? "").get().join("\n"),
  };

  const weights = new Map<Candidate, number[]>();
  const signals: string[] = [];
  const add = (p: Candidate, w: number, id: string) => {
    weights.set(p, [...(weights.get(p) ?? []), w]);
    signals.push(id);
  };
  for (const rule of RULES) if (rule.re.test(inputs[rule.src])) add(rule.p, rule.w, `${rule.src}:${rule.id}`);
  const sfccSite = SFCC_SITE.exec(html);
  if (sfccSite) add("sfcc", 0.8, `html:sfcc-site:${sfccSite[1]}`);
  const score = (p: Candidate) => noisyOr(weights.get(p) ?? []);

  const probes: DetectionResult["probes"] = {};
  const passed = new Set<Platform>(sfccSite ? ["sfcc"] : []);
  const runProbe = async (p: Platform) => {
    const res = await PROBES[p]!(fetcher, target);
    probes[p] = res;
    if (res.ok) {
      passed.add(p);
      add(p, PROBE_WEIGHT, `probe:${p}`);
    }
    return res.ok;
  };
  const likely = (Object.keys(PROBES) as Platform[]).filter((p) => score(p) >= 0.25).sort((a, b) => score(b) - score(a)).slice(0, 2);
  if (likely.length) {
    await Promise.all(likely.map(runProbe));
  } else if (![...weights.keys()].some((p) => score(p) >= 0.25)) {
    for (const p of BLIND_PROBES) if (await runProbe(p)) break;   // headless Magento (EDS) has no Luma fingerprint
  }

  const scores = Object.fromEntries([...weights.keys()].map((p) => [p, score(p)])) as DetectionResult["scores"];
  const best = PLATFORMS.filter((p) => p !== "custom" && p !== "unknown").sort((a, b) => score(b) - score(a))[0];
  const bestHint = [...HINTS].sort((a, b) => score(b) - score(a))[0];
  let platform: Platform = "custom";
  let hint: Hint | null = null;
  if (score(best) >= 0.5) platform = best;
  else if (score(bestHint) >= 0.5) hint = bestHint;

  return {
    platform,
    confidence: platform === "custom" ? score(bestHint) : score(platform),
    signals, hint, scores, probes, homepage,
    adapter: passed.has(platform) ? adapters[platform] ?? null : null,
    siteName: siteNameOf($),
    blocked: null,
  };
}

function siteNameOf($: cheerio.CheerioAPI): string | null {
  const org = parseJsonLdNodes($).find((n) => isType(n, "Organization", "OnlineStore", "WebSite") && typeof n.name === "string" && n.name.trim());
  if (org) return org.name.trim();
  const og = $('meta[property="og:site_name"]').attr("content")?.trim();
  if (og) return og;
  const segs = $("title").first().text().split(/ \| | – | - /).map((s) => s.trim()).filter((s) => s.length >= 3);
  return segs.sort((a, b) => a.length - b.length)[0] ?? null;
}
