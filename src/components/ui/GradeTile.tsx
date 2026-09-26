import type { ReadinessGrade } from "../lib/contracts";
import { gradeTone } from "../lib/format";
import { TONE, TONE_VAR, cx } from "./tone";

const SIZE = {
  sm: "size-9 rounded-lg text-[17px] border-[1.5px]",
  md: "size-16 rounded-2xl text-[32px] border-[1.5px]",
  xl: "size-24 rounded-[22px] text-[52px] border-[1.5px]",
} as const;

/** Rounded square grade. `key={grade}` on the element retriggers the flip-in animation. */
export function GradeTile({
  grade, size = "md", pending = false, className, label,
}: { grade: ReadinessGrade | null; size?: keyof typeof SIZE; pending?: boolean; className?: string; label?: string }) {
  if (pending || !grade) {
    return (
      <span
        role="img"
        aria-label={label ?? "Grading"}
        className={cx(SIZE[size], "shimmer-bar animate-shimmer inline-flex shrink-0 items-center justify-center border-line opacity-60")}
      />
    );
  }
  const tone = gradeTone(grade);
  return (
    <span
      key={grade}
      role="img"
      aria-label={label ?? `Grade ${grade}`}
      style={{ borderColor: TONE_VAR[tone] }}
      className={cx(
        SIZE[size],
        "inline-flex shrink-0 items-center justify-center font-bold leading-none tracking-tight animate-flip-in",
        TONE[tone].tint,
        TONE[tone].text,
        className,
      )}
    >
      {grade}
    </span>
  );
}
