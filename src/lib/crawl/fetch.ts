import "server-only";
import PQueue from "p-queue";
import type { CrawlContext } from "@/lib/contracts";
import { flags, optionalEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import type { RobotsInfo } from "./robots";
import { assertPublicHost } from "./url";

export type FetchKind = "html" | "json" | "xml" | "text";
export type BlockReason =
  | "robots" | "content_signal" | "challenge" | "forbidden" | "rate_limited"
  | "ssrf" | "too_large" | "timeout" | "network" | "deadline";
export interface FetchResult {
  url: string; finalUrl: string; status: number; ok: boolean;
  headers: Headers; body: string; ms: number;
  blocked: BlockReason | null; fromCache: boolean;
}
export interface FetchOpts {
  kind?: FetchKind; timeoutMs?: number; retries?: number;
  headers?: Record<string, string>; skipRobots?: boolean; noCache?: boolean;
}
export interface Fetcher {
  get(url: string, opts?: FetchOpts): Promise<FetchResult>;
  getJson<T = unknown>(url: string, opts?: FetchOpts): Promise<{ res: FetchResult; data: T | null }>;
  asFetch(): typeof fetch;
  robots: RobotsInfo | null;
  stats: { requests: number; ok: number; failed: number; blocked: number; challenged: number };
  userAgent: string; robotsToken: typeof ROBOTS_TOKEN;
}

export const ROBOTS_TOKEN = "ShoperZeroBot";
const ACCEPT: Record<FetchKind, string> = {
  html: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  json: "application/json",
  xml: "application/xml,text/xml;q=0.9,*/*;q=0.5",
  text: "text/plain,*/*;q=0.8",
};
const TIMEOUT_MS: Record<FetchKind, number> = { html: 15_000, json: 20_000, xml: 25_000, text: 15_000 };
const MAX_BYTES: Record<FetchKind, number> = { html: 3_000_000, json: 3_000_000, text: 3_000_000, xml: 12_000_000 };
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_REDIRECTS = 5;

// ---------- challenge detection ----------
// Only ever served on challenge/block pages.
const STRONG_BODY = [
  /<title>\s*Just a moment\.\.\.\s*<\/title>/i, /cf-chl-(widget|bypass|opt)/i,
  /captcha-delivery\.com/i, /Incapsula incident ID/i, /px-captcha/i,
];
// Also injected into normal pages of protected sites (Cloudflare JS detections, Turnstile, Incapsula/PerimeterX tags).
const WEAK_BODY = [/\/cdn-cgi\/challenge-platform\//i, /challenges\.cloudflare\.com/i, /_Incapsula_Resource/i, /_pxhd/i];
const AKAMAI_DENIED = /Access Denied[\s\S]{0,2000}Reference #/i;

export function detectChallenge(status: number, headers: Headers, body: string): "challenge" | "forbidden" | null {
  const head = body.slice(0, 65_536);
  if (headers.get("cf-mitigated") === "challenge" || headers.has("x-dd-b")) return "challenge";
  if (STRONG_BODY.some((re) => re.test(head))) return "challenge";
  const weak = headers.has("x-datadome") || [...headers.keys()].some((k) => k.startsWith("x-px-"))
    || WEAK_BODY.some((re) => re.test(head));
  if (weak && weakMeansChallenge(status, body.length)) return "challenge";
  if (status === 403 || AKAMAI_DENIED.test(head)) return "forbidden";
  return null;
}

// Called when a weak marker was seen (Cloudflare JS detections, Turnstile, Incapsula/PerimeterX tag, x-datadome header).
// true marks the page blocked: never retried, and it counts toward the circuit breaker.
// false parses the body as a normal page.
function weakMeansChallenge(status: number, bodyLength: number): boolean {
  // TODO(human)
  return false;
}

// ---------- fetcher ----------
interface HostState { q: PQueue; key: string; rps: number; concurrency: number; throttled: number }
interface Attempt { status: number; headers: Headers; body: string; finalUrl: string; blocked?: BlockReason }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hostOf = (u: string | undefined) => (u && URL.canParse(u) ? new URL(u).host : null);

function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(ms)) return Math.min(Math.max(ms, 0), 10_000);
  }
  return 750 * 2 ** attempt + Math.random() * 250;
}

