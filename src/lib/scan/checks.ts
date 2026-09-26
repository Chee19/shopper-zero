import "server-only";
import type { ReadinessCheck, ReadinessCheckId } from "@/lib/contracts";
import { READINESS_CHECK_IDS, READINESS_WEIGHTS } from "@/lib/contracts";
import { extractJsonLdProduct } from "@/lib/crawl/jsonld";
import { discoverProductUrls, productUrlScore, type DiscoveryResult } from "@/lib/crawl/sitemap";
import type { ProbeContext } from "./probe";
import { failReason, obj, parseJson, ucpDiscovery, within } from "./probes/api";

const BUDGET_MS = 20_000;
const REQUEST = { timeoutMs: 8000, retries: 1 };
const DISCOVERY_MAX = 50;
const AGENTS = ["ShoperZeroBot", "GPTBot", "ClaudeBot", "OAI-SearchBot", "PerplexityBot"];

// Same labels as score.ts afterChecks, so before and after rows read alike.
const LABELS: Record<ReadinessCheckId, string> = {
  products_json: "Machine-readable catalog",
  well_known_ucp: "UCP profile",
  mcp_endpoint: "MCP endpoint",
  llms_txt: "llms.txt",
  jsonld_product_coverage: "JSON-LD product coverage",
  sitemap: "Product sitemap",
  robots_allows_agents: "robots.txt allows agents",
  agent_checkout: "Agent checkout",
};

type Result = { pass: boolean; detail: string };
type PdpSample = NonNullable<ProbeContext["shared"]["pdpSample"]>;

