"use client";

import { useEffect, useState } from "react";
import type { AccessMethod, ReadinessGrade } from "../lib/contracts";
import { formatSeconds, formatUsd } from "../lib/format";
import { TYPICAL_COST } from "../lib/methods";
import { CountUp } from "../ui/CountUp";
import { GradeTile } from "../ui/GradeTile";
import { ArrowRight } from "../ui/icons";

const BEFORE_COPY: Record<AccessMethod | "none", string> = {
  api: "reachable through its own API",
  dom: "reachable only via web scraping",
  computer_use: "reachable only via computer use",
  none: "not reachable by agents",
};

type G = { grade: ReadinessGrade; score: number };

/**
 * With `animate` (arrived via ?from_scan): 400 ms delay, then the tile flips from the scan grade to the after grade and the
 * score counts up. Otherwise renders the static before → after pair.
 */
export function GradeHero({ before, after, method, animate }: {
  before: G | null; after: G | null; method: AccessMethod | "none" | null; animate: boolean;
}) {
  const [flipped, setFlipped] = useState(!animate);
  useEffect(() => {
    if (!animate) return;
    const t = setTimeout(() => setFlipped(true), 400);
    return () => clearTimeout(t);
  }, [animate]);

  const m = method ?? "dom";
  const beforeCost = m !== "none" ? TYPICAL_COST[m] : null;
  const beforeLine = `Before: ${BEFORE_COPY[m]}${beforeCost ? ` (${formatSeconds(beforeCost.s)} · ${formatUsd(beforeCost.usd)})` : ""}`;
  const nowLine = "Now: API via ShoperZero · ≈1 s · $0.00 per task";

  if (animate && before && after) {
    const shown = flipped ? after : before;
    return (
      <div className="flex flex-wrap items-center gap-5">
        <div className="flex items-center gap-3">
          <GradeTile key={shown.grade} grade={shown.grade} size="xl" label={flipped ? `Now ${after.grade}` : `Before ${before.grade}`} />
          <CountUp value={shown.score} from={before.score} className="font-mono text-[40px] font-semibold" />
        </div>
        <div className="min-w-0">
          <p className="text-[18px] font-semibold tracking-tight">{flipped ? nowLine : beforeLine}</p>
          <p className="text-[14px] text-muted">{flipped ? beforeLine : "Making it agent-ready…"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="flex items-center gap-3">
        {before ? (
          <div className="flex flex-col items-center">
            <GradeTile grade={before.grade} size="md" label={`Before ${before.grade}`} />
            <span className="mt-1 font-mono text-[12.5px] text-muted">{before.score}</span>
          </div>
        ) : null}
        {before && after ? <ArrowRight size={20} className="text-muted" /> : null}
        {after ? (
          <div className="flex flex-col items-center">
            <GradeTile grade={after.grade} size="xl" label={`Now ${after.grade}`} />
            <span className="mt-1 font-mono text-[12.5px] text-muted">{after.score}</span>
          </div>
        ) : null}
      </div>
      <div className="min-w-0">
        {after ? <p className="text-[18px] font-semibold tracking-tight">{nowLine}</p> : null}
        {before ? <p className="text-[14px] text-muted">{beforeLine}</p> : null}
        {!before && !after ? <p className="text-[14px] text-muted">Not graded yet.</p> : null}
      </div>
    </div>
  );
}
