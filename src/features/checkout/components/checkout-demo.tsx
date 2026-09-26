"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { CheckoutEvent, CheckoutSession, CheckoutState } from "@/features/checkout/contracts";
import { PAYMENT_HANDLER_IDS } from "@/features/checkout/contracts";
import { SCENARIOS, type Scenario, type ProductFixture } from "@/features/checkout/demo/fixtures";
import styles from "@/features/checkout/components/demo.module.css";

const labels: Record<Scenario, string> = {
  success: "Successful purchase", declined: "Payment declined", requires_action: "Buyer action required",
  out_of_stock: "Out of stock", price_changed: "Price changed", order_failed: "Order placement failed",
  capture_failed: "Payment capture failed", handoff: "Merchant handoff",
};
const stateLabels: Record<CheckoutState, string> = {
  quoting: "Details needed", awaiting_payment: "Ready to pay", requires_action: "Approval needed",
  payment_authorized: "Authorized", placing_order: "Processing", order_placed: "Order placed",
  completed: "Complete", refunding: "Releasing payment", failed: "Failed", expired: "Expired",
  canceled: "Canceled", handoff: "Continue at store",
};
const messageCopy: Record<string, string> = {
  payment_declined: "Payment declined. No order was placed.",
  payment_requires_action: "Buyer approval required.",
  order_failed_refunded: "Order could not be placed. Payment authorization released.",
  capture_failed: "Payment failed. Order canceled and authorization released.",
  merchant_checkout_required: "Finish checkout on the merchant’s website.",
  unsupported_country: "Shipping is available within the US.",
};
const timelineCopy: Record<CheckoutState, string> = {
  quoting: "Checking availability", awaiting_payment: "Ready for payment", requires_action: "Buyer approval required",
  payment_authorized: "Payment authorized", placing_order: "Placing order", order_placed: "Order placed",
  completed: "Payment captured; order confirmed", refunding: "Releasing payment authorization",
  failed: "Order failed", expired: "Quote expired", canceled: "Checkout canceled", handoff: "Continue at store",
};
function eventText(event: CheckoutEvent) {
  if (event.from_state === null) return "Checkout created";
  return (event.data.error_code && messageCopy[event.data.error_code]) || timelineCopy[event.to_state];
}
export type Proof = { simulated: boolean; payment: { reference: string; status: string } | null;
  merchant_order: { id: string; status: string } | null; vendor_calls: { vendor: string; operation: string }[] };
const money = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount / 100);
async function request<T>(url: string, method = "GET", data?: unknown, key?: string): Promise<T> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? "Something went wrong. Please try again.");
  return result;
}

