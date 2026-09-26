import "server-only";
import type { CrawlLogEntry, CrawlStep } from "@/lib/contracts";
import { appendCrawlLog, updateCrawlRun, type CrawlRunPatch } from "@/lib/db";
import { log } from "@/lib/log";

export interface ProgressCounts { products_found: number; pages_fetched: number; pages_failed: number }

const THROTTLE_MS = 3000;
const PRODUCT_TRIGGER = 10;
// crawl_runs.log keeps only the last 50 entries, so a longer re-queue after a failed append is wasted.
const MAX_PENDING = 50;

// 02 section 5.10 step 3: one write in flight at a time, and changes made meanwhile coalesce into the next write.
export class ProgressWriter {
  readonly counts: ProgressCounts = { products_found: 0, pages_fetched: 0, pages_failed: 0 };
  private strategy: string | null = null;
  private entries: CrawlLogEntry[] = [];
  private step: CrawlStep | undefined;
  private newProducts = 0;
  private lastWrite = 0;
  private dirty = false;
  private again = false;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly runId: string) {}

  add(delta: Partial<ProgressCounts>): void {
    this.counts.products_found += delta.products_found ?? 0;
    this.counts.pages_fetched += delta.pages_fetched ?? 0;
    this.counts.pages_failed += delta.pages_failed ?? 0;
    this.newProducts += delta.products_found ?? 0;
    this.changed(this.newProducts >= PRODUCT_TRIGGER);
  }

  setStrategy(label: string): void {
    this.strategy = label;
    this.changed(true);
  }

  // Stamped here rather than by appendCrawlLog so throttled entries keep their real time.
  log(e: Omit<CrawlLogEntry, "at">): void {
    const stepChange = e.step !== undefined && e.step !== this.step;
    if (e.step) this.step = e.step;
    this.entries.push({ ...e, at: new Date().toISOString() });
    this.changed(stepChange);
  }

  // Waits out the write in flight, then makes one last attempt with whatever is still pending.
  async flush(): Promise<void> {
    this.closed = true;
    this.clearTimer();
    while (this.inFlight) await this.inFlight;
    if (this.dirty) await this.kick();
  }

  private changed(urgent: boolean): void {
    this.dirty = true;
    if (urgent) void this.kick();
    else if (!this.timer && !this.closed) {
      const wait = Math.max(0, THROTTLE_MS - (Date.now() - this.lastWrite));
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.kick();
      }, wait);
    }
  }

  private kick(): Promise<void> {
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    this.clearTimer();
    if (!this.dirty) return Promise.resolve();
    const patch: CrawlRunPatch = { ...this.counts, ...(this.strategy ? { strategy: this.strategy } : {}) };
    const entries = this.entries.splice(0);
    this.dirty = false;
    this.newProducts = 0;
    this.inFlight = this.write(patch, entries).finally(() => {
      this.inFlight = null;
      this.lastWrite = Date.now();
      if (this.again) {
        this.again = false;
        void this.kick();
      }
    });
    return this.inFlight;
  }

  // Never throws: counts are absolute, so the next write repairs a failed one.
  private async write(patch: CrawlRunPatch, entries: CrawlLogEntry[]): Promise<void> {
    try {
      await updateCrawlRun(this.runId, patch);
    } catch (err) {
      this.dirty = true;
      log.warn("crawl.progress.write_failed", { crawl_run_id: this.runId, target: "counts", error: String(err) });
    }
    if (!entries.length) return;
    try {
      await appendCrawlLog(this.runId, entries);
    } catch (err) {
      this.entries = [...entries, ...this.entries].slice(-MAX_PENDING);
      this.dirty = true;
      log.warn("crawl.progress.write_failed", { crawl_run_id: this.runId, target: "log", error: String(err) });
    }
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
