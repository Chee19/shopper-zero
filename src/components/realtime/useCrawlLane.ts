"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toCrawlRun, type CrawlRunRow } from "@/infrastructure/database/mappers";
import type { CrawlRun, Store } from "../lib/contracts";
import { HAS_SUPABASE_ENV, UI_MOCK } from "../lib/flags";
import { fetchJson, isoOr, startLiveFeed, type LiveFeed } from "./live";
import { shiftTimes, usePlayhead } from "./replay";
import { browserSupabase } from "./supabase-browser";
import type { IndexingFrame, LiveMode } from "./types";

type Row = Record<string, unknown>;
type Lane = { run: CrawlRun; store: Store };

export const isRunTerminal = (r: Pick<CrawlRun, "status">) => r.status === "succeeded" || r.status === "failed";

const rowToRun = (r: Row): CrawlRun => toCrawlRun(r as unknown as CrawlRunRow);

/** Merges the store columns the lane shows from a `stores` row (Realtime / public select). */
function mergeStoreRow(r: Row, prev: Store): Store {
  return {
    ...prev,
    status: (r.status as Store["status"]) ?? prev.status,
    product_count: typeof r.product_count === "number" ? r.product_count : prev.product_count,
    readiness: r.readiness && typeof r.readiness === "object" ? (r.readiness as Store["readiness"]) : prev.readiness,
    platform: (r.platform as Store["platform"]) ?? prev.platform,
    name: (r.name as string | null | undefined) ?? prev.name,
    updated_at: isoOr(r.updated_at, prev.updated_at),
  };
}

export function useCrawlLane(initial: Lane, replay?: IndexingFrame[] | null): Lane & { mode: LiveMode; replayDone: boolean } {
  // ---------- replay ----------
  const times = useMemo(() => (replay ?? []).map((f) => f.at_ms), [replay]);
  const { idx, startedAt, done } = usePlayhead(times, Boolean(replay));
  const replayed = useMemo(() => {
    if (!replay) return null;
    let run = initial.run;
    let store = initial.store;
    for (let i = 0; i <= idx && i < replay.length; i++) {
      const f = replay[i]!;
      if (f.run) run = { ...run, ...f.run };
      if (f.store) store = { ...store, ...f.store };
    }
    const delta = startedAt == null ? 0 : startedAt - Date.parse(initial.run.created_at);
    return { run: shiftTimes(run, delta), store };
  }, [replay, idx, startedAt, initial]);

  // ---------- live ----------
  const [live, setLive] = useState<Lane>(initial);
  const [mode, setMode] = useState<LiveMode>(replay ? "replay" : "connecting");
  const latest = useRef(initial);
  const runId = initial.run.id;
  const storeId = initial.store.id;
  const slug = initial.store.slug;

  useEffect(() => {
    if (replay || UI_MOCK) return;
    let feed: LiveFeed | null = null;
    const done = (l: Lane) => isRunTerminal(l.run) && (l.run.status === "failed" || Boolean(l.store.readiness.after));
    const set = (next: Lane) => {
      latest.current = next;
      setLive(next);
      if (isRunTerminal(next.run)) feed?.terminalReached();
    };
    const applyRun = (run: CrawlRun) => {
      if (Date.parse(run.updated_at) < Date.parse(latest.current.run.updated_at)) return;
      set({ ...latest.current, run });
    };
    const applyStore = (store: Store) => set({ ...latest.current, store });

    const reconcile = async () => {
      const [r, s] = await Promise.all([
        fetchJson<CrawlRun>(`/api/v1/crawl-runs/${runId}`),
        fetchJson<Store>(`/api/v1/stores/${slug}`),
      ]);
      if (r.ok) applyRun({ ...latest.current.run, ...r.data });
      if (s.ok) applyStore({ ...latest.current.store, ...s.data, urls: latest.current.store.urls });
      if ((!r.ok || !s.ok) && HAS_SUPABASE_ENV) {
        const sb = browserSupabase();
        const [rr, sr] = await Promise.all([
          r.ok ? null : sb.from("crawl_runs").select("*").eq("id", runId).maybeSingle(),
          s.ok ? null : sb.from("stores").select("*").eq("id", storeId).maybeSingle(),
        ]);
        if (rr?.data) applyRun(rowToRun(rr.data as Row));
        if (sr?.data) applyStore(mergeStoreRow(sr.data as Row, latest.current.store));
      }
    };
    feed = startLiveFeed({
      topic: `crawl:${runId}`,
      realtime: HAS_SUPABASE_ENV,
      subscriptions: [
        { table: "crawl_runs", event: "UPDATE", filter: `id=eq.${runId}`, onRow: (row) => applyRun(rowToRun(row)) },
        { table: "stores", event: "UPDATE", filter: `id=eq.${storeId}`, onRow: (row) => applyStore(mergeStoreRow(row, latest.current.store)) },
      ],
      reconcile,
      isTerminal: () => done(latest.current),
      onMode: setMode,
    });
    if (isRunTerminal(latest.current.run)) feed.terminalReached();
    return () => feed?.stop();
  }, [runId, storeId, slug, replay]);

  if (replayed) return { ...replayed, mode: "replay", replayDone: done };
  return { ...live, mode, replayDone: false };
}