export default function CheckoutDemo({ enabled, initial, catalog = [], catalogError }: { enabled: boolean; catalog?: ProductFixture[]; catalogError?: string; initial?: { session: CheckoutSession; events: CheckoutEvent[]; proof: Proof } }) {
  const defaultVariant = catalog.find(p => p.external_id === "01HC075") ?? catalog[0];
  const [productId, setProductId] = useState(defaultVariant?.product_id ?? "");
  const [variantId, setVariantId] = useState(defaultVariant?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [shipping, setShipping] = useState(initial?.session.fulfillment?.selected_option_id ?? "standard");
  const products = [...new Map(catalog.map(p => [p.product_id, p])).values()];
  const sizes = catalog.filter(p => p.product_id === productId);
  const selected = catalog.find(p => p.id === variantId);
  const [scenario, setScenario] = useState<Scenario>("success");
  const [session, setSession] = useState<CheckoutSession | null>(initial?.session ?? null);
  const [events, setEvents] = useState<CheckoutEvent[]>(initial?.events ?? []);
  const [proof, setProof] = useState<Proof | null>(initial?.proof ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(catalogError ?? null);
  const completeKey = useRef<string | null>(null);
  const refresh = useCallback(async (id: string, next?: CheckoutSession, isCurrent: () => boolean = () => true) => {
    const [checkout, timeline, receipt] = await Promise.all([
      next ? Promise.resolve(next) : request<CheckoutSession>(`/api/v1/checkouts/${id}`),
      request<{ events: CheckoutEvent[] }>(`/api/v1/checkouts/${id}/events`),
      request<Proof>(`/api/mock/checkouts/${id}/proof`),
    ]);
    if (isCurrent()) { setSession(checkout); setEvents(timeline.events); setProof(receipt); }
  }, []);
  const watchedId = session?.id;
  const watchedState = session?.state;
  useEffect(() => {
    if (!enabled || busy || !watchedId || !watchedState || ["completed", "failed", "expired", "canceled", "handoff"].includes(watchedState)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await refresh(watchedId, undefined, () => !stopped); }
      catch { /* Preserve the last known state and retry transient read failures. */ }
      if (!stopped) timer = setTimeout(poll, 1000);
    };
    timer = setTimeout(poll, 1000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [enabled, busy, watchedId, watchedState, refresh]);
  async function action(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to complete this step."); }
    finally { setBusy(false); }
  }
  function start() { return action(async () => {
    let next = await request<CheckoutSession>("/api/mock/checkouts", "POST", { scenario, ...(variantId ? { variant_id: variantId, quantity } : {}) }, crypto.randomUUID());
    if (shipping === "express" && ["quoting", "awaiting_payment"].includes(next.state)) {
      next = await request<CheckoutSession>(`/api/v1/checkouts/${next.id}`, "PUT", { selected_shipping_option_id: shipping });
    }
    completeKey.current = crypto.randomUUID();
    await refresh(next.id, next);
  }); }
  function complete() { return action(async () => {
    if (!session) return;
    completeKey.current ??= crypto.randomUUID();
    const next = await request<CheckoutSession>(`/api/v1/checkouts/${session.id}/complete`, "POST", {
      payment: { instruments: [{ handler_id: PAYMENT_HANDLER_IDS.stripe_spt, type: "card", credential: { type: "spt", token: "mock_card_visa" } }] },
    }, completeKey.current);
    if (next.messages?.some(m => m.code === "price_changed")) completeKey.current = crypto.randomUUID();
    await refresh(next.id, next);
  }); }
  function cancel() { return action(async () => {
    if (!session) return;
    await refresh(session.id, await request<CheckoutSession>(`/api/v1/checkouts/${session.id}/cancel`, "POST"));
  }); }
  function resetSelection() { setSession(null); setEvents([]); setProof(null); completeKey.current = null; }
  function changeShipping(value: string) {
    setShipping(value);
    if (session && ["quoting", "awaiting_payment"].includes(session.state)) return action(async () => {
      completeKey.current = crypto.randomUUID();
      await refresh(session.id, await request<CheckoutSession>(`/api/v1/checkouts/${session.id}`, "PUT", { selected_shipping_option_id: value }));
    });
  }
  const subtotal = (selected?.price ?? 0) * quantity;
  const isProvence = selected?.domain !== "woo.demo.invalid";
  const previewShipping = isProvence ? shipping === "express" ? 1495 : subtotal >= 6500 ? 0 : 695 : 500;
  const previewTax = isProvence ? Math.round(subtotal * 825 / 10000) : 0;
  const total = session?.totals.find(t => t.type === "total")?.amount ?? subtotal + previewShipping + previewTax;
  const displayedLines = session?.line_items ?? (selected ? [{ id: selected.id, title: selected.title, variant_title: selected.variant_title, quantity, image_url: selected.image_url }] : []);
  const canCancel = session && ["quoting", "awaiting_payment", "requires_action", "handoff"].includes(session.state);
  const completed = session?.state === "completed";
  return <main className={styles.page}>
    <header className={styles.header}><Link href="/">shopper<span>zero</span></Link></header>
    <section className={styles.intro}><h1>Checkout</h1></section>
    {!enabled ? <section className={styles.card}><h2>Checkout unavailable</h2><p>Please try again later.</p></section> : <>
      {catalog.length > 0 && <section className={styles.controls} aria-label="Product selection">
        <label htmlFor="product">Product<select id="product" disabled={busy} value={productId} onChange={e => { const p = catalog.find(p => p.product_id === e.target.value)!; setProductId(p.product_id); setVariantId(p.id); resetSelection(); }}>{products.map(p => <option key={p.product_id} value={p.product_id}>{p.title}</option>)}</select></label>
        <label htmlFor="size">Size<select id="size" disabled={busy} value={variantId} onChange={e => { setVariantId(e.target.value); resetSelection(); }}>{sizes.map(p => <option key={p.id} value={p.id}>{p.variant_title}{p.stock === 0 ? " · Out of stock" : ""}</option>)}</select></label>
        <label htmlFor="quantity">Quantity<select id="quantity" disabled={busy} value={quantity} onChange={e => { setQuantity(Number(e.target.value)); resetSelection(); }}>{Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label>
      </section>}
      <section className={styles.controls}><label htmlFor="scenario">Scenario<select id="scenario" value={scenario} disabled={busy} onChange={e => setScenario(e.target.value as Scenario)}>{SCENARIOS.map(s => <option key={s} value={s}>{labels[s]}</option>)}</select></label>
        <button disabled={busy || (!!catalogError && !session)} onClick={start}>{busy ? "Working…" : session ? "New checkout" : "Create checkout"}</button>
      </section>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.grid}>
        <section className={styles.card} aria-label="Checkout summary"><div className={styles.cardTop}><h2>{completed ? "Purchase complete" : "Your checkout"}</h2><span className={styles.status}>{session ? stateLabels[session.state] : "Ready"}</span></div>
          {displayedLines.map(line => <div key={line.id} className={styles.product}>{line.image_url ? <Image className={styles.productImage} unoptimized src={line.image_url} alt={`${line.title}, ${line.variant_title}`} width={90} height={108} /> : <div className={styles.productArt} aria-hidden="true">SZ</div>}<div><p className={styles.eyebrow}>{session?.store.name ?? "Lumière de Provence"}</p><h3>{line.title}</h3><p>{line.variant_title} · Qty {line.quantity}</p></div></div>)}
          {(selected && isProvence || session?.connector === "provence_demo") && <label className={styles.shipping} htmlFor="shipping">Shipping<select id="shipping" value={session?.fulfillment?.selected_option_id ?? shipping} disabled={busy || !!session && !["quoting", "awaiting_payment"].includes(session.state)} onChange={e => changeShipping(e.target.value)}><option value="standard">Standard · 3–5 business days</option><option value="express">Express · 1–2 business days</option></select></label>}
          <dl className={styles.totals}>{(session?.totals ?? [{ type: "subtotal", amount: subtotal }, { type: "shipping", amount: previewShipping }, { type: "tax", amount: previewTax }, { type: "total", amount: total }]).map(t => <div key={t.type}><dt>{t.type}</dt><dd>{money(t.amount)}</dd></div>)}</dl>
          {session && <div className={styles.messages} aria-live="polite">{session.messages?.filter(m => !["timeline_url", "mock_mode"].includes(m.code)).map((m, i) => <p key={i} className={m.type === "error" ? styles.error : ""}>{messageCopy[m.code] ?? m.content}</p>)}</div>}
          {session?.state === "awaiting_payment" && <button disabled={busy} className={styles.wide} onClick={complete}>Confirm purchase · {money(total)}</button>}
          {(completed || session && ["payment_authorized", "placing_order", "order_placed"].includes(session.state)) && <button disabled={busy} className={styles.secondary} onClick={complete}>Retry checkout</button>}
          {session?.state === "handoff" && <p className={styles.handoff}><a href={session.continue_url}>Continue at Lumière →</a></p>}
          {canCancel && <button disabled={busy} className={styles.textButton} onClick={cancel}>Cancel checkout</button>}
          {session && <Link className={styles.receiptLink} href={`/checkouts/${session.id}`}>View checkout →</Link>}
        </section>
        <section className={styles.card} aria-label="Checkout timeline"><div className={styles.cardTop}><h2>Purchase timeline</h2><span className={styles.counter}>{events.length} events</span></div>
          {events.length ? <ol className={styles.timeline}>{events.map(event => <li key={event.id}><span className={styles.dot} /><div><strong>{eventText(event)}</strong><small>{event.created_at.slice(11, 19)} UTC</small></div></li>)}</ol> : <div className={styles.empty}><p>No activity yet.</p></div>}
        </section>
      </div>
      {session && <section className={`${styles.card} ${styles.proof}`} aria-label="Order details"><div className={styles.cardTop}><h2>Order details</h2></div><dl>
        <div><dt>Checkout</dt><dd>{session.id}</dd></div><div><dt>Payment</dt><dd>{proof?.payment ? `${proof.payment.reference} · ${proof.payment.status}` : "No authorization"}</dd></div>
        <div><dt>Merchant order</dt><dd>{proof?.merchant_order ? `${proof.merchant_order.id} · ${proof.merchant_order.status}` : "No order placed"}</dd></div>
      </dl>{session.order?.merchant_order_url && <a className={styles.receiptLink} href={session.order.merchant_order_url}>View merchant receipt →</a>}</section>}
    </>}
  </main>;
}