async function decodeBody(buf: Uint8Array, contentType: string | null): Promise<string> {
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const stream = new Blob([buf as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }
  const label = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1];
  try {
    return new TextDecoder(label ?? "utf-8").decode(buf);
  } catch {
    return new TextDecoder().decode(buf);
  }
}

const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

export function createFetcher(opts: {
  userAgent?: string; deadline?: number; allowPrivate?: boolean;
  perSecond?: number; concurrency?: number;
} = {}): Fetcher {
  const userAgent = opts.userAgent ?? flags.crawlerUserAgent();
  const deadline = opts.deadline ?? Number.POSITIVE_INFINITY;
  const allowPrivate = opts.allowPrivate ?? flags.allowPrivateStoreHosts();
  const wooHost = hostOf(optionalEnv("WOO_DEMO_URL"));
  const hosts = new Map<string, HostState>();
  const hostChecks = new Map<string, Promise<boolean>>();
  const cache = new Map<string, FetchResult>();

  function queueFor(host: string): HostState {
    let s = hosts.get(host);
    if (!s) {
      const fast = host === wooHost;
      s = { q: new PQueue(), key: "", rps: fast ? 4 : opts.perSecond ?? 2, concurrency: fast ? 4 : opts.concurrency ?? 2, throttled: 0 };
      hosts.set(host, s);
    }
    const robots = fetcher.robots;
    const delay = robots && hostOf(robots.url) === host ? robots.crawlDelaySec : null;
    const key = delay ? `delay:${delay}` : `rps:${s.rps}`;
    // ponytail: swapping queues lets in-flight tasks of the old queue finish unthrottled; fine at 2 rps.
    if (s.key !== key) {
      s.q = delay
        ? new PQueue({ concurrency: 1, interval: Math.ceil(delay * 1000), intervalCap: 1 })
        : new PQueue({ concurrency: s.concurrency, interval: s.rps >= 1 ? 1000 : 2000, intervalCap: Math.max(1, Math.floor(s.rps)) });
      s.key = key;
    }
    return s;
  }

  // Every host is checked (robots.txt sitemaps and redirects can point anywhere), once per fetcher.
  function hostAllowed(u: URL): Promise<boolean> {
    if (allowPrivate) return Promise.resolve(true);
    let p = hostChecks.get(u.host);
    if (!p) {
      p = assertPublicHost(u.href, false).then(() => true, () => false);
      hostChecks.set(u.host, p);
    }
    return p;
  }

  async function once(url: string, kind: FetchKind, o: FetchOpts): Promise<Attempt> {
    const timeoutMs = Math.max(1000, Math.min(o.timeoutMs ?? TIMEOUT_MS[kind], deadline - Date.now()));
    const signal = AbortSignal.timeout(timeoutMs);
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!(await hostAllowed(new URL(current)))) return { status: 0, headers: new Headers(), body: "", finalUrl: current, blocked: "ssrf" };
      fetcher.stats.requests++;
      const res = await fetch(current, {
        redirect: "manual", signal,
        headers: { "User-Agent": userAgent, Accept: ACCEPT[kind], "Accept-Language": "en-US,en;q=0.8", ...o.headers },
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        current = new URL(location, current).href;
        continue;
      }
      const tooLarge = { status: res.status, headers: res.headers, body: "", finalUrl: current, blocked: "too_large" as const };
      if (Number(res.headers.get("content-length")) > MAX_BYTES[kind]) {
        await res.body?.cancel();
        return tooLarge;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > MAX_BYTES[kind]) return tooLarge;
      return { status: res.status, headers: res.headers, body: await decodeBody(buf, res.headers.get("content-type")), finalUrl: current };
    }
    return { status: 0, headers: new Headers(), body: "", finalUrl: current, blocked: "network" };
  }

  async function get(url: string, o: FetchOpts = {}): Promise<FetchResult> {
    const kind = o.kind ?? "html";
    if (!o.noCache) {
      const hit = cache.get(url);
      if (hit) return { ...hit, fromCache: true };
    }
    const started = Date.now();
    const finish = (a: Partial<Attempt> & { blocked?: BlockReason | null }): FetchResult => {
      const status = a.status ?? 0;
      const blocked = a.blocked ?? null;
      const r: FetchResult = {
        url, finalUrl: a.finalUrl ?? url, status, ok: !blocked && status >= 200 && status < 300,
        headers: a.headers ?? new Headers(), body: a.body ?? "", ms: Date.now() - started, blocked, fromCache: false,
      };
      if (r.ok) fetcher.stats.ok++;
      else if (blocked) fetcher.stats.blocked++;
      else fetcher.stats.failed++;
      if (blocked === "challenge") fetcher.stats.challenged++;
      if (!blocked && status < 500) cache.set(url, r);
      return r;
    };

    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return finish({ blocked: "network" });
    }
    if (!o.skipRobots && fetcher.robots && !fetcher.robots.isAllowed(url)) return finish({ blocked: "robots" });
    const retries = o.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      if (Date.now() > deadline - 2000) return finish({ blocked: "deadline" });
      const host = queueFor(u.host);
      let a: Attempt;
      try {
        a = (await host.q.add(() => once(url, kind, o)))!;
      } catch (e) {
        const wait = backoffMs(attempt, null);
        if (attempt >= retries || Date.now() + wait > deadline - 2000) return finish({ blocked: isTimeout(e) ? "timeout" : "network" });
        await sleep(wait);
        continue;
      }
      if (a.blocked) return finish(a);
      const challenge = detectChallenge(a.status, a.headers, a.body);
      if (challenge) return finish({ ...a, blocked: challenge });
      if (RETRY_STATUS.has(a.status) && attempt < retries) {
        if (a.status === 429 && ++host.throttled % 2 === 0) {
          host.rps = Math.max(host.rps / 2, 0.5);
          log.warn("crawl.fetch.throttled", { host: u.host, rps: host.rps });
        }
        await sleep(backoffMs(attempt, a.headers.get("retry-after")));
        continue;
      }
      return finish(a.status === 429 ? { ...a, blocked: "rate_limited" } : a);
    }
  }

  const fetcher: Fetcher = {
    get,
    async getJson<T>(url: string, o: FetchOpts = {}) {
      const res = await get(url, { kind: "json", ...o });
      return { res, data: res.ok ? parseJson<T>(res.body) : null };
    },
    asFetch() {
      return (async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = input instanceof Request ? input : null;
        if ((init?.method ?? req?.method ?? "GET").toUpperCase() !== "GET") throw new AppError("bad_request", "crawler is read-only");
        const url = req ? req.url : String(input);
        const accept = new Headers(init?.headers ?? req?.headers).get("accept") ?? "";
        const r = await get(url, { kind: /json/.test(accept) ? "json" : /xml/.test(accept) ? "xml" : "html" });
        const headers = new Headers(r.headers);
        headers.delete("content-encoding");
        headers.delete("content-length");
        let status = r.status || 599;
        if (r.blocked) {
          headers.set("x-shoperzero-blocked", r.blocked);
          status = ["robots", "content_signal", "challenge", "forbidden"].includes(r.blocked) ? 403 : 599;
        }
        const nullBody = [101, 204, 205, 304].includes(status);
        return new Response(nullBody ? null : r.body, { status, headers });
      }) as typeof fetch;
    },
    robots: null,
    stats: { requests: 0, ok: 0, failed: 0, blocked: 0, challenged: 0 },
    userAgent,
    robotsToken: ROBOTS_TOKEN,
  };
  return fetcher;
}

function parseJson<T>(body: string): T | null {
  if (body.trimStart().startsWith("<")) return null;
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

// ---------- adapter helpers over CrawlContext.fetch ----------
type Got = { status: number; ok: boolean; headers: Headers; blocked: string | null };

export async function getText(ctx: CrawlContext, url: string): Promise<Got & { body: string }> {
  const res = await ctx.fetch(url, { signal: ctx.signal });
  return { status: res.status, ok: res.ok, body: await res.text(), headers: res.headers, blocked: res.headers.get("x-shoperzero-blocked") };
}

export async function getJson<T>(ctx: CrawlContext, url: string): Promise<Got & { data: T | null }> {
  const res = await ctx.fetch(url, { headers: { accept: "application/json" }, signal: ctx.signal });
  const body = await res.text();
  return { status: res.status, ok: res.ok, data: res.ok ? parseJson<T>(body) : null, headers: res.headers, blocked: res.headers.get("x-shoperzero-blocked") };
}
