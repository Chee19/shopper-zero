import "server-only";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { Store } from "@/lib/contracts";
import { optionalEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

export interface StoreTarget { origin: string; baseUrl: string; domainKey: string } // domainKey === Store.domain

export function storeTarget(store: Pick<Store, "domain" | "base_url">): StoreTarget {
  const baseUrl = store.base_url.replace(/\/+$/, "");
  return { origin: new URL(baseUrl).origin, baseUrl, domainKey: store.domain };
}

const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ["127.0.0.0", 8], ["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16],
  ["169.254.0.0", 16], ["100.64.0.0", 10], ["0.0.0.0", 8],
] as const) PRIVATE.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::1", 128], ["::", 128], ["fc00::", 7], ["fe80::", 10]] as const) {
  PRIVATE.addSubnet(net, prefix, "ipv6");
}

// BlockList also matches IPv4-mapped IPv6 (::ffff:10.0.0.1) against the ipv4 subnets. Non-IPs count as private.
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  return family === 0 || PRIVATE.check(ip, family === 4 ? "ipv4" : "ipv6");
}

// 8080/8443 follow WS1's normalizeStoreUrl (DECISIONS C3).
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

const reject = (reason: "invalid_url" | "url_not_allowed", message: string) =>
  new AppError("validation_error", message, { reason });

// DNS-level SSRF guard: every resolved address must be public.
export async function assertPublicHost(url: string, allowPrivate: boolean): Promise<void> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw reject("invalid_url", "Not a valid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw reject("invalid_url", "Only http(s) URLs are allowed");
  if (allowPrivate) return;
  const woo = optionalEnv("WOO_DEMO_URL");
  if (woo && URL.canParse(woo) && new URL(woo).host === u.host) return;
  if (!ALLOWED_PORTS.has(u.port)) throw reject("url_not_allowed", `Port ${u.port} is not allowed`);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw reject("invalid_url", `Host ${host} does not resolve`);
  }
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw reject("url_not_allowed", `Host ${host} resolves to a private address`);
  }
}

const TRACKING_PARAM = /^(utm_.*|gclid|fbclid|_pos|_sid|_ss|srsltid|ref)$/i;

// The query is always re-serialized so "a%20b" and "a+b" canonicalize the same.
export function canonicalizeProductUrl(u: string, base: string): string {
  const url = new URL(u, base);
  url.hash = "";
  const kept = [...url.searchParams].filter(([k]) => !TRACKING_PARAM.test(k));
  url.search = kept.length ? new URLSearchParams(kept).toString() : "";
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}
