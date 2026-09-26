import "server-only";
import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import type { Platform } from "@/contracts";
import type { Fetcher } from "./fetch";
import type { RobotsInfo } from "./robots";
import type { StoreTarget } from "./url";
import { canonicalizeProductUrl } from "./url";

export interface SitemapUrl { loc: string; lastmod?: string; image?: string }
export interface DiscoveryResult {
  urls: SitemapUrl[];
  sitemapsFetched: string[];
  productSitemapFound: boolean;
  source: "robots" | "guess" | "html_links";
}

export const PRODUCT_SITEMAP_HINT = /product|prod[_-]|sitemap_products|type=products|catalog|store-products|shop/i;
const NON_PRODUCT_SITEMAP = /post|page(?!s?=)|categor|collection|tag|author|blog|article|news|brand|cms|image|video|faq|store-locat/i;

// Prose in 02 5.6 supersedes the code sketch's incomplete GUESSES table.
const GUESSES: Partial<Record<Platform, string[]>> = {
  woocommerce: ["/product-sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"],
  bigcommerce: ["/xmlsitemap.php"],
  wix: ["/store-products-sitemap.xml", "/sitemap.xml"],
  prestashop: ["/1_index_sitemap.xml", "/sitemap.xml"],
  shopify: ["/sitemap.xml"],
  sfcc: ["/sitemap_index.xml", "/sitemap_0.xml"],
};

const xml = new XMLParser({
  ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: true,
  isArray: (n) => n === "sitemap" || n === "url" || n === "image",
});