const clip = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}...` : s);
const fail = (err: unknown): Result => ({ pass: false, detail: `Check failed: ${err instanceof Error ? err.message : String(err)}` });

async function productsJson(ctx: ProbeContext): Promise<Result> {
  const res = await ctx.fetcher.get(`${ctx.target.baseUrl}/products.json?limit=1`, { kind: "json", ...REQUEST });
  if (res.ok && Array.isArray(obj(parseJson(res.body)).products)) return { pass: true, detail: "products.json returns a products array" };
  return { pass: false, detail: res.ok ? "products.json is not a product feed" : `No products.json (${failReason(res)})` };
}

async function llmsTxt(ctx: ProbeContext): Promise<Result> {
  const res = await ctx.fetcher.get(`${ctx.target.origin}/llms.txt`, { kind: "text", ...REQUEST });
  const body = res.body.trim();
  if (res.ok && body.startsWith("#")) return { pass: true, detail: "llms.txt found" };
  return { pass: false, detail: res.ok ? "llms.txt is not Markdown" : `No llms.txt (${failReason(res)})` };
}

async function discover(ctx: ProbeContext): Promise<DiscoveryResult> {
  const d = await discoverProductUrls(ctx.fetcher, ctx.target, ctx.robots, {
    platform: ctx.detection.platform, hint: ctx.detection.hint, max: DISCOVERY_MAX,
    homepageHtml: ctx.detection.homepage.html, maxSitemaps: 3, budgetMs: 12_000,
  });
  ctx.shared.discovery = d;
  return d;
}

async function samplePdps(ctx: ProbeContext, d: DiscoveryResult): Promise<PdpSample> {
  const checkedAt = new Date().toISOString();
  // Product sitemaps can list the shop archive first; the dom probe opens pdpSample[0] as its PDP.
  const score = (u: string) => productUrlScore(u, ctx.detection.platform);
  const urls = [...d.urls].sort((a, b) => score(b.loc) - score(a.loc)).slice(0, 3);
  const sample = await Promise.all(urls.map(async ({ loc }) => {
    const res = await ctx.fetcher.get(loc, { kind: "html", ...REQUEST });
    if (!res.ok) return { url: loc, html: "", product: null, miss: res.blocked ?? `http_${res.status}` };
    try {
      const r = extractJsonLdProduct(res.body, res.finalUrl, { defaultCurrency: ctx.store.currency, checkedAt, baseUrl: ctx.target.baseUrl });
      return { url: loc, html: res.body, product: r.product, miss: r.miss };
    } catch {
      return { url: loc, html: res.body, product: null, miss: "invalid" };
    }
  }));
  ctx.shared.pdpSample = sample;
  return sample;
}

function coverage(sample: PdpSample | null): Result {
  if (!sample) return { pass: false, detail: "Timed out" };
  if (!sample.length) return { pass: false, detail: "No product pages found to sample" };
  // A missing currency still means the page has a JSON-LD Product with a price.
  const withPrice = sample.filter((s) => s.product || s.miss === "no_currency").length;
  return { pass: withPrice >= 2, detail: `${withPrice}/${sample.length} product pages have JSON-LD Product with price` };
}

function sitemap(d: DiscoveryResult | null): Result {
  if (!d) return { pass: false, detail: "Timed out" };
  if (d.source !== "html_links" && d.urls.length) {
    const n = `${d.urls.length}${d.urls.length >= DISCOVERY_MAX ? "+" : ""}`;
    return { pass: true, detail: `${n} product URLs found via ${d.source === "robots" ? "robots.txt sitemap" : "sitemap"}` };
  }
  return { pass: false, detail: d.sitemapsFetched.length ? "Sitemap lists no product URLs" : "No sitemap found" };
}

// The failing detail is only the blocked agent list: recommendations() renders "robots.txt blocks {detail}".
function robotsAllows(ctx: ProbeContext, d: DiscoveryResult | null): Result {
  const url = d?.urls[0]?.loc ?? `${ctx.target.baseUrl}/`;
  const blocked = AGENTS.filter((ua) => !ctx.robots.isAllowed(url, ua));
  if (ctx.robots.contentSignal?.["ai-input"] === "no") blocked.push("AI input (Content-Signal ai-input=no)");
  return blocked.length ? { pass: false, detail: blocked.join(", ") } : { pass: true, detail: `Allows ${AGENTS.join(", ")}` };
}

export async function runChecks(ctx: ProbeContext): Promise<ReadinessCheck[]> {
  const deadline = Math.min(ctx.deadline, Date.now() + BUDGET_MS);
  const bounded = (p: Promise<Result>) => within(p.catch(fail), deadline, ctx.signal, { pass: false, detail: "Timed out" });
  const ucp = ucpDiscovery(ctx);
  const discovery = within(discover(ctx), deadline, ctx.signal, null);
  const sample = discovery.then((d) => (d ? within(samplePdps(ctx, d), deadline, ctx.signal, null) : null));

  const results: Record<ReadinessCheckId, Promise<Result>> = {
    products_json: bounded(productsJson(ctx)),
    well_known_ucp: bounded(ucp.then(({ res, profile }) => (profile
      ? { pass: true, detail: `UCP profile version ${profile.version}` }
      : { pass: false, detail: res.ok ? "/.well-known/ucp has no ucp.version" : `No UCP profile (${failReason(res)})` }))),
    mcp_endpoint: bounded(ucp.then(({ profile, card }): Result => {
      if (profile?.mcpEndpoint) return { pass: true, detail: "UCP profile advertises an MCP endpoint" };
      if (card?.ok) return { pass: true, detail: `MCP server card at ${new URL(card.url).pathname}` };
      return { pass: false, detail: "No MCP endpoint in a UCP profile or server card" };
    })),
    llms_txt: bounded(llmsTxt(ctx)),
    jsonld_product_coverage: sample.then(coverage),
    sitemap: discovery.then(sitemap),
    robots_allows_agents: discovery.then((d) => robotsAllows(ctx, d)).catch(fail),
    agent_checkout: bounded(ucp.then(({ profile }) => (profile?.capabilities.includes("dev.ucp.shopping.checkout")
      ? { pass: true, detail: "UCP profile declares dev.ucp.shopping.checkout" }
      : { pass: false, detail: profile ? "UCP profile declares no checkout capability" : "No UCP profile declaring checkout" }))),
  };

  const settled = await Promise.all(READINESS_CHECK_IDS.map((id) => results[id]));
  return READINESS_CHECK_IDS.map((id, i) => ({
    id, label: LABELS[id], pass: settled[i].pass, weight: READINESS_WEIGHTS[id], detail: clip(settled[i].detail),
  }));
}
