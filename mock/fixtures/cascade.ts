// Emulates WS2's incremental `scans` writes from a finished ScanReport (spec 05 §9.2).
import type { AccessProbe, DomRecipe, ScanReport } from "@/components/lib/contracts";
import { METHOD_ORDER, pendingProbe } from "@/components/lib/methods";
import type { ScanReplayFrame } from "@/components/realtime/types";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function buildCascadeFrames(final: ScanReport, pace = 1): ScanReplayFrame[] {
  const base = Date.parse(final.created_at);
  const iso = (ms: number) => new Date(base + ms).toISOString();
  const frames: ScanReplayFrame[] = [];
  const probes: AccessProbe[] = METHOD_ORDER.map((m) => pendingProbe(m));
  let at = 0;

  const emit = (extra: Partial<ScanReport> = {}) =>
    frames.push({ at_ms: at, scan: { probes: clone(probes), updated_at: iso(at), ...extra } });

  emit({ status: "running", platform: "unknown", best_method: "none", score: 0, grade: "F", checks: [], after: null, recommendations: [] });
  at += 600 * pace;
  emit({ platform: final.platform });

  METHOD_ORDER.forEach((m, idx) => {
    const target = final.probes.find((p) => p.method === m);
    if (!target || target.status === "skipped") return;
    const started = at;
    probes[idx] = { ...pendingProbe(m), status: "running", started_at: iso(at) };
    at += 400 * pace;
    emit();

    const signals = target.signals;
    const steps = target.steps ?? [];
    if (m === "computer_use" && steps.length > 0) {
      // One step + screenshot per frame; signals trickle in alongside.
      steps.forEach((step, i) => {
        at += 2500 * pace;
        const nSignals = Math.round(((i + 1) / steps.length) * signals.length);
        probes[idx] = {
          ...probes[idx]!,
          steps: steps.slice(0, i + 1),
          screenshots: (target.screenshots ?? []).slice(0, i + 1),
          signals: signals.slice(0, nSignals),
        };
        emit();
      });
    } else {
      signals.forEach((_, i) => {
        at += 700 * pace;
        probes[idx] = { ...probes[idx]!, signals: signals.slice(0, i + 1) };
        emit();
      });
      if (target.recipe) {
        const recipe: DomRecipe = {};
        for (const [k, v] of Object.entries(target.recipe) as [keyof DomRecipe, string][]) {
          if (k === "notes" || k === "verified_at") continue;
          recipe[k] = v;
          at += 450 * pace;
          probes[idx] = { ...probes[idx]!, recipe: { ...recipe } };
          emit();
        }
      }
    }

    at += 500 * pace;
    probes[idx] = { ...clone(target), started_at: iso(started), finished_at: iso(at), duration_ms: at - started };
    emit();
  });

  METHOD_ORDER.forEach((m, idx) => {
    const target = final.probes.find((p) => p.method === m);
    if (target?.status === "skipped") probes[idx] = clone(target);
  });
  at += 400 * pace;
  emit({ best_method: final.best_method });

  at += 600 * pace;
  emit({
    status: "done",
    best_method: final.best_method,
    score: final.score,
    grade: final.grade,
    checks: clone(final.checks),
    after: clone(final.after),
    recommendations: clone(final.recommendations),
  });
  return frames;
}
