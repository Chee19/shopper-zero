import "server-only";
import type { AccessMethod, AccessProbe, DomRecipe, ReadinessCheck, ScanReport, Store } from "@/lib/contracts";
import { ACCESS_METHODS } from "@/lib/contracts";
import { detectPlatform, type DetectionResult } from "@/lib/crawl/detect";
import { createFetcher, type Fetcher } from "@/lib/crawl/fetch";
import { loadRobots, type RobotsInfo } from "@/lib/crawl/robots";
import { storeTarget, type StoreTarget } from "@/lib/crawl/url";
import { claimScan, getScan, getStoreById, setStoreReadiness, updateStore, upsertScan } from "@/lib/db";
import { AppError, isAppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { runChecks } from "./checks";
import { emptyProbe, statusFrom, type ProbeContext, type ProbeFn } from "./probe";
import { apiProbe } from "./probes/api";
import { computerUseProbe } from "./probes/computer-use";
import { domProbe } from "./probes/dom";
import { beforeReadiness, projectAfter, recommendations, scoreScan } from "./score";

// Tasks 11-13 register the dom and computer_use probes here; null ends the method "skipped" with not_implemented.
const PROBES: Record<AccessMethod, ProbeFn | null> = { api: apiProbe, dom: domProbe, computer_use: computerUseProbe };

const SCAN_BUDGET_MS = 270_000;
const CHECKS_BUDGET_MS = 20_000;
const PROBE_BUDGET_MS: Record<AccessMethod, number> = { api: 25_000, dom: 70_000, computer_use: 150_000 };
// Every probe stops 5 s before the scan deadline so scoring and the final writes still fit.
const END_MARGIN_MS = 5_000;
const MIN_PROBE_MS = 1_000;
// A probe that honours ctx.signal gets this long after the abort to hand back partial results.
const ABORT_GRACE_MS = 1_000;
const MIN_WRITE_GAP_MS = 500;
// Task 11's dom probe emits this ok signal when the recipe passed HTTP-only verification (R15: no browser stage C).
const RECIPE_HTTP_VERIFIED = "recipe_http_verified";

export interface RunScanOpts { methods?: AccessMethod[]; budgetMs?: number }

type BlockCode = "robots" | "content_signal" | "challenge";
type ProbeError = { code: string; message: string };

interface ScanState { report: ScanReport; writer: ScanWriter; startedAt: number }
interface ScanEnv {
  store: Store; target: StoreTarget; fetcher: Fetcher; robots: RobotsInfo; detection: DetectionResult;
  deadline: number; methods: AccessMethod[]; shared: ProbeContext["shared"];
}

// 02 section 6.9. Never throws; an owned scan always ends "done" or "failed".
export async function runScan(scanId: string, opts: RunScanOpts = {}): Promise<ScanReport> {
  let s: ScanState | null = null;
  try {
    const claimed = await claim(scanId);
    if (!claimed.owned) return claimed.report;
    s = { report: claimed.report, writer: createScanWriter(scanId), startedAt: Date.now() };
    log.info("scan.start", { scan_id: scanId, store_id: s.report.store_id, mode: s.report.mode });
    const env = await setup(s, opts);
    const block = blockCode(env);
    let checks: ReadinessCheck[] = [];
    if (block) markAllBlocked(s, block);
    else checks = await cascade(s, env);
    return await finish(s, env, checks);
  } catch (err) {
    if (s) return failScan(s, err);
    log.error("scan.failed", err, { scan_id: scanId });
    return failedReport(scanId);
  }
}

// ---------- step 1: load and claim ----------

async function claim(scanId: string): Promise<{ report: ScanReport; owned: boolean }> {
  const scan = await getScan(scanId);
  if (!scan) return { report: failedReport(scanId), owned: false };
  const claimed = await claimScan(scanId);
  if (!claimed) return { report: (await getScan(scanId)) ?? scan, owned: false };
  return { report: claimed, owned: true };
}

function failedReport(scanId: string): ScanReport {
  const now = new Date().toISOString();
  return {
    id: scanId, store_id: "", url: "", mode: "cascade", status: "failed", platform: "unknown", best_method: "none",
    probes: ACCESS_METHODS.map((m) => emptyProbe(m, "skipped")),
    score: 0, grade: "F", checks: [], after: null, recommendations: [], created_at: now, updated_at: now,
  };
}

// ---------- step 2: setup ----------

async function setup(s: ScanState, opts: RunScanOpts): Promise<ScanEnv> {
  const deadline = s.startedAt + (opts.budgetMs ?? SCAN_BUDGET_MS);
  const store = await getStoreById(s.report.store_id);
  if (!store) throw new AppError("not_found", "Store not found");
  save(s, { probes: ACCESS_METHODS.map((m) => emptyProbe(m)) });
  const target = storeTarget(store);
  const fetcher = createFetcher({ deadline });
  const robots = await loadRobots(fetcher, target.origin);
  const detection = await detectPlatform(fetcher, target);
  if (detection.platform !== "unknown") {
    save(s, { platform: detection.platform });
    if (store.platform === "unknown") await updateStore(store.id, { platform: detection.platform });
  }
  return {
    store, target, fetcher, robots, detection, deadline,
    methods: opts.methods ?? [...ACCESS_METHODS], shared: {},
  };
}

// ---------- step 3: blocked early exit ----------

function blockCode({ robots, detection }: ScanEnv): BlockCode | null {
  if (robots.blocksUs) return robots.blocksUs;
  if (detection.blocked === "robots") return "robots";
  if (detection.blocked === "challenge" || detection.blocked === "forbidden") return "challenge";
  return null;
}

const BLOCK_MESSAGES: Record<BlockCode, string> = {
  robots: "robots.txt does not allow our crawler on this store.",
  content_signal: "The store's Content-Signal opts out of AI input (ai-input=no).",
  challenge: "Bot protection challenged or refused the homepage.",
};

// Computer use is never attempted here: we do not try to get past bot protection.
function markAllBlocked(s: ScanState, code: BlockCode): void {
  const finished_at = new Date().toISOString();
  const error = { code, message: BLOCK_MESSAGES[code] };
  save(s, { probes: ACCESS_METHODS.map((m) => ({ ...emptyProbe(m, "blocked"), finished_at, error })) });
}

// ---------- steps 4-5: checks and cascade ----------

async function cascade(s: ScanState, env: ScanEnv): Promise<ReadinessCheck[]> {
  const checks = runChecksWithin(s, env);
  let passed = false;
  for (const [i, method] of ACCESS_METHODS.entries()) {
    // Only the api probe runs beside the checks; later probes reuse the ctx.shared they fill.
    if (method !== "api") await checks;
    const probe = await runMethod(s, env, i, method, passed);
    passed ||= probe.status === "passed";
  }
  return checks;
}

async function runChecksWithin(s: ScanState, env: ScanEnv): Promise<ReadinessCheck[]> {
  const budgetMs = Math.max(0, Math.min(CHECKS_BUDGET_MS, remainingMs(env)));
  const ctx = probeContext(s, env, budgetMs, () => Promise.resolve());
  try {
    return await untilAborted(runChecks(ctx), AbortSignal.timeout(budgetMs + ABORT_GRACE_MS));
  } catch (err) {
    log.warn("scan.checks.failed", { scan_id: s.report.id, msg: errorMessage(err) });
    return [];
  }
}

async function runMethod(s: ScanState, env: ScanEnv, i: number, method: AccessMethod, passed: boolean): Promise<AccessProbe> {
  const fn = PROBES[method];
  const budgetMs = Math.min(PROBE_BUDGET_MS[method], remainingMs(env));
  const skip: ProbeError | undefined =
    passed && s.report.mode === "cascade" ? { code: "cascade_stopped", message: "An earlier method passed." }
    : !env.methods.includes(method) ? { code: "disabled", message: "This method is not part of this scan." }
    : !fn ? { code: "not_implemented", message: `The ${method} probe is not available yet.` }
    : budgetMs < MIN_PROBE_MS ? { code: "time_budget", message: "Not enough scan time left to start this method." }
    : undefined;
  if (skip || !fn) {
    const probe: AccessProbe = { ...emptyProbe(method, "skipped"), error: skip };
    setProbe(s, i, probe);
    return probe;
  }
  return runProbe(s, env, i, method, fn, budgetMs);
}

async function runProbe(
  s: ScanState, env: ScanEnv, i: number, method: AccessMethod, fn: ProbeFn, budgetMs: number,
): Promise<AccessProbe> {
  const startedMs = Date.now();
  const started_at = new Date(startedMs).toISOString();
  setProbe(s, i, { ...emptyProbe(method, "running"), started_at });
  let open = true;
  const ctx = probeContext(s, env, budgetMs, (patch) => {
    // A timed-out probe may keep running in the background; its late updates must not overwrite the final state.
    if (open) setProbe(s, i, { ...s.report.probes[i], ...patch });
    return Promise.resolve();
  });

  let probe: AccessProbe;
  try {
    const out = await untilAborted(fn(ctx), AbortSignal.timeout(budgetMs + ABORT_GRACE_MS));
    const unfinished = out.status === "pending" || out.status === "running";
    probe = { ...out, method, status: unfinished ? statusFrom(out.capabilities) : out.status };
  } catch (err) {
    const error = ctx.signal.aborted
      ? { code: "timeout", message: `No result within the ${Math.round(budgetMs / 1000)} s budget.` }
      : { code: "probe_error", message: errorMessage(err) };
    log.warn("scan.probe.failed", { scan_id: s.report.id, method, code: error.code, msg: errorMessage(err) });
    probe = { ...s.report.probes[i], status: "failed", error };
  } finally {
    open = false;
  }
  probe = {
    ...probe,
    started_at: probe.started_at ?? started_at,
    finished_at: probe.finished_at ?? new Date().toISOString(),
    duration_ms: probe.duration_ms ?? Date.now() - startedMs,
  };
  setProbe(s, i, probe);
  return probe;
}

function probeContext(
  s: ScanState, env: ScanEnv, budgetMs: number, update: ProbeContext["update"],
): ProbeContext {
  return {
    scanId: s.report.id, store: env.store, target: env.target, fetcher: env.fetcher,
    robots: env.robots, detection: env.detection, shared: env.shared,
    deadline: Date.now() + budgetMs, signal: AbortSignal.timeout(budgetMs), update,
  };
}

const remainingMs = (env: ScanEnv) => env.deadline - END_MARGIN_MS - Date.now();

// Probes cannot be cancelled from outside, so the cascade stops waiting once the hard stop fires.
function untilAborted<T>(work: Promise<T>, stop: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onStop = () => reject(stop.reason);
    stop.addEventListener("abort", onStop, { once: true });
    work.then(resolve, reject).finally(() => stop.removeEventListener("abort", onStop));
  });
}

