import type { LiveMode } from "./types";
import { browserSupabase } from "./supabase-browser";

type Row = Record<string, unknown>;

export type LiveSubscription = {
  table: string;
  event: "UPDATE" | "INSERT";
  filter?: string;
  onRow: (row: Row) => void;
};

export type LiveFeedOptions = {
  /** Channel topic prefix; a random suffix keeps StrictMode double mounts apart. */
  topic: string;
  subscriptions: LiveSubscription[];
  /** Re-reads the current state through REST (closes the SSR → subscription gap). */
  reconcile: () => Promise<void>;
  isTerminal: () => boolean;
  onMode: (mode: LiveMode) => void;
  /** false → no websocket at all, poll only (no Supabase env). */
  realtime: boolean;
  pollMs?: number;
  watchdogMs?: number;
  connectTimeoutMs?: number;
  lingerMs?: number;
};

export type LiveFeed = { stop: () => void; terminalReached: () => void };

/**
 * Realtime with a polling fallback (spec 05 §6.3):
 * SUBSCRIBED → reconcile once; CHANNEL_ERROR / TIMED_OUT / no SUBSCRIBED within connectTimeoutMs → poll every pollMs;
 * a watchdog reconciles when a non-terminal row gets no event for watchdogMs; terminalReached() keeps listening lingerMs, then stops.
 */
export function startLiveFeed(o: LiveFeedOptions): LiveFeed {
  const pollMs = o.pollMs ?? 2000;
  const watchdogMs = o.watchdogMs ?? 8000;
  const lingerMs = o.lingerMs ?? 3000;
  let stopped = false;
  let subscribed = false;
  let lastEvent = Date.now();
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lingerTimer: ReturnType<typeof setTimeout> | null = null;
  const timers: ReturnType<typeof setTimeout>[] = [];

  const reconcile = () => {
    if (stopped) return;
    o.reconcile().catch(() => { /* next tick retries */ });
  };
  const startPolling = () => {
    if (stopped || pollTimer) return;
    o.onMode("polling");
    reconcile();
    pollTimer = setInterval(reconcile, pollMs);
  };
  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };

  const sb = o.realtime ? browserSupabase() : null;
  const channel = sb ? sb.channel(`${o.topic}:${crypto.randomUUID()}`) : null;
  if (channel) {
    for (const s of o.subscriptions) {
      channel.on(
        "postgres_changes" as never,
        { event: s.event, schema: "public", table: s.table, ...(s.filter ? { filter: s.filter } : {}) } as never,
        (payload: { new?: Row }) => {
          lastEvent = Date.now();
          if (!stopped && payload?.new) s.onRow(payload.new);
        },
      );
    }
    channel.subscribe((status: string) => {
      if (stopped) return;
      if (status === "SUBSCRIBED") {
        subscribed = true;
        stopPolling();
        o.onMode("live");
        reconcile();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        subscribed = false;
        startPolling();
      }
    });
    timers.push(setTimeout(() => { if (!subscribed) startPolling(); }, o.connectTimeoutMs ?? 4000));
  } else {
    timers.push(setTimeout(startPolling, 0));
  }

  const watchdog = setInterval(() => {
    if (stopped || o.isTerminal() || pollTimer) return;
    if (Date.now() - lastEvent > watchdogMs) {
      lastEvent = Date.now();
      reconcile();
    }
  }, 1000);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopPolling();
    clearInterval(watchdog);
    timers.forEach(clearTimeout);
    if (lingerTimer) clearTimeout(lingerTimer);
    if (sb && channel) void sb.removeChannel(channel);
  };

  return {
    stop,
    terminalReached: () => {
      if (!lingerTimer && !stopped) lingerTimer = setTimeout(stop, lingerMs);
    },
  };
}

/** GET a JSON resource; null on 404/501 (route not landed) so callers can fall back to a direct public read. */
export async function fetchJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, data: (await res.json()) as T };
}

export const isoOr = (v: unknown, fallback: string): string => {
  if (typeof v !== "string" || !v) return fallback;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback;
};
