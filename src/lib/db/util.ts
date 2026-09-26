// src/lib/db/util.ts: internal helpers shared by the db helper files. Not re-exported from the barrel.
import "server-only";
import type { Json } from "./types.gen";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string | null | undefined): boolean => typeof v === "string" && UUID_RE.test(v);

/** Postgres "invalid input syntax" (e.g. a malformed uuid): readers treat it as not found. */
export const isMalformed = (e: { code?: string } | null | undefined): boolean => e?.code === "22P02";
export const isUniqueViolation = (e: { code?: string } | null | undefined): boolean => e?.code === "23505";

/** Contract objects (interfaces without index signatures) -> the generated Json column type. */
export const asJson = (v: unknown): Json => v as Json;

export const clampInt = (v: number | undefined, min: number, max: number, fallback: number): number => {
  const n = Math.trunc(Number.isFinite(v) ? (v as number) : fallback);
  return Math.min(Math.max(n, min), max);
};

/** ISO timestamp withinMin minutes before now (the "created_at > now() - interval" filters). */
export const minutesAgo = (withinMin: number): string =>
  new Date(Date.now() - Math.max(0, withinMin) * 60_000).toISOString();

/** Copies only the keys that are present and not undefined. */
export function pickDefined<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const { code, message } = e as { code?: unknown; message?: unknown };
    if (typeof message === "string") return typeof code === "string" && code ? `${code}: ${message}` : message;
  }
  return String(e);
}

export const truncate = (s: string | null | undefined, max: number): string | null =>
  s === null || s === undefined ? null : s.slice(0, max);
