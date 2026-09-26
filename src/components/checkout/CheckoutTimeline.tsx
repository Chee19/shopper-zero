"use client";

import type { CheckoutEvent, CheckoutState } from "../lib/contracts";
import { STATE_TO_STATUS } from "../lib/contracts";
import { formatDate, formatMinor, formatMoney, shortId } from "../lib/format";
import { CONNECTOR_LABELS } from "../lib/methods";
import { TERMINAL_STATES, useCheckoutFeed } from "../realtime/useCheckoutFeed";
import type { CheckoutReplayFrame } from "../realtime/types";
import { Card } from "../ui/Card";
import { Chip, LivePill } from "../ui/Chip";
import { CopyButton } from "../ui/CopyButton";
import { External } from "../ui/icons";
import { Banner, EmptyState } from "../ui/States";
import { PaymentLinks, RAIL_LABEL } from "./PaymentLinks";
import type { PublicCheckout } from "./redact";
import { StateRail } from "./StateRail";

export function CheckoutTimeline({
  checkoutId, initialCheckout, initialEvents, replay, recordedAt, summaryUnavailable,
}: {
  checkoutId: string | "latest";
  initialCheckout: PublicCheckout | null;
  initialEvents: CheckoutEvent[];
  replay: { checkout: PublicCheckout; frames: CheckoutReplayFrame[] } | null;
  recordedAt: string | null;
  summaryUnavailable: boolean;
}) {
  const feed = useCheckoutFeed({ checkoutId, initialCheckout, initialEvents, replay });
  const { checkout, events, mode, follow } = feed;
  const lastState: CheckoutState | null = events.at(-1)?.to_state ?? checkout?.state ?? null;
  const terminal = lastState ? TERMINAL_STATES.includes(lastState) : false;

  if (!feed.checkoutId && events.length === 0) {
    return (
      <div className="mx-auto max-w-[1240px] px-5 py-16 md:px-7">
        <EmptyState title="Waiting for an agent to start a checkout…">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block size-2 animate-pulse-dot rounded-full bg-accent" /> This page attaches to the first checkout event.
          </span>
        </EmptyState>
      </div>
    );
  }

  const t0 = events[0] ? Date.parse(events[0].created_at) : null;
  const permalink = checkout?.links.find((l) => l.type === "timeline")?.url ?? (feed.checkoutId ? `/checkouts/${feed.checkoutId}` : null);
  const total = checkout?.totals.find((t) => t.type === "total");
  const rail = [...events].reverse().find((e) => e.data.rail)?.data.rail ?? checkout?.order?.payment.rail;
  const failure = lastState && ["failed", "expired", "canceled"].includes(lastState);
  const escalationUrl = checkout?.continue_url ?? [...events].reverse().find((e) => e.data.continue_url)?.data.continue_url;

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-5 px-5 py-8 md:px-7">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-[24px] font-semibold tracking-tight md:text-[28px]">Checkout {shortId(feed.checkoutId)}</h1>
        {checkout ? <span className="text-ink-2">{checkout.store.domain}</span> : null}
        {checkout ? <Chip tone="muted">{CONNECTOR_LABELS[checkout.connector] ?? checkout.connector}</Chip> : null}
        {lastState ? (
          <>
            <Chip tone={lastState === "completed" ? "good" : failure ? "bad" : lastState === "handoff" || lastState === "requires_action" ? "warn" : "accent"}>
              {STATE_TO_STATUS[lastState]}
            </Chip>
            {STATE_TO_STATUS[lastState] !== lastState ? <code className="font-mono text-[12.5px] text-muted">{lastState}</code> : null}
          </>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          {mode === "replay" ? (
            <Chip tone="muted" dot>Replay{recordedAt ? ` · recorded ${formatDate(recordedAt)}` : ""}</Chip>
          ) : !terminal ? (
            <LivePill mode={mode} />
          ) : null}
          {follow && permalink && mode !== "replay" ? (
            <a href={permalink} className="inline-flex items-center gap-1 text-[13px] text-accent-text hover:underline">
              Following latest · permalink <External size={11} />
            </a>
          ) : null}
        </span>
      </header>

      {lastState === "completed" && checkout ? (
        <Banner tone="good">
          <p className="text-[16px]">
            Agent checkout complete · <strong className="font-mono">{total ? formatMinor(total.amount, checkout.currency) : "—"}</strong>
            {rail ? ` · ${RAIL_LABEL[rail]}` : ""}
          </p>
        </Banner>
      ) : null}
      {failure ? (
        <Banner tone="bad">
          <p className="font-[560]">Checkout {lastState}</p>
          {checkout?.messages?.[0] ? <p className="text-[14px] text-ink-2">{checkout.messages[0].content}</p> : null}
        </Banner>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[15rem_minmax(0,1fr)_20rem]">
        <Card className="px-5 py-5">
          <h2 className="eyebrow mb-3">State</h2>
          <StateRail events={events} current={lastState} />
        </Card>

        <Card className="px-5 py-5">
          <h2 className="eyebrow mb-3">Events</h2>
          <ol className="flex flex-col" aria-live="polite" aria-label="Checkout events">
            {events.map((e) => <EventRow key={e.id} event={e} t0={t0} />)}
          </ol>
        </Card>

        <CheckoutSummary checkout={checkout} unavailable={summaryUnavailable && !checkout} escalationUrl={escalationUrl ?? null} lastState={lastState} />
      </div>
    </div>
  );
}

function EventRow({ event, t0 }: { event: CheckoutEvent; t0: number | null }) {
  const rel = t0 != null ? ((Date.parse(event.created_at) - t0) / 1000).toFixed(1) : "0.0";
  return (
    <li className="grid animate-rise grid-cols-[3.5rem_minmax(0,1fr)] gap-3 border-t border-line py-3 first:border-t-0 first:pt-0">
      <span className="font-mono text-[12.5px] text-muted tabular-nums">+{rel}s</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[12px]">
          {event.from_state ? <><Chip tone="muted" mono>{event.from_state}</Chip><span className="text-muted">→</span></> : <span className="text-muted">→</span>}
          <Chip tone={event.to_state === "completed" ? "good" : ["failed", "expired", "canceled"].includes(event.to_state) ? "bad" : event.to_state === "handoff" || event.to_state === "requires_action" ? "warn" : "accent"} mono>
            {event.to_state}
          </Chip>
        </div>
        {event.message ? <p className="mt-1 text-[14px]">{event.message}</p> : null}
        <PaymentLinks data={event.data} />
      </div>
    </li>
  );
}

function CheckoutSummary({ checkout, unavailable, escalationUrl, lastState }: {
  checkout: PublicCheckout | null; unavailable: boolean; escalationUrl: string | null; lastState: CheckoutState | null;
}) {
  if (!checkout) {
    return (
      <Card className="px-5 py-5 text-[14px] text-ink-2">
        {unavailable ? "Checkout details unavailable. Showing event log." : "Loading checkout details…"}
      </Card>
    );
  }
  const c = checkout.currency;
  const selected = checkout.shipping?.options.find((o) => o.id === checkout.shipping?.selected_option_id);
  const handlers = checkout.payment.handlers;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="px-5 py-5">
        <h2 className="eyebrow mb-3">Summary</h2>
        <ul className="flex flex-col gap-2 text-[14px]">
          {checkout.line_items.map((li) => (
            <li key={li.id} className="flex justify-between gap-3">
              <span className="min-w-0">
                {li.quantity} × {li.title}
                {li.variant_title && li.variant_title !== "Default Title" ? <span className="text-muted"> ({li.variant_title})</span> : null}
              </span>
              <span className="shrink-0 font-mono">{formatMoney(li.total)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-[14px]">
          {checkout.totals.map((t) => (
            <div key={t.type} className={`flex justify-between ${t.type === "total" ? "font-semibold" : "text-ink-2"}`}>
              <dt className="capitalize">{t.type === "shipping" && selected ? `Shipping · ${selected.title}` : t.display_text && t.type !== "shipping" ? t.display_text : t.type}</dt>
              <dd className="font-mono">{formatMinor(t.amount, c)}</dd>
            </div>
          ))}
        </dl>
        {checkout.ship_to ? (
          <p className="mt-3 text-[13px] text-ink-2">
            Ship to {checkout.ship_to.initials} · {checkout.ship_to.city}, {checkout.ship_to.country}
          </p>
        ) : null}
        {handlers.length > 0 ? (
          <p className="mt-2 text-[12.5px] text-muted">Payment handlers: {handlers.map((h) => RAIL_LABEL[h.rail]).join(", ")}</p>
        ) : null}
      </Card>

      {checkout.order ? (
        <Card className="px-5 py-5 text-[14px]">
          <h2 className="eyebrow mb-2">Order</h2>
          <p className="font-[560]">Merchant order #{checkout.order.merchant_order_id ?? "—"}</p>
          {checkout.order.merchant_order_url ? (
            <a href={checkout.order.merchant_order_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-text hover:underline">
              Open in {checkout.connector === "woo_store_api" ? "Woo" : "merchant admin"} <External size={12} />
            </a>
          ) : null}
          <p className="mt-2 text-ink-2">{RAIL_LABEL[checkout.order.payment.rail]} payment reference</p>
          <p className="flex min-w-0 items-center gap-1">
            <code className="min-w-0 truncate font-mono text-[12px]" title={checkout.order.payment.reference}>{checkout.order.payment.reference}</code>
            <CopyButton text={checkout.order.payment.reference} />
          </p>
        </Card>
      ) : null}

      {escalationUrl && (lastState === "handoff" || checkout.status === "requires_escalation") ? (
        <Card className="border-warn/50 px-5 py-5 text-[14px]">
          <h2 className="eyebrow mb-2">Handoff</h2>
          <p className="text-ink-2">This store has no agent checkout API. We hand off honestly with a prefilled cart.</p>
          <a href={escalationUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 font-[560] text-accent-text hover:underline">
            Continue on merchant site <External size={12} />
          </a>
        </Card>
      ) : null}
    </div>
  );
}
