"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toCheckoutEvent, type CheckoutEventRow } from "@/lib/db/mappers";
import type { CheckoutEvent, CheckoutSession, CheckoutState } from "../lib/contracts";
import { HAS_SUPABASE_ENV, UI_MOCK } from "../lib/flags";
import { redactCheckout, type PublicCheckout } from "../checkout/redact";
import { fetchJson, startLiveFeed, type LiveFeed } from "./live";
import { shiftTimes, usePlayhead } from "./replay";
import { browserSupabase } from "./supabase-browser";
import type { CheckoutReplayFrame, LiveMode } from "./types";

type Row = Record<string, unknown>;

export const TERMINAL_STATES: CheckoutState[] = ["completed", "failed", "expired", "canceled", "handoff"];

const rowToEvent = (r: Row): CheckoutEvent => toCheckoutEvent(r as unknown as CheckoutEventRow);

function mergeEvents(a: CheckoutEvent[], b: CheckoutEvent[]): CheckoutEvent[] {
  const byId = new Map<number, CheckoutEvent>();
  for (const e of [...a, ...b]) byId.set(e.id, e);
  return [...byId.values()].sort((x, y) => x.id - y.id);
}

type Feed = { checkoutId: string | null; checkout: PublicCheckout | null; events: CheckoutEvent[] };

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
    for (const f of upto) if (checkout && f.checkout) checkout = { ...checkout, state: f.checkout.state ?? checkout.state, status: f.checkout.status ?? checkout.status, updated_at: f.checkout.updated_at ?? checkout.updated_at };
    if (checkout && upto.length === replay.frames.length) checkout = { ...checkout, order: replay.checkout.order };
    const delta = startedAt == null ? 0 : startedAt - Date.parse(replay.frames[0]?.event.created_at ?? replay.checkout.created_at);
    return shiftTimes({ checkoutId: replay.checkout.id, checkout, events: upto.map((f) => f.event) }, delta);
  }, [replay, idx, startedAt]);

  // ---------- live ----------
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
    let feed: LiveFeed | null = null;
    const set = (next: Feed) => {
      latest.current = next;
      setLive(next);
      const last = next.events.at(-1);
      if (!follow && last && TERMINAL_STATES.includes(last.to_state)) feed?.terminalReached();
    };

    const loadCheckout = async (id: string) => {
      const r = await fetchJson<CheckoutSession>(`/api/v1/checkouts/${id}`);
      return r.ok ? redactCheckout(r.data) : null;
    };
    const loadEvents = async (id: string): Promise<CheckoutEvent[]> => {
      if (!HAS_SUPABASE_ENV) return [];
      const { data } = await browserSupabase().from("checkout_events").select("*").eq("checkout_id", id).order("id");
      return (data ?? []).map((r) => rowToEvent(r as Row));
    };
    const latestId = async (): Promise<string | null> => {
      if (!HAS_SUPABASE_ENV) return null;
      const { data } = await browserSupabase().from("checkout_events").select("checkout_id").order("id", { ascending: false }).limit(1).maybeSingle();
      return data ? String((data as Row).checkout_id) : null;
    };

    const switchTo = async (id: string) => {
      const [events, checkout] = await Promise.all([loadEvents(id), loadCheckout(id)]);
      set({ checkoutId: id, events, checkout });
    };

    const onEvent = (ev: CheckoutEvent) => {
      const cur = latest.current;
      if (cur.checkoutId !== ev.checkout_id) {
        if (!follow) return;
        // Follow mode: the first event of a new checkout attaches the page to it.
        set({ checkoutId: ev.checkout_id, events: [ev], checkout: null });
        void switchTo(ev.checkout_id).catch(() => {});
        return;
      }
      const prevState = cur.events.at(-1)?.to_state;
      set({ ...cur, events: mergeEvents(cur.events, [ev]) });
      if (ev.to_state !== prevState) {
        void loadCheckout(ev.checkout_id).then((c) => { if (c && latest.current.checkoutId === c.id) set({ ...latest.current, checkout: c }); });
      }
    };

    const reconcile = async () => {
      let id = latest.current.checkoutId;
      if (follow) {
        const newest = await latestId();
        if (newest && newest !== id) return switchTo(newest);
        id = newest ?? id;
      }
      if (!id) return;
      const [events, checkout] = await Promise.all([loadEvents(id), loadCheckout(id)]);
      if (latest.current.checkoutId !== id) return;
      set({ checkoutId: id, events: mergeEvents(latest.current.events, events), checkout: checkout ?? latest.current.checkout });
    };

    feed = startLiveFeed({
      topic: `checkout_events:${follow ? "latest" : target}`,
      realtime: HAS_SUPABASE_ENV,
      subscriptions: [{
        table: "checkout_events", event: "INSERT", ...(follow ? {} : { filter: `checkout_id=eq.${target}` }),
        onRow: (row) => onEvent(rowToEvent(row)),
      }],
      reconcile,
      isTerminal: () => {
        if (follow) return false;
        const last = latest.current.events.at(-1);
        return Boolean(last && TERMINAL_STATES.includes(last.to_state));
      },
      onMode: setMode,
      watchdogMs: follow ? 10_000 : 8000,
    });
    return () => feed?.stop();
  }, [replay, follow, target]);

  if (replayed) return { ...replayed, mode: "replay", follow };
  return { ...live, mode, follow };
}
