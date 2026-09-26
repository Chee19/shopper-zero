// Browser-side calls to the WS2 routes the UI drives. Errors use the B11 envelope {error:{code,message,details?}}.
import type { ApiErrorBody, ScanStartResult, Store } from "../lib/contracts";

export type ApiFailure = { ok: false; status: number; code: string; message: string };

async function post<T>(url: string, body: unknown): Promise<{ ok: true; status: number; data: T } | ApiFailure> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, code: "network", message: "Network error" };
  }
  const json = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (res.ok && json) return { ok: true, status: res.status, data: json };
  return {
    ok: false,
    status: res.status,
    code: json?.error?.code ?? "internal",
    message: json?.error?.message ?? `Request failed (${res.status})`,
  };
}

export function startScan(url: string) {
  return post<ScanStartResult>("/api/v1/scans", { url, mode: "cascade" });
}

export type IndexStoreResult = { store: Store; crawl_run_id: string; status: string; reused: boolean; cached: boolean };

/** POST /api/v1/stores {store_id} (R2-4); falls back to {url} if the route doesn't accept store_id yet. */
export async function startIndexing(opts: { storeId: string; url: string; demo: boolean }) {
  const extra = { force: true, ...(opts.demo ? { max_products: 40 } : {}) };
  const first = await post<IndexStoreResult>("/api/v1/stores", { store_id: opts.storeId, ...extra });
  if (!first.ok && first.status === 400 && first.code === "validation_error") {
    return post<IndexStoreResult>("/api/v1/stores", { url: opts.url, ...extra });
  }
  return first;
}

/** Normalizes the landing input: trim, add https:// when there's no scheme, keep the path, validate with new URL(). */
export function normalizeStoreUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.toString().replace(/\/$/, u.pathname === "/" ? "" : "/");
  } catch {
    return null;
  }
}