// ---------- steps 6-7: score and store side-effects ----------

async function finish(s: ScanState, env: ScanEnv, checks: ReadinessCheck[]): Promise<ScanReport> {
  const { probes } = s.report;
  const { best_method, score, grade } = scoreScan({ probes, checks });
  const after = projectAfter({ best_method, store: env.store, checks });
  save(s, {
    status: "done", best_method, score, grade, checks, after,
    recommendations: recommendations({ probes, checks, best_method, after }, env.store),
  });
  const done = (await s.writer.flush()) ?? s.report;
  log.info("scan.done", {
    scan_id: done.id, store_id: done.store_id, best_method, score, grade, ms: Date.now() - s.startedAt,
  });
  await applyToStore(env.store, done);
  return done;
}

async function applyToStore(store: Store, scan: ScanReport): Promise<void> {
  const recipe = persistableRecipe(scan);
  try {
    await updateStore(store.id, {
      best_method: scan.best_method, latest_scan_id: scan.id,
      ...(recipe ? { dom_recipe: recipe } : {}),
      metadata: { computer_use_only: scan.best_method === "computer_use" },
    });
    // R11: same output as computeReadiness(store, "before") right after a done scan, without the import cycle.
    await setStoreReadiness(store.id, "before", beforeReadiness(scan));
  } catch (err) {
    // The scan row is already done and correct, so a failed store refresh does not fail the scan.
    log.error("scan.store_update.failed", err, { scan_id: scan.id, store_id: store.id });
  }
}

