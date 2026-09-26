// Tolerant CrawlLogEntry reader: spec 00 has {at, step?, level, msg, data?}, spec 02 served {t, step, ...} (05 §12 R2-5).
type LooseLogEntry = {
  at?: string; t?: string; step?: string; level?: string; msg?: string;
  data?: { step?: string; total_estimate?: number; [key: string]: unknown };
};

export const logTime = (e: LooseLogEntry): string | null => e.at ?? e.t ?? null;
export const logStep = (e: LooseLogEntry): string | null => e.step ?? (typeof e.data?.step === "string" ? e.data.step : null);

export type StageId = "detect" | "discover" | "extract" | "publish" | "grade";
export const STAGES: { id: StageId; label: string }[] = [
  { id: "detect", label: "Detect" },
  { id: "discover", label: "Discover" },
  { id: "extract", label: "Extract" },
  { id: "publish", label: "Publish" },
  { id: "grade", label: "Grade" },
];

/** Maps a CrawlStep to a UI stage index (robots counts as Discover, readiness/done as Grade). */
export function stageIndex(step: string | null): number {
  switch (step) {
    case "detect": return 0;
    case "robots":
    case "discover": return 1;
    case "extract": return 2;
    case "publish": return 3;
    case "readiness": return 4;
    case "done": return 5;
    default: return -1;
  }
}

/** Highest stage reached according to the log; -1 when the log has no steps. */
export function currentStage(log: LooseLogEntry[] | null | undefined): number {
  if (!Array.isArray(log)) return -1;
  let max = -1;
  for (const e of log) max = Math.max(max, stageIndex(logStep(e)));
  return max;
}

export function latestTotalEstimate(log: LooseLogEntry[] | null | undefined): number | null {
  if (!Array.isArray(log)) return null;
  for (let i = log.length - 1; i >= 0; i--) {
    const n = log[i]?.data?.total_estimate;
    if (typeof n === "number" && n > 0) return n;
  }
  return null;
}
