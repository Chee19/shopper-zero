"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CheckoutEvent, CheckoutState } from "../lib/contracts";
import { UI_MOCK } from "../lib/flags";
import type { PublicCheckout } from "../checkout/redact";
import { fetchJson } from "./live";
import { shiftTimes, usePlayhead } from "./replay";
import type { CheckoutReplayFrame, LiveMode } from "./types";

export const TERMINAL_STATES: CheckoutState[] = ["completed", "failed", "expired", "canceled", "handoff"];

const POLL_MS = 1500;          // an open checkout: rows appear within ~1.5 s
const FOLLOW_POLL_MS = 2000;   // follow mode: look for a newer checkout
const LINGER_MS = 3000;        // keep polling after a terminal state for late order/capture rows
const MAX_BACKOFF_MS = 15_000; // after repeated failures
const IDLE_PAUSE_MS = 15 * 60_000; // a single checkout with no new event for 15 visible minutes pauses until focus

type Feed = { checkoutId: string | null; checkout: PublicCheckout | null; events: CheckoutEvent[] };
type UiCheckout = { checkout: PublicCheckout | null; events: CheckoutEvent[] };

function mergeEvents(a: CheckoutEvent[], b: CheckoutEvent[]): CheckoutEvent[] {
  const byId = new Map<number, CheckoutEvent>();
  for (const e of [...a, ...b]) byId.set(e.id, e);
  return [...byId.values()].sort((x, y) => x.id - y.id);
}

const isTerminal = (events: CheckoutEvent[]) => {
  const last = events.at(-1);
  return Boolean(last && TERMINAL_STATES.includes(last.to_state));
};

/**
 * checkout_events is private (DECISIONS C9): no Realtime and no browser reads. The feed polls the UI-only server routes
 * /api/v1/ui/checkouts/{id} (redacted checkout + events) and, in follow mode, /api/v1/ui/checkouts/latest.
 */
export function useCheckoutFeed(opts: {
  checkoutId: string | "latest";
  initialCheckout: PublicCheckout | null;
  initialEvents: CheckoutEvent[];
  replay?: { checkout: PublicCheckout; frames: CheckoutReplayFrame[] } | null;
}): Feed & { mode: LiveMode; follow: boolean } {
  const { replay } = opts;
  const follow = opts.checkoutId === "latest";

  // ---------- replay ----------
  const times = useMemo(() => (replay?.frames ?? []).map((f) => f.at_ms), [replay]);
  const { idx, startedAt } = usePlayhead(times, Boolean(replay));
  const replayed = useMemo<Feed | null>(() => {
    if (!replay) return null;
    const upto = replay.frames.slice(0, idx + 1);
    let checkout: PublicCheckout | null = upto.length ? { ...replay.checkout, order: undefined } : null;
    for (const f of upto) {
      if (checkout && f.checkout) {
        checkout = {
          ...checkout,
          state: f.checkout.state ?? checkout.state,
          status: f.checkout.status ?? checkout.status,
          updated_at: f.checkout.updated_at ?? checkout.updated_at,
        };
      }
    }
    if (checkout && upto.length === replay.frames.length) checkout = { ...checkout, order: replay.checkout.order };
    const delta = startedAt == null ? 0 : startedAt - Date.parse(replay.frames[0]?.event.created_at ?? replay.checkout.created_at);
    return shiftTimes({ checkoutId: replay.checkout.id, checkout, events: upto.map((f) => f.event) }, delta);
  }, [replay, idx, startedAt]);

  // ---------- live (polling) ----------
  const [live, setLive] = useState<Feed>({
    checkoutId: follow ? (opts.initialCheckout?.id ?? opts.initialEvents[0]?.checkout_id ?? null) : opts.checkoutId,
    checkout: opts.initialCheckout,
    events: opts.initialEvents,
  });
  const [mode, setMode] = useState<LiveMode>(replay ? "replay" : "connecting");
  const latest = useRef(live);
  const target = opts.checkoutId;

  useEffect(() => {
    if (replay || UI_MOCK) return;
    let stopped = false;
    let terminalAt: number | null = null;
    let wake: (() => void) | null = null;
    /** Resolves when the tab regains attention (focus / becomes visible) or the effect is torn down. */
    const waitForAttention = () =>
      new Promise<void>((resolve) => {
        const events = ["focus", "pointerdown", "keydown"] as const; // someone is looking at an already-focused tab
        const done = () => {
          for (const e of events) window.removeEventListener(e, done);
          document.removeEventListener("visibilitychange", onVis);
          wake = null;
          resolve();
        };
        const onVis = () => { if (document.visibilityState === "visible") done(); };
        wake = done;
        for (const e of events) window.addEventListener(e, done);
        document.addEventListener("visibilitychange", onVis);
      });
    const set = (next: Feed) => {
      latest.current = next;
      setLive(next);
    };

    /** One poll. Resolves false when the server answered with an error, so the pill stops claiming "Live". */
    const tick = async (): Promise<boolean> => {
      let id = latest.current.checkoutId;
      if (follow) {
        const r = await fetchJson<{ checkout_id: string | null }>("/api/v1/ui/checkouts/latest");
        if (!r.ok) return false;
        const newest = r.data.checkout_id;
        if (newest && newest !== id) {
          // Follow mode: switch to the newer checkout as soon as it exists.
          id = newest;
          terminalAt = null;
          set({ checkoutId: newest, checkout: null, events: [] });
        }
      }
      if (!id) return true;
      const r = await fetchJson<UiCheckout>(`/api/v1/ui/checkouts/${id}`);
      if (!r.ok) return false;
      if (stopped || latest.current.checkoutId !== id) return true;
      const cur = latest.current;
      set({ checkoutId: id, checkout: r.data.checkout ?? cur.checkout, events: mergeEvents(cur.events, r.data.events) });
      return true;
    };

    const loop = async () => {
      let failures = 0;
      let lastChange = Date.now();
      let lastKey = "";
      while (!stopped) {
        const base = follow ? FOLLOW_POLL_MS : POLL_MS;
        if (document.visibilityState === "hidden") {
          lastChange = Date.now(); // hidden time doesn't count as idle
          await new Promise((r) => setTimeout(r, base)); // no polling while the tab is hidden
          continue;
        }
        const ok = await tick().catch(() => false);
        if (stopped) return;
        setMode(ok ? "live" : "polling");
        failures = ok ? 0 : failures + 1;
        const key = `${latest.current.checkoutId}:${latest.current.events.at(-1)?.id ?? 0}`;
        if (key !== lastKey) {
          lastKey = key;
          lastChange = Date.now();
        } else if (!follow && Date.now() - lastChange > IDLE_PAUSE_MS) {
          // Follow mode never idles (the demo tab waits for the next checkout); a stale single checkout pauses
          // visibly and resumes as soon as someone looks at the tab again.
          setMode("paused");
          await waitForAttention();
          lastChange = Date.now();
          continue;
        }
        if (!follow && isTerminal(latest.current.events)) {
          terminalAt ??= Date.now();
          if (Date.now() - terminalAt > LINGER_MS) return;
        }
        await new Promise((r) => setTimeout(r, Math.min(MAX_BACKOFF_MS, base * 2 ** failures)));
      }
    };
    void loop();
    return () => {
      stopped = true;
      wake?.();
    };
  }, [replay, follow, target]);

  if (replayed) return { ...replayed, mode: "replay", follow };
  return { ...live, mode, follow };
}