// 02 section 6.5 Persistence: only a browser-verified or HTTP-verified recipe reaches stores.dom_recipe.
function persistableRecipe(scan: ScanReport): DomRecipe | null {
  const dom = scan.probes.find((p) => p.method === "dom");
  if (!dom?.recipe) return null;
  const httpVerified = dom.signals.some((sig) => sig.id === RECIPE_HTTP_VERIFIED && sig.ok);
  return dom.recipe.verified_at || httpVerified ? dom.recipe : null;
}

// ---------- step 8: infrastructure failure ----------

async function failScan(s: ScanState, err: unknown): Promise<ScanReport> {
  log.error("scan.failed", err, { scan_id: s.report.id, store_id: s.report.store_id });
  const finished_at = new Date().toISOString();
  const error = { code: "internal", message: isAppError(err) ? err.message : "Internal error" };
  const probes = s.report.probes.map((p) => (p.status === "running" ? { ...p, status: "failed" as const, finished_at, error } : p));
  save(s, { status: "failed", probes });
  try {
    return (await s.writer.flush()) ?? s.report;
  } catch {
    return s.report;
  }
}

// ---------- persistence ----------

function save(s: ScanState, patch: Partial<ScanReport>): void {
  Object.assign(s.report, patch);
  s.writer.push(patch);
}

