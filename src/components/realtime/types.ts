import type { CheckoutEvent, CheckoutSession, CrawlRun, ScanReport, Store } from "../lib/contracts";

export type LiveMode = "connecting" | "live" | "polling" | "replay";

/** One Realtime-like snapshot. Probes are replaced wholesale per frame. */
export type ScanReplayFrame = { at_ms: number; scan: Partial<ScanReport> };

export type IndexingFrame = { at_ms: number; run?: Partial<CrawlRun>; store?: Partial<Store> };

export type ScanReplay = {
  id: string;
  recorded_at: string;
  final: ScanReport;
  frames: ScanReplayFrame[];
  indexing: { run: CrawlRun; store: Store; frames: IndexingFrame[] };
  store: Store;
};

export type CheckoutReplayFrame = { at_ms: number; event: CheckoutEvent; checkout?: Partial<CheckoutSession> };

export type CheckoutReplay = {
  id: string;
  recorded_at: string;
  checkout: CheckoutSession;   // final state
  frames: CheckoutReplayFrame[];
};
