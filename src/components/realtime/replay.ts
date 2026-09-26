"use client";

import { useEffect, useState } from "react";

/**
 * Plays a list of frame offsets (ms). Returns the index of the latest frame reached (-1 before start) and the wall-clock
 * start time (null until playback starts, so the server render stays deterministic).
 */
export function usePlayhead(times: number[], enabled: boolean): { idx: number; startedAt: number | null; done: boolean } {
  const [idx, setIdx] = useState(-1);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const key = times.join(",");

  useEffect(() => {
    if (!enabled) return;
    const offsets = key ? key.split(",").map(Number) : [];
    const t0 = Date.now();
    const timers = [setTimeout(() => setStartedAt(t0), 0)];
    offsets.forEach((ms, i) => timers.push(setTimeout(() => setIdx((cur) => Math.max(cur, i)), Math.max(0, ms))));
    return () => timers.forEach(clearTimeout);
  }, [key, enabled]);

  return { idx, startedAt, done: idx >= times.length - 1 && times.length > 0 };
}

/** A ticking wall clock; null on the server and first client render (keeps hydration stable). */
export function useNow(active: boolean, everyMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const first = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [active, everyMs]);
  return now;
}

const TS_KEYS = ["created_at", "updated_at", "started_at", "finished_at", "verified_at", "at"] as const;

/** Deep-shifts ISO timestamps by `delta` ms so a recorded replay plays as if it started now. */
export function shiftTimes<T>(value: T, delta: number): T {
  if (!delta) return value;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if ((TS_KEYS as readonly string[]).includes(k) && typeof x === "string") {
          const t = Date.parse(x);
          out[k] = Number.isFinite(t) ? new Date(t + delta).toISOString() : x;
        } else {
          out[k] = walk(x);
        }
      }
      return out;
    }
    return v;
  };
  return walk(value) as T;
}
