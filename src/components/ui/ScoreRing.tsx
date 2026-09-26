import type { ReadinessGrade } from "../lib/contracts";
import { gradeTone } from "../lib/format";
import { CountUp } from "./CountUp";
import { TONE_VAR } from "./tone";

/** SVG score ring: track = tone at 16%, the fill stroke animates on mount, number in the center. */
export function ScoreRing({ score, grade, size = 150 }: { score: number; grade: ReadinessGrade; size?: number }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, score));
  const color = TONE_VAR[gradeTone(grade)];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          style={{ stroke: `color-mix(in srgb, ${color} 16%, transparent)` }} />
        <circle
          key={clamped}
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={len * (1 - clamped / 100)}
          style={{ stroke: color, ["--ring-len" as string]: len, animation: "ring-fill 900ms cubic-bezier(.2,.7,.2,1) both" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <CountUp value={clamped} from={0} className="text-[50px] font-semibold leading-none tracking-tight" />
        <span className="mt-1 font-mono text-[12px] text-muted">/100</span>
      </div>
      <span className="sr-only">Score {clamped} out of 100</span>
    </div>
  );
}
