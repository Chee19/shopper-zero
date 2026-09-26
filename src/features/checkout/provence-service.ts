import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { CreateCheckoutInputSchema, UpdateCheckoutInputSchema, CompleteCheckoutInputSchema, PAYMENT_HANDLER_IDS, UCP_VERSION, QUOTE_TTL_SECONDS,
  type CheckoutService, type CheckoutSession, type CreateCheckoutInput, type RequestContext, type Message } from "./contracts";
import type { CheckoutEntry, CheckoutRepository, Ledger } from "./storage/file-repository";
import { DEMO_ADDRESS, DEMO_BUYER, type Scenario } from "./demo/fixtures";
import { ProvenceConnector, ProvenceRejection, PROVENCE_DEFAULT_SKU, PROVENCE_NAME, PROVENCE_STORE_ID, provenceId } from "./connectors/provence";
import { CheckoutError } from "./errors";
import { MockStripe } from "./payments/stripe";
import { annotate, transition } from "./state";
import { createCheckoutService } from "./service";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CheckoutError("validation_error", parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const errorMessage = (code: string, content: string): Message => ({ type: "error", code, content });
function normalized(value: CreateCheckoutInput) {
  const input = parse(CreateCheckoutInputSchema, value);
  const lines = new Map<string, number>();
  for (const l of input.line_items) lines.set(l.variant_id, (lines.get(l.variant_id) ?? 0) + l.quantity);
  if ([...lines.values()].some(n => n > 10)) throw new CheckoutError("validation_error", "Lumière allows up to 10 units per size.");
  return { ...input, line_items: [...lines].map(([variant_id, quantity]) => ({ variant_id, quantity })) };
}
function entry(db: Ledger, id: string) {
  if (!Object.hasOwn(db.checkouts, id)) throw new CheckoutError("not_found", "Checkout not found.", 404);
  return db.checkouts[id];
}
function bindKey(db: Ledger, scope: string, key: string | undefined, payload: unknown, id: string) {
  if (key === undefined) return undefined;
  if (!key.trim() || key.length > 255) throw new CheckoutError("validation_error", "Idempotency keys must be 1–255 characters.");
  const index = hash({ scope, key }), fingerprint = hash(payload), old = db.idempotency[index];
  if (old && old.fingerprint !== fingerprint) throw new CheckoutError("idempotency_conflict", "This idempotency key was already used with different input.", 409);
  if (!old) db.idempotency[index] = { fingerprint, checkout_id: id };
  return old?.checkout_id;
}

export function createProvenceService(repository: CheckoutRepository, options: { origin: string; appUrl?: string; now?: () => number; connector?: ProvenceConnector }) {
  const connector = options.connector ?? new ProvenceConnector(options.origin);
  const clock = options.now ?? Date.now;
  const now = () => new Date(clock()).toISOString();
  const appUrl = (options.appUrl ?? "http://127.0.0.1:4174").replace(/\/$/, "");
  const stripe = new MockStripe();
  const legacy = createCheckoutService(repository, options);
  async function catalog() {
    const products = await connector.catalog();
    await repository.transaction(db => { for (const p of products) db.products[p.id] = p; });
    return products;
  }
  function expire(db: Ledger, e: CheckoutEntry) {
    const s = e.session;
    if (s.expires_at && Date.parse(s.expires_at) <= clock() && ["awaiting_payment", "requires_action"].includes(s.state)) {
      transition(db, s, s.state === "awaiting_payment" ? "expired" : "failed", "Quote expired", now());
      s.messages = [errorMessage("quote_expired", "The quote expired. Create a new checkout.")];
    }
  }
  function resolve(db: Ledger, input: CreateCheckoutInput) {
    return input.line_items.map(l => {
      const p = db.products[l.variant_id];
      if (!p || p.store_id !== PROVENCE_STORE_ID) throw new CheckoutError("not_found", "Lumière variant not found.", 404);
      return p;
    });
  }
  async function quote(db: Ledger, e: CheckoutEntry, quiet = false) {
    const s = e.session, state = e.provence!;
    for (const p of await connector.catalog()) db.products[p.id] = p;
    const products = resolve(db, e.input);
    if (s.state === "awaiting_payment" && !quiet) transition(db, s, "quoting", "Refreshing quote", now());
    s.buyer = e.input.buyer;
    s.line_items = e.input.line_items.map((l, i) => {
      const p = products[i], price = p.price + (i === 0 ? state.priceDelta : 0);
      return { id: `li_${i + 1}`, variant_id: p.id, product_id: p.product_id, title: p.title, variant_title: p.variant_title,
        quantity: l.quantity, unit_price: { amount: price, currency: "USD" }, total: { amount: price * l.quantity, currency: "USD" }, image_url: p.image_url ?? null, url: p.url };
    });
    const subtotal = s.line_items.reduce((n, l) => n + l.total.amount, 0);
    const rates = [{ id: "standard", title: "Standard shipping", amount: subtotal >= 6500 ? 0 : 695 }, { id: "express", title: "Express shipping", amount: 1495 }];
    const shipping = rates.find(r => r.id === state.shipping)!.amount, tax = Math.round(subtotal * 825 / 10000);
    s.totals = [{ type: "subtotal", amount: subtotal }, { type: "shipping", amount: shipping }, { type: "tax", amount: tax }, { type: "total", amount: subtotal + shipping + tax }];
    s.fulfillment = { address: e.input.fulfillment?.address, options: rates.map(r => ({ ...r, amount: { amount: r.amount, currency: "USD" } })), selected_option_id: state.shipping };
    s.messages = [{ type: "info", code: "timeline_url", content: `${appUrl}/checkouts/${s.id}` }];
    s.payment.handlers = [];
    if (e.scenario === "handoff") {
      s.connector = "handoff"; s.continue_url = products[0].url;
      s.messages.push({ type: "warning", code: "merchant_checkout_required", content: "Finish checkout on the merchant’s website." });
      transition(db, s, "handoff", "Merchant checkout required", now()); return;
    }
    if (products.some((p, i) => p.stock < e.input.line_items[i].quantity)) s.messages.push(errorMessage("out_of_stock", "The requested quantity is unavailable."));
    if (!e.input.buyer) s.messages.push(errorMessage("missing_buyer", "Add buyer contact details."));
    if (!s.fulfillment.address) s.messages.push(errorMessage("missing_address", "Add a shipping address."));
    if (s.fulfillment.address && s.fulfillment.address.country !== "US") s.messages.push(errorMessage("unsupported_country", "Shipping is available within the US."));
    if (s.messages.some(m => m.type === "error")) {
      if (s.state === "awaiting_payment") transition(db, s, "quoting", "Quote needs attention", now());
      s.expires_at = null; return;
    }
    const result = await connector.quote(e.input, products, state.shipping, state.priceDelta);
    if (result.quote.unavailable.length) {
      if (s.state === "awaiting_payment") transition(db, s, "quoting", "Stock changed", now());
      s.messages.push(errorMessage("out_of_stock", "The requested quantity is unavailable.")); s.expires_at = null; return;
    }
    state.cookie = result.cookie;
    const q = result.quote;
    s.line_items.forEach((l, i) => {
      l.unit_price.amount = Math.round(q.cart.lines[i].unitPrice * 100); l.total.amount = l.unit_price.amount * l.quantity;
    });
    s.totals = [{ type: "subtotal", amount: q.subtotal_minor }, { type: "shipping", amount: Math.round(q.shipping * 100) },
      { type: "tax", amount: Math.round(q.tax * 100) }, { type: "total", amount: q.total_minor }];
    s.fulfillment.options = q.shipping_options.map(o => ({ ...o, amount: { amount: o.amount, currency: "USD" } }));
    s.expires_at = new Date(clock() + QUOTE_TTL_SECONDS * 1000).toISOString();
    if (!quiet || s.state === "quoting") transition(db, s, "awaiting_payment", "Ready for payment", now());
    s.payment.handlers = [{ id: PAYMENT_HANDLER_IDS.stripe_spt, rail: "stripe_spt", config: { accepted: ["card"], test_mode: true } }];
  }
  async function create(raw: CreateCheckoutInput, ctx: RequestContext, scenario: Scenario = "success") {
    const input = normalized(raw);
    return repository.transaction(async db => {
      const id = randomUUID(), old = bindKey(db, "provence:create", ctx.idempotency_key, { input, scenario }, id);
      if (old) { const e = entry(db, old); expire(db, e); return structuredClone(e.session); }
      const session: CheckoutSession = { id, simulated: true, ucp_version: UCP_VERSION,
        store: { id: PROVENCE_STORE_ID, slug: "lumiere-de-provence", domain: new URL(connector.origin).host, name: PROVENCE_NAME },
        connector: "provence_demo", state: "quoting", status: "incomplete", line_items: [], totals: [], currency: "USD", payment: { handlers: [] },
        links: [{ type: "timeline", url: `${appUrl}/checkouts/${id}` }], expires_at: null, created_at: now(), updated_at: now() };
      const e: CheckoutEntry = { session, input, scenario, provence: { shipping: "standard", priceDelta: 0 } };
      db.checkouts[id] = e;
      db.events.push({ id: db.events.length + 1, checkout_id: id, from_state: null, to_state: "quoting", message: "Checkout created", data: { simulated: true }, created_at: now() });
      try { await quote(db, e); }
      catch (error) {
        delete db.checkouts[id]; db.events = db.events.filter(event => event.checkout_id !== id);
        for (const [key, value] of Object.entries(db.idempotency)) if (value.checkout_id === id) delete db.idempotency[key];
        throw error;
      }
      return structuredClone(session);
    });
  }
  function failOrder(db: Ledger, e: CheckoutEntry) {
    const payment = db.payments[e.payment_reference!];
    transition(db, e.session, "refunding", "Releasing authorization", now()); stripe.voidOrRefund(db, payment);
    transition(db, e.session, "failed", "Order failed; authorization released", now(), { error_code: "order_failed_refunded" });
    e.session.messages = [errorMessage("order_failed_refunded", "Order could not be placed. Payment authorization released.")];
  }
  const service: CheckoutService = {
    createCheckout: create,
    async getCheckout(id) { return legacy.getCheckout(id); },
    async updateCheckout(id, raw, ctx) {
      if (!(await repository.transaction(db => !!entry(db, id).provence))) return legacy.updateCheckout(id, raw, ctx);
      const input = parse(UpdateCheckoutInputSchema, raw);
      return repository.transaction(async db => {
        const e = entry(db, id); expire(db, e);
        if (e.session.state === "expired") throw new CheckoutError("gone", "The quote expired.", 410);
        if (!["quoting", "awaiting_payment"].includes(e.session.state)) throw new CheckoutError("invalid_state", "This checkout cannot be updated.", 409);
        if (input.selected_shipping_option_id && !["standard", "express"].includes(input.selected_shipping_option_id)) throw new CheckoutError("validation_error", "Unknown shipping option.");
        const before = structuredClone(e);
        e.input = normalized({ ...e.input, ...(input.line_items ? { line_items: input.line_items } : {}), ...(input.buyer ? { buyer: input.buyer } : {}), ...(input.fulfillment ? { fulfillment: input.fulfillment } : {}) });
        if (input.selected_shipping_option_id) e.provence!.shipping = input.selected_shipping_option_id;
        const eventCount = db.events.length;
        try { await quote(db, e); } catch (error) { db.checkouts[id] = before; db.events.length = eventCount; throw error; }
        return structuredClone(e.session);
      });
    },
    async completeCheckout(id, raw, ctx) {
      if (!(await repository.transaction(db => !!entry(db, id).provence))) return legacy.completeCheckout(id, raw, ctx);
      const input = parse(CompleteCheckoutInputSchema, raw), key = ctx.idempotency_key ?? input.idempotency_key;
      if (ctx.idempotency_key && input.idempotency_key && ctx.idempotency_key !== input.idempotency_key) throw new CheckoutError("validation_error", "Body and header idempotency keys must match.");
      const token = input.payment.instruments[0].credential.token;
      if (!["mock_card_visa", "mock_card_declined", "mock_card_requires_action"].includes(token)) throw new CheckoutError("validation_error", "Only simulated payment credentials are accepted.");
      // Commit authorization and the attempt before the first order request. A retry resumes this intent.
      const prepared = await repository.transaction(async db => {
        const e = entry(db, id), s = e.session; expire(db, e);
        const fingerprint = hash(input.payment);
        const inProgress = ["payment_authorized", "placing_order", "order_placed"].includes(s.state);
        if (inProgress && e.provence!.completionFingerprint !== fingerprint) throw new CheckoutError("idempotency_conflict", "Payment details cannot change during completion.", 409);
        const previous = bindKey(db, `provence:complete:${id}`, key, input.payment, id);
        if (s.state === "completed" || (previous && !inProgress)) return structuredClone(s);
        if (inProgress) return structuredClone(s);
        if (s.state === "expired") throw new CheckoutError("gone", "The quote expired.", 410);
        if (s.state !== "awaiting_payment") throw new CheckoutError("invalid_state", "Checkout is not ready for payment.", 409);
        const before = structuredClone(e), eventCount = db.events.length;
        const approved = hash({ lines: s.line_items, totals: s.totals });
        if (e.scenario === "price_changed") { e.provence!.priceDelta = 100; e.scenario = "success"; }
        try { await quote(db, e, true); }
        catch (error) {
          db.checkouts[id] = before; db.events.length = eventCount;
          if (key) delete db.idempotency[hash({ scope: `provence:complete:${id}`, key })];
          throw error;
        }
        if (s.state !== "awaiting_payment") return structuredClone(s);
        if (approved !== hash({ lines: s.line_items, totals: s.totals })) {
          s.messages!.push(errorMessage("price_changed", "The price changed. Review the new total and confirm again.")); return structuredClone(s);
        }
        const effective = e.scenario === "declined" ? "mock_card_declined" : e.scenario === "requires_action" ? "mock_card_requires_action" : token;
        const payment = stripe.authorize(db, s, effective);
        if (payment === "declined") {
          s.messages = [errorMessage("payment_declined", "Payment declined. No order was placed.")]; annotate(db, s, "Payment declined", now(), { error_code: "payment_declined" }); return structuredClone(s);
        }
        if (payment === "requires_action") {
          transition(db, s, "requires_action", "Buyer approval required", now()); s.messages = [errorMessage("payment_requires_action", "Buyer approval required.")]; return structuredClone(s);
        }
        e.payment_reference = payment.reference; e.provence!.completionFingerprint = fingerprint;
        transition(db, s, "payment_authorized", "Payment authorized", now(), { payment_intent_id: payment.reference });
        transition(db, s, "placing_order", "Placing Lumière order", now()); return structuredClone(s);
      });
      if (!["payment_authorized", "placing_order", "order_placed"].includes(prepared.state)) return prepared;
      // The repository lock prevents concurrent Next workers from issuing duplicate order attempts.
      await repository.transaction(async db => {
        const e = entry(db, id), s = e.session;
        if (s.state !== "placing_order") return;
        if (e.scenario === "order_failed") { failOrder(db, e); return; }
        const payment = db.payments[e.payment_reference!];
        let merchant = await connector.findOrder(id);
        if (!merchant) {
          try {
            const fresh = await connector.quote(e.input, resolve(db, e.input), e.provence!.shipping, e.provence!.priceDelta);
            if (fresh.quote.unavailable.length || fresh.quote.total_minor !== payment.amount) { failOrder(db, e); return; }
            db.vendorCalls.push({ vendor: "provence", operation: "place_order", checkout_id: id, simulated: true });
            merchant = await connector.placeOrder(id, payment.reference, payment.amount, fresh.cookie);
          } catch (error) {
            if (error instanceof ProvenceRejection) { failOrder(db, e); return; }
            // A timeout may follow a successful order. Keep the intent so the next call reconciles it.
            throw error;
          }
        }
        if (merchant.payment_reference !== payment.reference || Math.round(merchant.total * 100) !== payment.amount || merchant.status !== "placed") {
          throw new CheckoutError("upstream_error", "The merchant order needs reconciliation. Retry checkout.", 502);
        }
        db.merchantOrders[merchant.id] = { id: merchant.id, checkout_id: id, payment_reference: payment.reference, status: "placed", simulated: true };
        const order = { id: randomUUID(), simulated: true as const, checkout_id: id, store_id: s.store.id, status: "placed" as const,
          merchant_order_id: merchant.id, merchant_order_url: connector.orderUrl(merchant.id),
          payment: { rail: "stripe_spt" as const, reference: payment.reference, amount: { amount: payment.amount, currency: "USD" } }, created_at: now() };
        db.orders[order.id] = order; s.order = order;
        transition(db, s, "order_placed", "Lumière order placed", now(), { merchant_order_id: merchant.id, merchant_order_url: order.merchant_order_url });
      });
      return repository.transaction(async db => {
        const e = entry(db, id), s = e.session;
        if (s.state !== "order_placed") return structuredClone(s);
        const payment = db.payments[e.payment_reference!], order = db.orders[s.order!.id];
        if (e.scenario === "capture_failed") {
          await connector.cancelOrder(order.merchant_order_id!, id);
          db.vendorCalls.push({ vendor: "provence", operation: "cancel_order", checkout_id: id, simulated: true });
          db.merchantOrders[order.merchant_order_id!].status = "canceled";
          stripe.voidOrRefund(db, payment); order.status = "failed"; s.order = order;
          transition(db, s, "failed", "Order canceled and authorization released", now(), { error_code: "capture_failed" });
          s.messages = [errorMessage("capture_failed", "Payment failed. Order canceled and authorization released.")];
        } else {
          stripe.capture(db, payment); order.status = "confirmed"; s.order = order;
          transition(db, s, "completed", "Order confirmed", now(), { merchant_order_id: order.merchant_order_id!, payment_intent_id: payment.reference, amount: order.payment.amount });
          s.messages = [];
        }
        return structuredClone(s);
      });
    },
    cancelCheckout: legacy.cancelCheckout,
    getOrder: legacy.getOrder,
    listCheckoutEvents: legacy.listCheckoutEvents,
  };
  return Object.assign(service, {
    catalog, proof: legacy.proof,
    async createDemoCheckout(scenario: Scenario, ctx: RequestContext, selection?: { variant_id?: string; quantity?: number }) {
      const id = scenario === "out_of_stock" ? provenceId("variant", "04FM150") : selection?.variant_id ?? provenceId("variant", PROVENCE_DEFAULT_SKU);
      return create({ line_items: [{ variant_id: id, quantity: selection?.quantity ?? 1 }], buyer: DEMO_BUYER, fulfillment: { address: DEMO_ADDRESS } }, ctx, scenario);
    },
  });
}
