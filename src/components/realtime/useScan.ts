"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ScanReport } from "../lib/contracts";
import { HAS_SUPABASE_ENV, UI_MOCK } from "../lib/flags";
import { fetchJson, isoOr, startLiveFeed, type LiveFeed } from "./live";
import { shiftTimes, usePlayhead } from "./replay";
import { browserSupabase } from "./supabase-browser";
import type { LiveMode, ScanReplayFrame } from "./types";

type Row = Record<string, unknown>;

export const isScanTerminal = (s: Pick<ScanReport, "status">) => s.status === "done" || s.status === "failed";

/** `scans` row → ScanReport: the columns map one-to-one to the contract fields. */
export function rowToScanReport(r: Row, prev: ScanReport): ScanReport {
  const arr = <T,>(v: unknown, fb: T[]): T[] => (Array.isArray(v) ? (v as T[]) : fb);
  return {
    id: String(r.id ?? prev.id),
    store_id: String(r.store_id ?? prev.store_id),
    url: String(r.url ?? prev.url),
    mode: (r.mode as ScanReport["mode"]) ?? prev.mode,
    status: (r.status as ScanReport["status"]) ?? prev.status,
    platform: (r.platform as ScanReport["platform"]) ?? prev.platform,
    best_method: (r.best_method as ScanReport["best_method"]) ?? prev.best_method,
    probes: arr(r.probes, prev.probes),
    score: typeof r.score === "number" ? r.score : Number(r.score ?? prev.score) || 0,
    grade: (r.grade as ScanReport["grade"]) ?? prev.grade,
    checks: arr(r.checks, prev.checks),
    after: r.after === undefined ? prev.after : ((r.after as ScanReport["after"]) ?? null),
    recommendations: arr(r.recommendations, prev.recommendations),
    created_at: isoOr(r.created_at, prev.created_at),
    updated_at: isoOr(r.updated_at, prev.updated_at),
  };
}

/** Newer-or-equal wins, so a slow REST read never rolls the page back. */
function newer(a: ScanReport, b: ScanReport): ScanReport {
  return Date.parse(b.updated_at) >= Date.parse(a.updated_at) ? b : a;
}

export function useScan(initial: ScanReport, replay?: ScanReplayFrame[] | null): { scan: ScanReport; mode: LiveMode; replayDone: boolean } {
  // ---------- replay ----------
  const times = useMemo(() => (replay ?? []).map((f) => f.at_ms), [replay]);
  const { idx, startedAt, done } = usePlayhead(times, Boolean(replay));
  const replayed = useMemo(() => {
    if (!replay || replay.length === 0) return null;
    let s: ScanReport = { ...initial, ...replay[0]!.scan } as ScanReport;
    for (let i = 1; i <= idx && i < replay.length; i++) s = { ...s, ...replay[i]!.scan } as ScanReport;
    const delta = startedAt == null ? 0 : startedAt - Date.parse(initial.created_at);
    return shiftTimes(s, delta);
  }, [replay, idx, startedAt, initial]);

  // ---------- live ----------
  const [live, setLive] = useState<ScanReport>(initial);
  const [mode, setMode] = useState<LiveMode>(replay ? "replay" : "connecting");
  const latest = useRef(initial);
  const id = initial.id;

  useEffect(() => {
    if (replay || UI_MOCK) return;
    let feed: LiveFeed | null = null;
    const apply = (next: ScanReport) => {
      const merged = newer(latest.current, next);
      latest.current = merged;
      setLive(merged);
      if (isScanTerminal(merged)) feed?.terminalReached();
    };
    const reconcile = async () => {
      const r = await fetchJson<ScanReport>(`/api/v1/scans/${id}`);
      if (r.ok) return apply(r.data);
      if ((r.status === 404 || r.status === 501) && HAS_SUPABASE_ENV) {
        const { data } = await browserSupabase().from("scans").select("*").eq("id", id).maybeSingle();
        if (data) apply(rowToScanReport(data as Row, latest.current));
      }
    };
    feed = startLiveFeed({
      topic: `scans:${id}`,
      realtime: HAS_SUPABASE_ENV,
      subscriptions: [{
        table: "scans", event: "UPDATE", filter: `id=eq.${id}`,
        onRow: (row) => {
          // Payload guard: a truncated/oversized payload arrives without a probes array → re-read over REST.
          if (!Array.isArray(row.probes)) return void reconcile().catch(() => {});
          apply(rowToScanReport(row, latest.current));
        },
      }],
      reconcile,
      isTerminal: () => isScanTerminal(latest.current),
      onMode: setMode,
    });
    if (isScanTerminal(latest.current)) feed.terminalReached();
    return () => feed?.stop();
  }, [id, replay]);

  if (replayed) return { scan: replayed, mode: "replay", replayDone: done };
  return { scan: live, mode, replayDone: false };
}
