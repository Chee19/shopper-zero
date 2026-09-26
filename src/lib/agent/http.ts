// src/lib/agent/http.ts  (WS3)
import "server-only";
import { UCP_VERSION, type Store } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { CORS_HEADERS, errorResponse } from "@/lib/http";
import { rateLimit } from "./ratelimit";

/** Cache-Control presets. Cache Components is off, so no 'use cache': Vercel's CDN honors these headers. */
export const CACHE = {
  none: "no-store",
  short: "public, max-age=0, s-maxage=15, stale-while-revalidate=60",
  index: "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
  static: "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
} as const;

/** Per-store outputs: never cache while a crawl is filling the index. */
export const storeCache = (s: Pick<Store, "status">) =>
  s.status === "pending" || s.status === "crawling" ? CACHE.none : CACHE.index;

/** Mirrors Shopify's live header: `Link: <…/.well-known/ucp>; rel="ucp"; version="2026-08-25"`. */
export const ucpLinkHeader = (url: string, version: string = UCP_VERSION) => `<${url}>; rel="ucp"; version="${version}"`;

/** The MCP response is a stream, so re-wrap it with CORS rather than going through json(). */
export function withCors(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v);
  h.set("Access-Control-Expose-Headers", "Link, Request-Id, Mcp-Session-Id, MCP-Protocol-Version, Retry-After");
  if (!h.has("Cache-Control")) h.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export function mcpPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Last-Event-ID, UCP-Agent, Request-Id",
      "Access-Control-Max-Age": "86400",
    },
  });
}

/** REST read-route guard: null when allowed, else a 429 envelope with Retry-After. */
export function readRateLimit(req: Request, requestId: string): Response | null {
  if (rateLimit(req, "read")) return null;
  const res = errorResponse(new AppError("rate_limited", "Too many requests from this client. Wait 60 seconds and retry."), requestId);
  res.headers.set("Retry-After", "60");
  return res;
}

/** `UCP-Agent: profile="https://…"` (RFC 8941 dictionary-ish); returns the profile URL or null. */
export function ucpAgentProfile(req: Request): string | null {
  const h = req.headers.get("ucp-agent");
  if (!h) return null;
  const m = /profile\s*=\s*"([^"]+)"/i.exec(h) ?? /profile\s*=\s*([^;,\s]+)/i.exec(h);
  return m ? m[1].slice(0, 2048) : null;
}
