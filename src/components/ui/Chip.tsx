import type { Tone } from "../lib/format";
import { TONE, cx } from "./tone";

export function StatusDot({ tone = "muted", pulse = false, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx("inline-block size-[7px] shrink-0 rounded-full", TONE[tone].dot, pulse && "animate-pulse-dot", className)}
    />
  );
}

export function Chip({
  tone = "muted", dot = false, pulse = false, mono = false, className, children, title,
}: {
  tone?: Tone; dot?: boolean; pulse?: boolean; mono?: boolean; className?: string; children: React.ReactNode; title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12.5px] font-[560] leading-5",
        TONE[tone].tint,
        tone === "muted" ? "text-ink-2" : TONE[tone].text,
        mono && "font-mono text-[12px]",
        className,
      )}
    >
      {dot ? <StatusDot tone={tone} pulse={pulse} /> : null}
      {children}
    </span>
  );
}

export function LivePill({ mode }: { mode?: "connecting" | "live" | "polling" | "replay" }) {
  if (mode === "polling") {
    return <Chip tone="warn" dot pulse title="Realtime unavailable: polling every 2 s">Live · polling</Chip>;
  }
  if (mode === "connecting") {
    return <Chip tone="muted" dot pulse>Connecting…</Chip>;
  }
  return <Chip tone="bad" dot pulse>Live</Chip>;
}
