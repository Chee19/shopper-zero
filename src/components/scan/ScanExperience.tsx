"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CrawlRun, ScanReport, Store } from "../lib/contracts";
import { domainOf, elapsed, formatDate } from "../lib/format";
import { PLATFORM_LABELS } from "../lib/methods";
import { useNow } from "../realtime/replay";
import type { ScanReplay } from "../realtime/types";
import { isScanTerminal, useScan } from "../realtime/useScan";
import { Button, ButtonLink } from "../ui/Button";
import { Chip, LivePill } from "../ui/Chip";
import { CopyButton } from "../ui/CopyButton";
import { ErrorState } from "../ui/States";
import { AgentReadyCta, type CtaResult } from "./AgentReadyCta";
import { startIndexing, startScan } from "./api";
import { CascadeBoard } from "./CascadeBoard";
import { IndexingPanel } from "./IndexingPanel";
import { ScoreReport } from "./ScoreReport";

export function ScanExperience({
  scan: initialScan, store, run, replay, demo, replayStoreHref,
}: {
  scan: ScanReport;
  store: Store | null;
  run: CrawlRun | null;
  replay: ScanReplay | null;
  demo: boolean;
  replayStoreHref: string | null;
}) {
  const router = useRouter();
  const { scan, mode } = useScan(initialScan, replay?.frames ?? null);
  const [replayIndexing, setReplayIndexing] = useState(false);
  const [indexKey, setIndexKey] = useState(0);
  const [rescan, setRescan] = useState<{ pending: boolean; error: string | null }>({ pending: false, error: null });
  const domain = store?.domain ?? domainOf(scan.url);
  const terminal = isScanTerminal(scan);
  const now = useNow(!terminal);

  const indexing = Boolean(run) || replayIndexing;
  const phase = indexing ? "indexing" : scan.status === "failed" ? "failed" : scan.status === "done" ? "report" : "cascade";

  const clockMs =
    now != null && !terminal ? now - Date.parse(scan.created_at) : Date.parse(scan.updated_at) - Date.parse(scan.created_at);

  async function makeReady(): Promise<CtaResult> {
    if (replay) {
      // Mirrors POST /api/v1/stores: a computer-use-only store has no catalog to index (422), a blocked one is blocked.
      if (scan.best_method === "none") return { error: "Blocked by bot protection.", blocked: true };
      if (scan.best_method === "computer_use") {
        return { error: "This store is reachable by computer use only, so there's no catalog to index. Claim it to connect a feed." };
      }
      setReplayIndexing(true);
      setIndexKey((k) => k + 1);
      scrollToIndexing();
      return null;
    }
    const r = await startIndexing({ storeId: scan.store_id, url: scan.url, demo });
    if (!r.ok) {
      if (r.code === "upstream_blocked" || (r.status === 409 && r.code === "conflict")) return { error: r.message, blocked: true };
      if (r.status === 0 || r.status >= 500) return { error: "Couldn't start indexing." };
      return { error: r.message };
    }
    router.replace(`/scan/${scan.id}?run=${r.data.crawl_run_id}${demo ? "&demo=1" : ""}`, { scroll: false });
    scrollToIndexing();
    return null;
  }

  async function scanAgain() {
    setRescan({ pending: true, error: null });
    const r = await startScan(scan.url);
    if (!r.ok) return setRescan({ pending: false, error: r.message });
    router.push(`/scan/${r.data.scan_id}${demo ? "?demo=1" : ""}`);
  }

  const failedProbe = [...(scan.probes ?? [])].reverse().find((p) => p.error);

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-5 px-5 py-8 md:px-7">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="mr-auto min-w-0 text-[24px] font-semibold tracking-tight md:text-[28px]">
          {phase === "cascade" ? `Scanning ${domain}` : `Agent Readiness Report · ${domain}`}
        </h1>
        {scan.platform !== "unknown" ? <Chip tone="muted">{PLATFORM_LABELS[scan.platform] ?? scan.platform}</Chip> : null}
        {replay ? (
          <Chip tone="muted" dot>Replay · recorded {formatDate(replay.recorded_at)}</Chip>
        ) : phase === "cascade" ? (
          // The indexing lane shows its own live/done pill from the lane's state.
          <LivePill mode={mode} />
        ) : null}
        <span className="font-mono text-[13px] tabular-nums text-ink-2" aria-label="Scan time">{elapsed(clockMs)}</span>
        <CopyButton currentUrl label="Share" className="border border-line" />
      </header>

      {phase === "cascade" ? <CascadeBoard scan={scan} now={now} domain={domain} /> : null}

      {phase === "failed" ? (
        <>
          <ErrorState
            title={`The scan couldn't finish${failedProbe?.error ? `: ${failedProbe.error.message}` : "."}`}
            action={
              <>
                <Button onClick={scanAgain} pending={rescan.pending}>Scan again</Button>
                <ButtonLink href="/scan/replay-dom" variant="secondary">Watch a recorded scan</ButtonLink>
              </>
            }
          >
            {rescan.error}
          </ErrorState>
          <CascadeBoard scan={scan} now={now} domain={domain} collapsible />
        </>
      ) : null}

      {phase === "report" || phase === "indexing" ? (
        <>
          <CascadeBoard scan={scan} now={now} domain={domain} collapsible />
          <ScoreReport scan={scan} domain={domain} />
          {phase === "report" ? (
            <AgentReadyCta
              scan={scan}
              domain={domain}
              slug={store?.slug ?? null}
              optedOut={Boolean(store?.opted_out)}
              onMakeReady={makeReady}
            />
          ) : null}
        </>
      ) : null}

      {phase === "indexing" && run && store ? (
        <IndexingPanel
          key={run.id}
          scan={scan}
          initial={{ run, store }}
          replayFrames={null}
          demo={demo}
          replayStoreHref={null}
          onRetry={makeReady}
        />
      ) : null}
      {phase === "indexing" && !run && replay ? (
        <IndexingPanel
          key={`replay-${indexKey}`}
          scan={scan}
          initial={{ run: replay.indexing.run, store: replay.indexing.store }}
          replayFrames={replay.indexing.frames}
          demo={demo}
          replayStoreHref={replayStoreHref}
          onRetry={async () => {
            setIndexKey((k) => k + 1);
            return null;
          }}
        />
      ) : null}
    </div>
  );
}

function scrollToIndexing() {
  setTimeout(() => document.getElementById("indexing")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
}
