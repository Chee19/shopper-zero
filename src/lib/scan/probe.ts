import "server-only";
import type {
  AccessMethod, AccessProbe, Capabilities, NormalizedProduct, ProbeStatus, Store,
} from "@/lib/contracts";
import { NO_CAPABILITIES } from "@/lib/contracts";
import type { DetectionResult } from "@/lib/crawl/detect";
import type { Fetcher, FetchResult } from "@/lib/crawl/fetch";
import type { RobotsInfo } from "@/lib/crawl/robots";
// sitemap.ts is being written in parallel by another implementer; this type-only import errors until it lands.
import type { DiscoveryResult } from "@/lib/crawl/sitemap";
import type { StoreTarget } from "@/lib/crawl/url";
import { STATIC_ESTIMATES } from "./estimate";

export interface UcpDiscovery {
  url: string;
  res: FetchResult;
  profile: { version: string; capabilities: string[]; mcpEndpoint: string | null } | null;
  // MCP server card lookup, only run when the profile advertises no MCP transport.
  card: { url: string; res: FetchResult; ok: boolean; endpoint: string | null } | null;
}

// R10: shared probe types live here, not run.ts, so probes never import the orchestrator.
export interface ProbeContext {
  scanId: string;
  store: Store;
  target: StoreTarget;
  fetcher: Fetcher;
  robots: RobotsInfo;
  detection: DetectionResult;
  deadline: number;
  signal: AbortSignal;
  shared: {
    discovery?: DiscoveryResult;
    pdpSample?: { url: string; html: string; product: NormalizedProduct | null; miss: string | null }[];
    // A promise so checks.ts and the api probe, which run concurrently, fetch the profile once.
    ucp?: Promise<UcpDiscovery>;
  };
  update(patch: Partial<AccessProbe>): Promise<void>;
}
export type ProbeFn = (ctx: ProbeContext) => Promise<AccessProbe>;

export function emptyProbe(method: AccessMethod, status: ProbeStatus = "pending"): AccessProbe {
  const est = STATIC_ESTIMATES[method];
  return {
    method, status,
    started_at: null, finished_at: null, duration_ms: null,
    signals: [], capabilities: { ...NO_CAPABILITIES },
    sample_products: 0,
    est_seconds_per_task: est.seconds, est_usd_per_task: est.usd,
  };
}

// 02 section 6.1 status table.
export function statusFrom(caps: Capabilities, blocked = false): ProbeStatus {
  if (caps.catalog && caps.price_availability) return "passed";
  const any = Object.values(caps).some(Boolean);
  if (blocked && !any) return "blocked";
  return any ? "partial" : "failed";
}

// First passed probe in cascade order, else first partial, else "none" (02 section 6.1).
export function bestMethod(probes: AccessProbe[]): AccessMethod | "none" {
  return probes.find((p) => p.status === "passed")?.method
    ?? probes.find((p) => p.status === "partial")?.method
    ?? "none";
}
