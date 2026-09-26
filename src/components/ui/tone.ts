import type { Tone } from "../lib/format";

// Static class strings so Tailwind can see them. Tints use v4's color-mix opacity modifiers.
export const TONE: Record<Tone, { text: string; tint: string; border: string; dot: string; strip: string; ring: string }> = {
  good:    { text: "text-good-text",    tint: "bg-good/13",    border: "border-good",    dot: "bg-good",    strip: "bg-good",    ring: "ring-good" },
  good2:   { text: "text-good-2-text",  tint: "bg-good-2/14",  border: "border-good-2",  dot: "bg-good-2",  strip: "bg-good-2",  ring: "ring-good-2" },
  warn:    { text: "text-warn-text",    tint: "bg-warn/14",    border: "border-warn",    dot: "bg-warn",    strip: "bg-warn",    ring: "ring-warn" },
  serious: { text: "text-serious-text", tint: "bg-serious/14", border: "border-serious", dot: "bg-serious", strip: "bg-serious", ring: "ring-serious" },
  bad:     { text: "text-bad-text",     tint: "bg-bad/13",     border: "border-bad",     dot: "bg-bad",     strip: "bg-bad",     ring: "ring-bad" },
  accent:  { text: "text-accent-text",  tint: "bg-accent/13",  border: "border-accent",  dot: "bg-accent",  strip: "bg-accent",  ring: "ring-accent" },
  muted:   { text: "text-muted",   tint: "bg-well",       border: "border-line",    dot: "bg-muted",   strip: "bg-grid",    ring: "ring-line" },
};

export const TONE_VAR: Record<Tone, string> = {
  good: "var(--good)", good2: "var(--good-2)", warn: "var(--warn)", serious: "var(--serious)",
  bad: "var(--bad)", accent: "var(--accent)", muted: "var(--muted)",
};

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