function setProbe(s: ScanState, i: number, probe: AccessProbe): void {
  s.report.probes[i] = probe;
  save(s, { probes: s.report.probes });
}

type ScanWriter = ReturnType<typeof createScanWriter>;

// Single-flight and throttled to 2 writes/s (02 section 6.2); every write of a run goes through it, so writes never interleave.
function createScanWriter(scanId: string) {
  let pending: Partial<ScanReport> | null = null;
  let inflight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastStart = 0;
  let saved: ScanReport | null = null;
  let lastError: unknown = null;
  let drained: (() => void)[] = [];

  // The trailing write: whatever arrives during a write or inside the throttle window is sent once both end.
  function kick(): void {
    if (inflight || timer) return;
    if (!pending) {
      drained.forEach((resolve) => resolve());
      drained = [];
      return;
    }
    const wait = lastStart + MIN_WRITE_GAP_MS - Date.now();
    if (wait > 0) {
      timer = setTimeout(() => { timer = null; kick(); }, wait);
      return;
    }
    const patch = pending;
    pending = null;
    inflight = true;
    lastStart = Date.now();
    void send(patch);
  }

  async function send(patch: Partial<ScanReport>): Promise<void> {
    try {
      // Snapshot before the first await: the probes array keeps changing while a write is in flight.
      const snapshot = JSON.parse(JSON.stringify(patch)) as Partial<ScanReport>;
      saved = await upsertScan({ ...snapshot, id: scanId });
      lastError = null;
    } catch (err) {
      lastError = err;
      log.warn("scan.write.failed", { scan_id: scanId, msg: errorMessage(err) });
    } finally {
      inflight = false;
      kick();
    }
  }

  return {
    push(patch: Partial<ScanReport>): void {
      pending = { ...pending, ...patch };
      kick();
    },
    // Resolves once everything pushed so far is written, throttle included; rejects when the last write failed.
    async flush(): Promise<ScanReport | null> {
      await new Promise<void>((resolve) => {
        drained.push(resolve);
        kick();
      });
      if (lastError) throw lastError;
      return saved;
    },
  };
}

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}
