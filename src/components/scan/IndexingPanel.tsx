"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CrawlRun, ScanReport, Store } from "../lib/contracts";
import { UI_MOCK } from "../lib/flags";
import { domainOf, elapsed, formatDate } from "../lib/format";
import { STAGES, currentStage, latestTotalEstimate, logStep, logTime } from "../lib/log";
import { STRATEGY_LABELS } from "../lib/methods";
import { useCrawlLane } from "../realtime/useCrawlLane";
import type { IndexingFrame, LiveMode } from "../realtime/types";
import { Button, ButtonLink } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip, LivePill } from "../ui/Chip";
import { CountUp } from "../ui/CountUp";
import { GradeTile } from "../ui/GradeTile";
import { ArrowRight, Check } from "../ui/icons";
import { Banner } from "../ui/States";
import { cx } from "../ui/tone";

export function IndexingPanel({
  scan, initial, replayFrames, demo, replayStoreHref, onRetry,
}: {
  scan: ScanReport;
  initial: { run: CrawlRun; store: Store };
  replayFrames: IndexingFrame[] | null;
  demo: boolean;
  /** Replays only: store page to open when done (null outside mock mode when the real store doesn't exist). */
  replayStoreHref: string | null;
  onRetry: () => void;
}) {
  const { run, store, mode } = useCrawlLane(initial, replayFrames);
  const isReplay = Boolean(replayFrames);
  const domain = store.domain || domainOf(scan.url);
  const maxProducts = demo ? 40 : null;
  const estimate = latestTotalEstimate(run.log);
  const total = estimate != null ? (maxProducts ? Math.min(estimate, maxProducts) : estimate) : null;
  const pct = total ? Math.min(100, Math.round((run.products_found / total) * 100)) : null;
  const after = store.readiness?.after ?? null;
  const ready = run.status === "succeeded" && Boolean(after);
  const storeHref = isReplay ? replayStoreHref : `/stores/${store.slug}?from_scan=${scan.id}`;
  const autoNav = ready && Boolean(storeHref) && (!isReplay || UI_MOCK);

  let stage = currentStage(run.log);
  if (stage < 0) stage = run.status === "succeeded" ? 5 : run.status === "running" ? (run.products_found > 0 ? 2 : 1) : -1;
  if (run.status === "succeeded" && after) stage = 5;

  return (
    <div id="indexing" className="flex scroll-mt-20 flex-col gap-4">
      <Card className="px-5 py-5 md:px-7">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-[20px] font-semibold tracking-tight">Making {domain} agent-ready</h2>
          {run.strategy ? <Chip tone="muted">{STRATEGY_LABELS[run.strategy] ?? run.strategy}</Chip> : null}
          <ModePill mode={mode} terminal={run.status === "succeeded" || run.status === "failed"} />
        </div>

        <div className="mt-4 grid gap-5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
          <div>
            <CountUp value={run.products_found} className="font-mono text-[56px] leading-none font-semibold" />
            <div className="mt-1 text-[13px] text-ink-2">
              products normalized · {run.pages_fetched} pages · {run.pages_failed} failed
            </div>
          </div>
          <div className="min-w-0">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-well" role="progressbar"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-label="Indexing progress">
              {pct != null ? (
                <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${run.status === "succeeded" ? 100 : pct}%` }} />
              ) : (
                <div className={cx("h-full w-full", run.status === "succeeded" ? "bg-good" : "shimmer-bar animate-shimmer")} />
              )}
            </div>
            {total ? <div className="mt-1 font-mono text-[12px] text-muted">{run.products_found}/{total}</div> : null}
            <StageRail stage={stage} failed={run.status === "failed"} />
          </div>
          <div className="flex items-center gap-3">
            <GradeTile grade={scan.grade} size="md" label={`Before: ${scan.grade}`} />
            <ArrowRight size={18} className="text-muted" />
            {after ? (
              <GradeTile grade={after.grade} size="md" label={`After: ${after.grade}`} />
            ) : (
              <div className="flex flex-col items-center gap-1">
                <GradeTile grade={null} size="md" pending label="Grading" />
                <span className="text-[12px] text-muted">grading…</span>
              </div>
            )}
          </div>
        </div>

        <CrawlLog run={run} />

        {run.status === "failed" ? (
          <div role="alert" className="mt-4 rounded-xl border border-bad/40 bg-bad/8 px-4 py-3 text-[14px]">
            Indexing failed{run.error ? `: ${run.error}` : "."}
            <button type="button" onClick={onRetry} className="ml-2 text-accent-text hover:underline">Retry</button>
          </div>
        ) : null}
        {store.status === "blocked" ? (
          <div role="alert" className="mt-4 rounded-xl border border-warn/50 bg-warn/12 px-4 py-3 text-[14px]">
            This store challenged our crawler. We don&apos;t bypass bot protection. The merchant can claim it to opt in.
            <Link href={`/claim/${store.slug}`} className="ml-2 text-accent-text hover:underline">Claim this store →</Link>
          </div>
        ) : null}
      </Card>

      {ready && after ? (
        isReplay && !UI_MOCK ? (
          <Banner tone="good">
            <p className="font-[560]">Replay complete: {domain} went from {scan.grade} to {after.grade}.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {storeHref ? <ButtonLink href={storeHref}>Open the store page</ButtonLink> : null}
              <ButtonLink href="/" variant="secondary">Scan a store</ButtonLink>
            </div>
          </Banner>
        ) : (
          <ReadyBanner domain={domain} grade={after.grade} href={storeHref} autoNav={autoNav} />
        )
      ) : null}
    </div>
  );
}

function ModePill({ mode, terminal }: { mode: LiveMode; terminal: boolean }) {
  if (mode === "replay") return <Chip tone="muted">Replay</Chip>;
  if (terminal) return <Chip tone="good" dot>Done</Chip>;
  return <LivePill mode={mode} />;
}

function ReadyBanner({ domain, grade, href, autoNav }: { domain: string; grade: string; href: string | null; autoNav: boolean }) {
  const router = useRouter();
  const [stay, setStay] = useState(false);
  useEffect(() => {
    if (!autoNav || stay || !href) return;
    const t = setTimeout(() => router.push(href), 2500);
    return () => clearTimeout(t);
  }, [autoNav, stay, href, router]);

  const connectHref = href ? `${href}#connect` : null;
  return (
    <Banner tone="good" className="animate-rise">
      <p className="text-[17px]">
        {domain} is agent-ready: <strong className="font-semibold">{grade}</strong>. Agents can now search and buy.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {href ? <ButtonLink href={href}>Open agent surfaces <ArrowRight size={15} /></ButtonLink> : null}
        {connectHref ? <ButtonLink href={connectHref} variant="secondary">Connect Claude</ButtonLink> : null}
        {autoNav && !stay ? (
          <button type="button" onClick={() => setStay(true)} className="px-2 text-[13.5px] text-ink-2 hover:text-ink hover:underline">
            Stay here
          </button>
        ) : null}
        {autoNav && !stay ? <span className="text-[12.5px] text-muted">Opening the store page…</span> : null}
      </div>
    </Banner>
  );
}

export function StageRail({ stage, failed }: { stage: number; failed: boolean }) {
  return (
    <ol className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Stages">
      {STAGES.map((s, i) => {
        const done = stage > i || stage >= 5;
        const current = !done && stage === i;
        return (
          <li key={s.id} className="flex items-center gap-1.5 text-[13px]">
            <span
              aria-hidden="true"
              className={cx(
                "inline-flex size-4 items-center justify-center rounded-full",
                done ? "bg-good text-page" : current ? (failed ? "bg-bad" : "bg-accent animate-pulse-dot") : "bg-grid",
              )}
            >
              {done ? <Check size={10} strokeWidth={3} /> : null}
            </span>
            <span className={cx(done ? "text-ink" : current ? "font-[560] text-ink" : "text-muted")}>{s.label}</span>
            <span className="sr-only">{done ? "done" : current ? "in progress" : "pending"}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function CrawlLog({ run }: { run: CrawlRun }) {
  const entries = Array.isArray(run.log) ? run.log.slice(-6) : [];
  if (entries.length === 0) return null;
  const t0 = run.started_at ? Date.parse(run.started_at) : null;
  return (
    <ol className="mt-4 flex flex-col gap-1 rounded-xl bg-well px-3 py-2.5 font-mono text-[12px]" aria-label="Crawl log" aria-live="polite">
      {entries.map((e, i) => {
        const at = logTime(e);
        const rel = at && t0 != null ? elapsed(Date.parse(at) - t0) : at ? formatDate(at) : "";
        return (
          <li key={`${at}-${i}`} className="grid animate-rise grid-cols-[3.5rem_5.5rem_minmax(0,1fr)] gap-2">
            <span className="text-muted">{rel}</span>
            <span className="truncate text-muted">{logStep(e) ?? e.level}</span>
            <span className={cx("truncate", e.level === "error" ? "text-bad-text" : e.level === "warn" ? "text-warn-text" : "text-ink-2")} title={e.msg}>
              {e.msg}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function RetryButton({ onClick }: { onClick: () => void }) {
  return <Button variant="secondary" onClick={onClick}>Retry</Button>;
}
