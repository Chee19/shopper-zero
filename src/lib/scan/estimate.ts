import "server-only";
import type { Usage } from "@anthropic-ai/sdk/resources/messages";
import type { AccessMethod } from "@/lib/contracts";

export const STATIC_ESTIMATES: Record<AccessMethod, { seconds: number; usd: number }> = {
  api: { seconds: 1, usd: 0 }, dom: { seconds: 20, usd: 0.06 }, computer_use: { seconds: 90, usd: 0.3 },
};

interface PriceRow { input: number; output: number; cacheWrite: number; cacheRead: number } // USD per MTok

// Verified 2026-09-26 against the Claude API reference; overrides 02 section 6.6's UNVERIFIED figures.
const PRICE_TABLE: Record<string, PriceRow> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.20 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.50, cacheRead: 0.20 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.10 },
};
const FALLBACK_MODEL = "claude-opus-5-5";

export class UsageMeter {
  private readonly price: PriceRow;
  private input = 0;
  private output = 0;
  private cacheWrite = 0;
  private cacheRead = 0;

  constructor(model: string) {
    this.price = PRICE_TABLE[model] ?? PRICE_TABLE[FALLBACK_MODEL];
  }

  add(usage: Usage): void {
    this.input += usage.input_tokens;
    this.output += usage.output_tokens;
    this.cacheWrite += usage.cache_creation_input_tokens ?? 0;
    this.cacheRead += usage.cache_read_input_tokens ?? 0;
  }

  usd(): number {
    const p = this.price;
    return (this.input * p.input + this.output * p.output + this.cacheWrite * p.cacheWrite + this.cacheRead * p.cacheRead) / 1e6;
  }
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
