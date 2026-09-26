// src/lib/slug.ts
// Isomorphic (server + client). No node:crypto so client components can import it.

/** "Café Crème  Hoodie!" -> "cafe-creme-hoodie". Empty/unsluggable input -> "". */
export function slugify(input: string, maxLen = 80): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
}

/** 32-bit FNV-1a, 8 hex chars. Deterministic short hash for handles/suffixes (not security). */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const LOCALE_SEGMENT = /^[a-z]{2}([-_][a-z]{2})?$/i;
const BLOCKED_HOST = /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i;
const IP_HOST = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])$/i;

export interface NormalizedStoreUrl {
  domain: string;   // identity key: host without "www." + locale prefix: "bulk.com/uk"
  base_url: string; // fetch root: "https://www.bulk.com/uk" (no trailing slash)
  slug: string;     // "bulk-com-uk"
}

/**
 * Accepts "www.bulk.com/uk", "https://Shop.Example.com/", "shop.example.com/product/x?y=1".
 * - Adds https:// when no scheme. Only http/https.
 * - Keeps the first path segment ONLY if it looks like a locale/storefront prefix (uk, en-gb); drops the rest.
 * - Rejects localhost, *.local, *.internal and IP literals unless allowPrivate (ALLOW_PRIVATE_STORE_HOSTS=true).
 * Throws Error("invalid_store_url: ...") on bad input (callers map to AppError validation_error).
 */
const ALLOWED_PORTS = new Set(["8080", "8443"]); // default ports never appear in URL.port

export function normalizeStoreUrl(raw: string, opts: { allowPrivate?: boolean } = {}): NormalizedStoreUrl {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("invalid_store_url: empty");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new Error(`invalid_store_url: ${raw}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`invalid_store_url: scheme ${u.protocol}`);
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") && !opts.allowPrivate) throw new Error(`invalid_store_url: host ${host}`);
  if (!opts.allowPrivate && (BLOCKED_HOST.test(host) || IP_HOST.test(host))) {
    throw new Error(`invalid_store_url: private host ${host}`);
  }
  if (u.port && !opts.allowPrivate && !ALLOWED_PORTS.has(u.port)) {
    throw new Error(`invalid_store_url: port ${u.port}`);
  }
  const first = u.pathname.split("/").filter(Boolean)[0];
  const prefix = first && LOCALE_SEGMENT.test(first) ? `/${first.toLowerCase()}` : "";
  const port = u.port ? `:${u.port}` : "";
  const bareHost = host.replace(/^www\./, "");
  const domain = `${bareHost}${port}${prefix}`;
  return {
    domain,
    base_url: `${u.protocol}//${host}${port}${prefix}`,
    slug: storeSlugFromDomain(domain),
  };
}

/** "bulk.com/uk" -> "bulk-com-uk"; "www.Shop.co.uk" -> "shop-co-uk". Max 63 chars. */
export function storeSlugFromDomain(domain: string): string {
  const s = slugify(domain.replace(/^https?:\/\//i, "").replace(/^www\./i, ""), 63);
  return s || `store-${shortHash(domain)}`;
}
/** Alias requested by WS2 (02 §13 CCR-4). Same function. */
export const slugFromDomain = storeSlugFromDomain;

/**
 * Deterministic product handle from a PDP URL (same URL -> same handle, always).
 * "https://x.com/product/classic-hoodie/" -> "classic-hoodie"
 * "https://x.com/p/Blue-Shirt.html"       -> "blue-shirt"
 * "https://x.com/index.php?route=product/product&product_id=42" -> "product-id-42" style fallback via query
 * "https://x.com/?p=123"                  -> "p-123"
 * Nothing usable                          -> "product-" + shortHash(url)
 */
export function handleFromUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `product-${shortHash(url)}`;
  }
  const segs = u.pathname.split("/").filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  const last = (segs[segs.length - 1] ?? "").replace(/\.(html?|php|aspx?|jsp)$/i, "");
  const fromPath = slugify(last, 120);
  const generic = /^(index|product|products|p|item|default)$/;
  if (fromPath && !generic.test(fromPath)) return fromPath;
  const fromQuery = slugify(
    [...u.searchParams.entries()]
      .filter(([k]) => !/^(utm_|ref$|route$|variant$|attribute_)/i.test(k))
      .map(([k, v]) => `${k}-${v}`)
      .join("-"),
    120,
  );
  if (fromQuery) return fromQuery;
  return `product-${shortHash(url)}`;
}
