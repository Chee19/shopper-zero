import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CompleteCheckoutInputSchema, CreateCheckoutInputSchema, UpdateCheckoutInputSchema,
  PAYMENT_HANDLER_IDS, QUOTE_TTL_SECONDS, UCP_VERSION,
  type CheckoutService, type CheckoutSession, type CreateCheckoutInput, type Message,
  type RequestContext, type UpdateCheckoutInput,
} from "@/features/checkout/contracts";
import { DEMO_ADDRESS, DEMO_BUYER, DEMO_VARIANT_ID, HANDOFF_VARIANT_ID, SHIPPING_ID, SOLD_OUT_VARIANT_ID, type Scenario } from "@/features/checkout/demo/fixtures";
import { CheckoutError } from "@/features/checkout/errors";
import type { CheckoutEntry, CheckoutRepository, Ledger } from "@/features/checkout/storage/file-repository";
import { annotate, transition } from "@/features/checkout/state";
import { MockStripe } from "@/features/checkout/payments/stripe";
import { MockWoo } from "@/features/checkout/connectors/woo";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new CheckoutError("validation_error", result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  return result.data;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function fingerprint(value: unknown) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function normalize(input: CreateCheckoutInput): CreateCheckoutInput {
  const lines = new Map<string, number>();
  for (const line of input.line_items) lines.set(line.variant_id, (lines.get(line.variant_id) ?? 0) + line.quantity);
  if ([...lines.values()].some(q => q > 20)) throw new CheckoutError("validation_error", "A variant may have at most 20 units.");
  return { ...input, line_items: [...lines].map(([variant_id, quantity]) => ({ variant_id, quantity })) };
}
function getEntry(db: Ledger, id: string): CheckoutEntry {
  if (!Object.hasOwn(db.checkouts, id)) throw new CheckoutError("not_found", "Checkout not found.", 404);
  return db.checkouts[id];
}
function message(code: string, content: string): Message { return { type: "error", code, content }; }

export function createCheckoutService(repository: CheckoutRepository, options: { now?: () => number; appUrl?: string } = {}) {
  const clock = options.now ?? Date.now;
  const now = () => new Date(clock()).toISOString();
  const appUrl = (options.appUrl ?? "http://localhost:3000").replace(/\/$/, "");
  const stripe = new MockStripe();
  const woo = new MockWoo();
  function products(db: Ledger, input: CreateCheckoutInput, entry?: CheckoutEntry) {
    const resolved = input.line_items.map(line => {
      if (!Object.hasOwn(db.products, line.variant_id)) throw new CheckoutError("not_found", "Variant not found in the mock catalog.", 404);
      const product = db.products[line.variant_id];
      return { product: { ...product, price: entry?.priceOverrides?.[product.id] ?? product.price }, quantity: line.quantity };
    });
    if (new Set(resolved.map(l => l.product.store_id)).size !== 1) throw new CheckoutError("unprocessable", "A checkout must contain products from one store.", 422);
    return resolved;
  }
  function expire(db: Ledger, entry: CheckoutEntry) {
    const s = entry.session;
    if (s.expires_at && Date.parse(s.expires_at) <= clock()) {
      if (s.state === "awaiting_payment") transition(db, s, "expired", "Quote expired", now());
      else if (s.state === "requires_action") transition(db, s, "failed", "Buyer action timed out", now());
      else return;
      s.messages = [message("quote_expired", "The quote expired. Create a new checkout.")];
    }
  }
  function quote(db: Ledger, entry: CheckoutEntry, selected?: string) {
    const s = entry.session;
    const resolved = products(db, entry.input, entry);
    if (selected && selected !== SHIPPING_ID) throw new CheckoutError("validation_error", "Unknown shipping option.");
    const first = resolved[0].product;
    if (first.store_id !== s.store.id) throw new CheckoutError("unprocessable", "A checkout cannot switch stores.", 422);
    if (s.state === "awaiting_payment") transition(db, s, "quoting", "Refreshing quote", now());
    s.buyer = entry.input.buyer;
    s.line_items = resolved.map(({ product: p, quantity }, i) => ({
      id: `li_${i + 1}`, variant_id: p.id, product_id: p.product_id, title: p.title,
      variant_title: p.variant_title, quantity, unit_price: { amount: p.price, currency: "USD" },
      total: { amount: p.price * quantity, currency: "USD" }, image_url: null, url: p.url,
    }));
    const subtotal = s.line_items.reduce((sum, line) => sum + line.total.amount, 0);
    s.totals = [{ type: "subtotal", amount: subtotal }, { type: "shipping", amount: 500 },
      { type: "tax", amount: 0 }, { type: "total", amount: subtotal + 500 }];
    s.fulfillment = { address: entry.input.fulfillment?.address,
      options: [{ id: SHIPPING_ID, title: "Standard shipping", amount: { amount: 500, currency: "USD" } }], selected_option_id: SHIPPING_ID };
    s.messages = [{ type: "info", code: "mock_mode", content: "Simulated Stripe payment and WooCommerce order. No money moves." },
      { type: "info", code: "timeline_url", content: `Watch checkout: ${appUrl}/checkouts/${s.id}` }];
    s.payment.handlers = [];
    if (!resolved.every(l => l.product.allowlisted && l.product.domain === "woo.demo.invalid")) {
      s.connector = "handoff";
      s.continue_url = `https://${first.domain}/cart`;
      s.messages.push({ type: "warning", code: "merchant_checkout_required", content: "Continue on the merchant website. This demo merchant URL is a placeholder." });
      transition(db, s, "handoff", "Merchant checkout required; no payment attempted", now(), { continue_url: s.continue_url });
      return;
    }
    if (resolved.some(l => l.product.stock < l.quantity)) s.messages.push(message("out_of_stock", "The requested quantity is unavailable."));
    if (!s.buyer) s.messages.push(message("missing_buyer", "Add buyer contact details."));
    if (!s.fulfillment.address) s.messages.push(message("missing_address", "Add a shipping address."));
    if (s.fulfillment.address && s.fulfillment.address.country !== "US") s.messages.push(message("unsupported_country", "The demo supports US shipping only."));
    if (s.messages.some(m => m.type === "error")) { s.expires_at = null; annotate(db, s, "Quote needs buyer input or available stock", now()); return; }
    s.expires_at = new Date(clock() + QUOTE_TTL_SECONDS * 1000).toISOString();
    transition(db, s, "awaiting_payment", "Quote ready: simulated payment requires confirmation", now(), { amount: { amount: subtotal + 500, currency: "USD" } });
    s.payment.handlers = [{ id: PAYMENT_HANDLER_IDS.stripe_spt, rail: "stripe_spt", config: { accepted: ["card"], test_mode: true, profile: "mock-vendors" } }];
  }
  function idempotency(db: Ledger, scope: string, key: string | undefined, payload: unknown, checkoutId?: string) {
    if (key === undefined) return undefined;
    if (!key.trim() || key.length > 255) throw new CheckoutError("validation_error", "Idempotency keys must be 1–255 characters.");
    const index = fingerprint({ scope, key });
    const hash = fingerprint(payload);
    const previous = db.idempotency[index];
    if (previous && previous.fingerprint !== hash) throw new CheckoutError("idempotency_conflict", "This idempotency key was already used with different input.", 409);
    if (previous) return previous.checkout_id;
    if (checkoutId) db.idempotency[index] = { fingerprint: hash, checkout_id: checkoutId };
    return undefined;
  }
  async function create(raw: CreateCheckoutInput, ctx: RequestContext, scenario: Scenario = "success") {
    const input = normalize(parse(CreateCheckoutInputSchema, raw));
    return repository.transaction(db => {
      const previous = idempotency(db, "create", ctx.idempotency_key, { input, scenario });
      if (previous) { const old = getEntry(db, previous); expire(db, old); return structuredClone(old.session); }
      const first = products(db, input)[0].product;
      const id = randomUUID();
      const s: CheckoutSession = { id, simulated: true, ucp_version: UCP_VERSION,
        store: { id: first.store_id, slug: first.allowlisted ? "woo-demo" : "partner-demo", domain: first.domain,
          name: first.allowlisted ? "Woo demo store" : "Partner demo store" },
        connector: first.allowlisted ? "woo_store_api" : "handoff", state: "quoting", status: "incomplete",
        line_items: [], totals: [], currency: "USD", payment: { handlers: [] },
        links: [{ type: "timeline", url: `${appUrl}/checkouts/${id}` }],
        expires_at: null, created_at: now(), updated_at: now() };
      const entry: CheckoutEntry = { session: s, input, scenario };
      db.checkouts[id] = entry;
      db.events.push({ id: db.events.length + 1, checkout_id: id, from_state: null, to_state: "quoting", message: "Checkout created", data: { simulated: true }, created_at: now() });
      quote(db, entry);
      idempotency(db, "create", ctx.idempotency_key, { input, scenario }, id);
      return structuredClone(s);
    });
  }
  const service: CheckoutService = {
    createCheckout: create,
    async getCheckout(id) {
      return repository.transaction(db => { const entry = getEntry(db, id); expire(db, entry); return structuredClone(entry.session); });
    },
    async updateCheckout(id, raw: UpdateCheckoutInput) {
      const input = parse(UpdateCheckoutInputSchema, raw);
      return repository.transaction(db => {
        const entry = getEntry(db, id); expire(db, entry);
        const s = entry.session;
        if (s.state === "expired") throw new CheckoutError("gone", "The quote expired.", 410);
        if (!["quoting", "awaiting_payment"].includes(s.state)) throw new CheckoutError("invalid_state", "This checkout cannot be updated.", 409);
        const next = normalize({ ...entry.input,
          ...(input.line_items !== undefined ? { line_items: input.line_items } : {}),
          ...(input.buyer !== undefined ? { buyer: input.buyer } : {}),
          ...(input.fulfillment !== undefined ? { fulfillment: input.fulfillment } : {}),
        });
        if (products(db, next)[0].product.store_id !== s.store.id) throw new CheckoutError("unprocessable", "A checkout cannot switch stores.", 422);
        if (input.selected_shipping_option_id && input.selected_shipping_option_id !== SHIPPING_ID) throw new CheckoutError("validation_error", "Unknown shipping option.");
        entry.input = next;
        quote(db, entry, input.selected_shipping_option_id);
        return structuredClone(s);
      });
    },
    async completeCheckout(id, raw, ctx) {
      const input = parse(CompleteCheckoutInputSchema, raw);
      const key = ctx.idempotency_key ?? input.idempotency_key;
      if (ctx.idempotency_key && input.idempotency_key && ctx.idempotency_key !== input.idempotency_key) throw new CheckoutError("validation_error", "Body and header idempotency keys must match.");
      return repository.transaction(db => {
        const entry = getEntry(db, id); expire(db, entry);
        const s = entry.session;
        const payload = { payment: input.payment };
        const previous = idempotency(db, `complete:${id}`, key, payload);
        if (previous || s.state === "completed") return structuredClone(s);
        if (s.state === "expired") throw new CheckoutError("gone", "The quote expired.", 410);
        if (s.state !== "awaiting_payment") throw new CheckoutError("invalid_state", "Checkout is not ready for payment.", 409);
        const token = input.payment.instruments[0].credential.token;
        if (!["mock_card_visa", "mock_card_declined", "mock_card_requires_action"].includes(token)) throw new CheckoutError("validation_error", "Only mock payment credentials are accepted.");
        // Bind attempts, including declines and re-quotes, to their idempotency key.
        idempotency(db, `complete:${id}`, key, payload, id);
        if (entry.scenario === "price_changed") {
          const variant = db.products[s.line_items[0].variant_id];
          entry.priceOverrides = { [variant.id]: variant.price + 100 };
          entry.scenario = "success";
        }
        const current = products(db, entry.input, entry);
        const unavailable = current.some(l => l.product.stock < l.quantity);
        const changed = current.some((l, i) => l.product.price !== s.line_items[i].unit_price.amount);
        if (unavailable || changed) {
          quote(db, entry);
          s.messages!.push(message(unavailable ? "out_of_stock" : "price_changed", unavailable ? "Stock changed; no payment was attempted." : "The price changed. Review the new total and confirm again."));
          return structuredClone(s);
        }
        const effectiveToken = entry.scenario === "declined" ? "mock_card_declined" : entry.scenario === "requires_action" ? "mock_card_requires_action" : token;
        const payment = stripe.authorize(db, s, effectiveToken);
        if (payment === "declined") {
          s.messages = [message("payment_declined", "Simulated payment declined. No order was placed.")];
          annotate(db, s, "Simulated payment declined", now(), { error_code: "payment_declined" });
          return structuredClone(s);
        }
        if (payment === "requires_action") {
          transition(db, s, "requires_action", "Simulated payment needs buyer action", now());
          s.messages = [message("payment_requires_action", "Buyer authentication is outside this demo. Cancel and start a new checkout.")];
          return structuredClone(s);
        }
        entry.payment_reference = payment.reference;
        transition(db, s, "payment_authorized", "Simulated Stripe payment authorized", now(), { rail: "stripe_spt", payment_intent_id: payment.reference, amount: { amount: payment.amount, currency: payment.currency } });
        transition(db, s, "placing_order", "Placing simulated WooCommerce order", now());
        const merchant = woo.placeOrder(db, s, payment, entry.scenario === "order_failed", entry.priceOverrides);
        if (!merchant) {
          transition(db, s, "refunding", "Order failed; releasing simulated authorization", now());
          stripe.voidOrRefund(db, payment);
          transition(db, s, "failed", "Simulated authorization released; no order placed", now(), { error_code: "order_failed_refunded" });
          s.messages = [message("order_failed_refunded", "Order placement failed. The simulated authorization was released.")];
          return structuredClone(s);
        }
        transition(db, s, "order_placed", "Simulated WooCommerce order placed", now(), { merchant_order_id: merchant.id });
        const order = { id: randomUUID(), simulated: true as const, checkout_id: id, store_id: s.store.id,
          status: "placed" as "placed" | "confirmed" | "failed", merchant_order_id: merchant.id, merchant_order_url: null,
          payment: { rail: "stripe_spt" as const, reference: payment.reference, amount: { amount: payment.amount, currency: payment.currency } }, created_at: now() };
        db.orders[order.id] = order; s.order = order;
        if (!stripe.capture(db, payment, entry.scenario === "capture_failed")) {
          woo.cancelOrder(db, s, merchant);
          stripe.voidOrRefund(db, payment);
          order.status = "failed";
          transition(db, s, "failed", "Capture failed; simulated order canceled and authorization released", now(), { error_code: "capture_failed" });
          s.messages = [message("capture_failed", "Simulated capture failed. The order was canceled and authorization released.")];
          return structuredClone(s);
        }
        order.status = "confirmed";
        transition(db, s, "completed", "Simulated payment captured and order confirmed", now(), { payment_intent_id: payment.reference, merchant_order_id: merchant.id, amount: order.payment.amount });
        s.messages = [{ type: "info", code: "mock_mode", content: "Demo purchase completed. Both payment and merchant order are simulated." }];
        return structuredClone(s);
      });
    },
    async cancelCheckout(id) {
      return repository.transaction(db => {
        const entry = getEntry(db, id); expire(db, entry);
        if (entry.session.state !== "canceled") transition(db, entry.session, "canceled", "Checkout canceled; no payment taken", now());
        return structuredClone(entry.session);
      });
    },
    async getOrder(id) {
      return repository.transaction(db => {
        if (!Object.hasOwn(db.orders, id)) throw new CheckoutError("not_found", "Order not found.", 404);
        return structuredClone(db.orders[id]);
      });
    },
    async listCheckoutEvents(id) {
      return repository.transaction(db => { getEntry(db, id); return structuredClone(db.events.filter(e => e.checkout_id === id)); });
    },
  };
  return Object.assign(service, {
    async createDemoCheckout(scenario: Scenario, ctx: RequestContext, selection?: { variant_id?: string; quantity?: number }) {
      return create({ line_items: [{ variant_id: scenario === "out_of_stock" ? SOLD_OUT_VARIANT_ID : scenario === "handoff" ? HANDOFF_VARIANT_ID : selection?.variant_id ?? DEMO_VARIANT_ID, quantity: selection?.quantity ?? 1 }], buyer: DEMO_BUYER, fulfillment: { address: DEMO_ADDRESS } }, ctx, scenario);
    },
    async catalog() { return repository.transaction(db => structuredClone(Object.values(db.products))); },
    async proof(id: string) {
      return repository.transaction(db => {
        const entry = getEntry(db, id);
        return { simulated: true, checkout_id: id, payment: entry.payment_reference ? structuredClone(db.payments[entry.payment_reference]) : null,
          merchant_order: structuredClone(Object.values(db.merchantOrders).find(o => o.checkout_id === id) ?? null),
          vendor_calls: structuredClone(db.vendorCalls.filter(c => c.checkout_id === id)) };
      });
    },
  });
}
