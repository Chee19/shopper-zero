import { z } from "zod";
import type { Platform } from "./primitives";
import type { ReadinessCheck } from "./store";

// ---------- DECISIONS §A (verbatim) ----------
export type AccessMethod = "api" | "dom" | "computer_use";
export type ProbeStatus = "pending" | "running" | "passed" | "partial" | "failed" | "skipped" | "blocked";
export type Capabilities = {
  catalog: boolean; product_detail: boolean; price_availability: boolean;
  variants: boolean; cart: boolean; checkout_reachable: boolean;
};
export type ProbeSignal = { id: string; label: string; ok: boolean; detail?: string; url?: string };
export type DomRecipe = {
  search_input?: string; product_card?: string; product_link?: string; title?: string; price?: string;
  variant_picker?: string; add_to_cart?: string; cart_link?: string; checkout_link?: string;
  notes?: string; verified_at?: string;
};
export type AccessProbe = {
  method: AccessMethod;
  status: ProbeStatus;
  started_at: string | null; finished_at: string | null; duration_ms: number | null;
  signals: ProbeSignal[];
  capabilities: Capabilities;
  sample_products: number;
  est_seconds_per_task: number | null;
  est_usd_per_task: number | null;
  endpoints?: string[];            // api
  recipe?: DomRecipe;              // dom
  screenshots?: string[];          // computer_use: Supabase Storage public URLs, in order
  steps?: { i: number; action: string; reasoning?: string; screenshot?: string }[];  // computer_use
  error?: { code: string; message: string };
};
export type ScanMode = "cascade" | "full";
export type ScanStatus = "queued" | "running" | "done" | "failed";
export type ScanReport = {
  id: string; store_id: string; url: string; mode: ScanMode; status: ScanStatus;
  platform: Platform;
  best_method: AccessMethod | "none";
  probes: AccessProbe[];            // in cascade order; untried methods are "skipped"
  score: number;                    // 0–100
  grade: "A" | "B" | "C" | "D" | "F";
  checks: ReadinessCheck[];         // existing readiness checks, still shown
  after: { score: number; grade: "A" | "B" | "C" | "D" | "F" } | null;  // projected / actual via ShoperZero
  recommendations: string[];
  created_at: string; updated_at: string;
};

// ---------- additions (WS1) ----------
/** Cascade order. DB: scans.best_method / stores.best_method CHECK = these + "none". */
export const ACCESS_METHODS = ["api", "dom", "computer_use"] as const satisfies readonly AccessMethod[];
export const PROBE_STATUSES = [
  "pending", "running", "passed", "partial", "failed", "skipped", "blocked",
] as const satisfies readonly ProbeStatus[];
export const SCAN_MODES = ["cascade", "full"] as const satisfies readonly ScanMode[];
export const SCAN_STATUSES = ["queued", "running", "done", "failed"] as const satisfies readonly ScanStatus[];
export const SCAN_SCREENSHOT_BUCKET = "scan-screenshots" as const; // public bucket; path "{scan_id}/{step}.png"
export const NO_CAPABILITIES: Capabilities = {
  catalog: false, product_detail: false, price_availability: false,
  variants: false, cart: false, checkout_reachable: false,
};

/** Body of POST /api/v1/scans. The MCP tool scan_store takes the same fields. */
export const CreateScanInputSchema = z.object({
  url: z.string().trim().min(3).max(2048).describe('Store homepage URL or domain, e.g. "https://www.bulk.com/uk" or "bulk.com".'),
  mode: z.enum(["cascade", "full"]).optional().describe('Default "cascade": stop at the first access method that works.'),
});
export type CreateScanInput = z.infer<typeof CreateScanInputSchema>;

/** 202 body of POST /api/v1/scans, and structuredContent of scan_store. */
export interface ScanStartResult {       // WS2 02 §15.1(c)
  scan_id: string;
  store_id: string;
  status_url: string;          // {APP_URL}/api/v1/scans/{scan_id}  (JSON ScanReport)
  report_url: string;          // {APP_URL}/scan/{scan_id}           (human page, WS5)
}