// R13: adapters only have ctx.fetch, so they parse sitemap bodies through this instead of a Fetcher.
export function parseSitemap(body: string): { sitemaps: string[]; urls: SitemapUrl[] } | null {
  const trimmed = body.replace(/^﻿/, "").trimStart();
  if (!trimmed) return null;
  if (/^<!doctype html|^<html/i.test(trimmed)) return null; // soft-404s often return 200 HTML
  if (!trimmed.startsWith("<")) {
    const urls = trimmed.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^https?:\/\//i.test(l)).map((loc) => ({ loc }));
    return urls.length ? { sitemaps: [], urls } : null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sitemap XML shape varies like JSON-LD, no schema to type against
  let doc: any;
  try {
    doc = xml.parse(trimmed);
  } catch {
    return null;
  }
  if (doc.sitemapindex) {
    const sitemaps: string[] = (doc.sitemapindex.sitemap ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
      .map((s: any) => String(s?.loc ?? "").trim())
      .filter(Boolean);
    return { sitemaps, urls: [] };
  }
  if (doc.urlset) {
    const urls: SitemapUrl[] = (doc.urlset.url ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
      .map((u: any) => ({
        loc: String(u?.loc ?? "").trim(),
        lastmod: u?.lastmod ? String(u.lastmod) : undefined,
        image: u?.image?.[0]?.loc ? String(u.image[0].loc) : undefined,
      }))
      .filter((u: SitemapUrl) => u.loc);
    return { sitemaps: [], urls };
  }
  return null;
}

const PRODUCT_PATH = /\/(product|products|p|item|dp)\/[^/]+/i;
const WIX_PRODUCT_PAGE = /\/product-page\//i;
const SQUARESPACE_SHOP = /\/shop\/p\//i;
const NUMERIC_ID = /[-_/]p\d{3,}|\/\d{4,}\.html$/i;
const NEGATIVE_PATH = /\/(category|categories|collections?|tag|tags|blog|news|pages?|account|cart|checkout|search|wishlist|login|cms|brands?)(\/|$)/i;
const NON_PRODUCT_EXT = /\.(jpg|jpeg|png|gif|webp|pdf|xml)$/i;

export function productUrlScore(url: string, platform: Platform): number {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return -10;
  }
  let score = 0;
  if (PRODUCT_PATH.test(path)) score += 3;
  if (WIX_PRODUCT_PAGE.test(path)) score += 3;
  if (SQUARESPACE_SHOP.test(path)) score += 3;
  if (NUMERIC_ID.test(path)) score += 2;
  if (/\.html$/i.test(path) && (platform === "magento" || platform === "sfcc")) score += 2;
  if (NEGATIVE_PATH.test(path)) score -= 5;
  if (NON_PRODUCT_EXT.test(path)) score -= 10;
  if (!path.replace(/^\/+|\/+$/g, "")) score -= 10; // homepage
  return score;
}

// Host equal to the target host or its www/apex twin, path under target.baseUrl's path prefix.
export function sameSite(url: string, target: StoreTarget): boolean {
  if (!URL.canParse(url)) return false;
  const u = new URL(url);
  const origin = new URL(target.origin);
  const stripWww = (h: string) => h.replace(/^www\./i, "");
  if (stripWww(u.hostname) !== stripWww(origin.hostname)) return false;
  const prefix = new URL(target.baseUrl).pathname.replace(/\/+$/, "");
  return !prefix || u.pathname === prefix || u.pathname.startsWith(`${prefix}/`);
}

interface ScoredUrl extends SitemapUrl { score: number; fromProductSitemap: boolean }

export async function discoverProductUrls(
  fetcher: Fetcher,
  target: StoreTarget,
  robots: RobotsInfo,
  opts: {
    platform: Platform;
    hint?: string | null;
    max: number;
    homepageHtml: string;
    maxSitemaps?: number;
    budgetMs?: number;
  },
): Promise<DiscoveryResult> {
  const maxSitemaps = opts.maxSitemaps ?? 30;
  const budgetMs = opts.budgetMs ?? 25_000;
  const started = Date.now();
  const source: "robots" | "guess" = robots.sitemaps.length ? "robots" : "guess";
  const roots = robots.sitemaps.length
    ? robots.sitemaps
    : [...(GUESSES[opts.platform] ?? []), "/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml"].map((p) => target.origin + p);

  const queue: { url: string; productHint: boolean }[] = roots.map((url) => ({ url, productHint: PRODUCT_SITEMAP_HINT.test(url) }));
  const seen = new Set<string>();
  const fetched: string[] = [];
  const out = new Map<string, ScoredUrl>();
  let productSitemapFound = false;

  const addUrl = (loc: string, lastmod: string | undefined, image: string | undefined, fromProductSitemap: boolean) => {
    if (!/^https?:\/\//i.test(loc)) return;
    const canon = canonicalizeProductUrl(loc, target.baseUrl);
    if (out.has(canon) || !sameSite(canon, target) || !robots.isAllowed(canon)) return;
    out.set(canon, { loc: canon, lastmod, image, score: productUrlScore(canon, opts.platform), fromProductSitemap });
  };

  while (queue.length && fetched.length < maxSitemaps && Date.now() - started < budgetMs) {
    const next = queue.shift();
    if (!next || seen.has(next.url)) continue;
    seen.add(next.url);
    const res = await fetcher.get(next.url, { kind: "xml" });
    if (res.blocked === "deadline") break;
    if (!res.ok) continue;
    fetched.push(next.url);
    const parsed = parseSitemap(res.body);
    if (!parsed) continue;
    if (parsed.sitemaps.length) {
      const prod = parsed.sitemaps.filter((u) => PRODUCT_SITEMAP_HINT.test(u));
      const rest = parsed.sitemaps.filter((u) => !PRODUCT_SITEMAP_HINT.test(u) && !NON_PRODUCT_SITEMAP.test(u)).sort().slice(0, 5);
      if (prod.length) productSitemapFound = true;
      queue.unshift(...prod.map((url) => ({ url, productHint: true })));
      if (!prod.length) queue.push(...rest.map((url) => ({ url, productHint: false })));
    }
    for (const u of parsed.urls) addUrl(u.loc, u.lastmod, u.image, next.productHint);
    if ([...out.values()].filter((u) => u.score > 0 || u.fromProductSitemap).length >= opts.max) break;
  }

  const all = [...out.values()];
  let picked = all.filter((u) => (u.fromProductSitemap ? u.score > -5 : u.score > 0));
  if (picked.length < 10) picked = all.filter((u) => u.score > -5);

  if (picked.length === 0) {
    const fallback = await htmlLinksFallback(fetcher, target, robots, opts.platform, opts.homepageHtml, opts.max);
    return { urls: fallback, sitemapsFetched: fetched, productSitemapFound, source: "html_links" };
  }
  return {
    urls: picked.slice(0, opts.max).map(({ loc, lastmod, image }) => ({ loc, lastmod, image })),
    sitemapsFetched: fetched,
    productSitemapFound,
    source,
  };
}

const CATEGORY_LINK = /shop|category|collection|store|products/i;
const MAX_DISCOVERY_PAGES = 20;
const MAX_CATEGORY_PAGES = 5;

// Used only when the sitemap walk yields 0 URLs.
async function htmlLinksFallback(
  fetcher: Fetcher,
  target: StoreTarget,
  robots: RobotsInfo,
  platform: Platform,
  homepageHtml: string,
  max: number,
): Promise<SitemapUrl[]> {
  const out = new Map<string, SitemapUrl>();

  const collectProductLinks = (html: string, base: string) => {
    const $ = cheerio.load(html);
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href || !URL.canParse(href, base)) return;
      const canon = canonicalizeProductUrl(href, base);
      if (!sameSite(canon, target) || !robots.isAllowed(canon)) return;
      if (!out.has(canon) && productUrlScore(canon, platform) > 0) out.set(canon, { loc: canon });
    });
  };

  const $home = cheerio.load(homepageHtml);
  collectProductLinks(homepageHtml, target.baseUrl);

  const categoryLinks = new Set<string>();
  $home("a[href]").each((_, el) => {
    const href = $home(el).attr("href");
    if (!href || !URL.canParse(href, target.baseUrl)) return;
    const canon = canonicalizeProductUrl(href, target.baseUrl);
    if (!sameSite(canon, target)) return;
    const depth = new URL(canon).pathname.split("/").filter(Boolean).length;
    if (depth >= 1 && depth <= 2 && CATEGORY_LINK.test(canon)) categoryLinks.add(canon);
  });

  let pagesFetched = 1; // the homepage counts as the first discovery page
  for (const link of [...categoryLinks].slice(0, MAX_CATEGORY_PAGES)) {
    if (pagesFetched >= MAX_DISCOVERY_PAGES) break;
    const res = await fetcher.get(link, { kind: "html" });
    pagesFetched++;
    if (res.ok) collectProductLinks(res.body, link);
  }

  return [...out.values()].slice(0, max);
}
