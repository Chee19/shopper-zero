"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import type { CheckoutEvent, CheckoutSession } from "@/lib/checkout/contracts";
import { PAYMENT_HANDLER_IDS } from "@/lib/checkout/contracts";
import { SCENARIOS, type Scenario } from "@/lib/checkout/fixtures";
import styles from "./demo.module.css";

const labels: Record<Scenario, string> = {
  success: "Successful purchase", declined: "Payment declined", requires_action: "Buyer action required",
  out_of_stock: "Out of stock", price_changed: "Price changed", order_failed: "Order placement failed",
  capture_failed: "Payment capture failed", handoff: "Merchant handoff",
};
export type Proof = { simulated: boolean; payment: { reference: string; status: string } | null;
  merchant_order: { id: string; status: string } | null; vendor_calls: { vendor: string; operation: string }[] };
const money = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount / 100);
async function request<T>(url: string, method = "GET", data?: unknown, key?: string): Promise<T> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? "Something went wrong. Please try again.");
  return result;
}

export default function CheckoutDemo({ enabled, initial }: { enabled: boolean; initial?: { session: CheckoutSession; events: CheckoutEvent[]; proof: Proof } }) {
  const [scenario, setScenario] = useState<Scenario>("success");
  const [session, setSession] = useState<CheckoutSession | null>(initial?.session ?? null);
  const [events, setEvents] = useState<CheckoutEvent[]>(initial?.events ?? []);
  const [proof, setProof] = useState<Proof | null>(initial?.proof ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const completeKey = useRef<string | null>(null);
  const refresh = useCallback(async (id: string, next?: CheckoutSession) => {
    const [checkout, timeline, receipt] = await Promise.all([
      next ? Promise.resolve(next) : request<CheckoutSession>(`/api/v1/checkouts/${id}`),
      request<{ events: CheckoutEvent[] }>(`/api/v1/checkouts/${id}/events`),
      request<Proof>(`/api/mock/checkouts/${id}/proof`),
    ]);
    setSession(checkout); setEvents(timeline.events); setProof(receipt);
  }, []);
  async function action(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to complete this step."); }
    finally { setBusy(false); }
  }
  function start() { return action(async () => {
    const next = await request<CheckoutSession>("/api/mock/checkouts", "POST", { scenario }, crypto.randomUUID());
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
  const total = session?.totals.find(t => t.type === "total")?.amount ?? 4900;
  const canCancel = session && ["quoting", "awaiting_payment", "requires_action", "handoff"].includes(session.state);
  const completed = session?.state === "completed";
  return <main className={styles.page}>
    <header className={styles.header}><Link href="/">shopper<span>zero</span></Link><span className={styles.badge}>MOCK VENDORS · NO MONEY MOVES</span></header>
    <section className={styles.intro}><p className={styles.eyebrow}>AGENTIC COMMERCE / CHECKOUT DEMO</p>
      <h1>A checkout that<br /><em>finishes the job.</em></h1>
      <p>Follow a purchase from quote to receipt. Stripe payments and WooCommerce orders are simulated; checkout state and evidence are saved locally.</p>
    </section>
    {!enabled ? <section className={styles.card}><h2>Demo is switched off</h2><p>Start the app with <code>npm run dev:mock</code> to use the local simulation.</p></section> : <>
      <section className={styles.controls}><label htmlFor="scenario">Choose a scenario<select id="scenario" value={scenario} disabled={busy} onChange={e => setScenario(e.target.value as Scenario)}>{SCENARIOS.map(s => <option key={s} value={s}>{labels[s]}</option>)}</select></label>
        <button disabled={busy} onClick={start}>{busy ? "Working…" : session ? "Start another checkout" : "Create demo checkout"}</button>
      </section>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.grid}>
        <section className={styles.card} aria-label="Checkout summary"><div className={styles.cardTop}><h2>{completed ? "Purchase complete" : "Your checkout"}</h2><span className={styles.status}>{session ? session.state.replaceAll("_", " ") : "ready to try"}</span></div>
          <div className={styles.product}><div className={styles.productArt} aria-hidden="true">SZ</div><div><p className={styles.eyebrow}>{session?.store.name ?? "WOO DEMO STORE"}</p><h3>{session?.line_items[0]?.title ?? "Everyday Hoodie"}</h3><p>{session?.line_items[0]?.variant_title ?? "Medium / Ink"} · Qty {session?.line_items[0]?.quantity ?? 1}</p></div></div>
          <dl className={styles.totals}>{(session?.totals ?? [{ type: "subtotal", amount: 4400 }, { type: "shipping", amount: 500 }, { type: "total", amount: 4900 }]).map(t => <div key={t.type}><dt>{t.type}</dt><dd>{money(t.amount)}</dd></div>)}</dl>
          {session && <div className={styles.messages} aria-live="polite">{session.messages?.filter(m => !["timeline_url", "mock_mode"].includes(m.code)).map((m, i) => <p key={i} className={m.type === "error" ? styles.error : ""}>{m.content}</p>)}</div>}
          {session?.state === "awaiting_payment" && <button disabled={busy} className={styles.wide} onClick={complete}>Confirm simulated purchase · {money(total)}</button>}
          {completed && <><p className={styles.success}>Simulated payment captured. Demo order confirmed.</p><button disabled={busy} className={styles.secondary} onClick={complete}>Retry completion · verify no duplicate</button></>}
          {session?.state === "handoff" && <p className={styles.handoff}>Continue URL: <code>{session.continue_url}</code><br />This is an example merchant address; no external checkout is opened.</p>}
          {canCancel && <button disabled={busy} className={styles.textButton} onClick={cancel}>Cancel checkout</button>}
          {!session && <p className={styles.muted}>Create a checkout to review the quote, then confirm the simulated purchase.</p>}
          {session && <Link className={styles.receiptLink} href={`/checkouts/${session.id}`}>Open saved checkout →</Link>}
        </section>
        <section className={styles.card} aria-label="Checkout timeline"><div className={styles.cardTop}><h2>Purchase timeline</h2><span className={styles.counter}>{events.length} events</span></div>
          {events.length ? <ol className={styles.timeline}>{events.map(event => <li key={event.id}><span className={styles.dot} /><div><strong>{event.message}</strong><small>{new Date(event.created_at).toLocaleTimeString()} · simulated</small></div></li>)}</ol> : <div className={styles.empty}><span>01 → 02 → 03</span><p>Quote. Authorize. Confirm.</p><small>Your purchase evidence will appear here.</small></div>}
        </section>
      </div>
      {session && <section className={`${styles.card} ${styles.proof}`} aria-label="Saved purchase evidence"><div className={styles.cardTop}><h2>Saved evidence</h2><span className={styles.badge}>SIMULATED</span></div><dl>
        <div><dt>Checkout</dt><dd>{session.id}</dd></div><div><dt>Payment</dt><dd>{proof?.payment ? `${proof.payment.reference} · ${proof.payment.status}` : "No authorization"}</dd></div>
        <div><dt>Merchant order</dt><dd>{proof?.merchant_order ? `${proof.merchant_order.id} · ${proof.merchant_order.status}` : "No order placed"}</dd></div>
        <div><dt>Vendor network calls</dt><dd>0 — all vendor operations are mocked</dd></div>
      </dl></section>}
    </>}
    <footer className={styles.footer}>Hackathon checkout MVP · Local fixtures · Simulated vendors · Persistent checkout events</footer>
  </main>;
}
