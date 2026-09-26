import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createCheckoutService } from "@/features/checkout/service";
import { FileCheckoutRepository } from "@/features/checkout/storage/file-repository";
import { CheckoutError } from "@/features/checkout/errors";
import { DEMO_ADDRESS, DEMO_BUYER, DEMO_VARIANT_ID, HANDOFF_VARIANT_ID, SOLD_OUT_VARIANT_ID } from "@/features/checkout/demo/fixtures";
import { PAYMENT_HANDLER_IDS, type CompleteCheckoutInput, type RequestContext } from "@/features/checkout/contracts";

const ctx = (key?: string): RequestContext => ({ surface: "rest", request_id: randomUUID(), idempotency_key: key });
const input = () => ({ line_items: [{ variant_id: DEMO_VARIANT_ID, quantity: 1 }], buyer: { ...DEMO_BUYER }, fulfillment: { address: { ...DEMO_ADDRESS } } });
const payment = (token = "mock_card_visa"): CompleteCheckoutInput => ({ payment: { instruments: [{ handler_id: PAYMENT_HANDLER_IDS.stripe_spt, type: "card", credential: { type: "spt", token } }] } });
async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "shopperzero-unit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.mock.method(globalThis, "fetch", () => { throw new Error("External network access is forbidden in the mock checkout"); });
  const repo = new FileCheckoutRepository(join(directory, "ledger.json"));
  let time = Date.parse("2026-09-26T12:00:00Z");
  const service = createCheckoutService(repo, { now: () => time });
  return { service, repo, advance: (ms: number) => { time += ms; }, snapshot: () => repo.transaction(db => structuredClone(db)) };
}
const rejectsCode = (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => error instanceof CheckoutError && error.code === code);

test("successful purchase persists one matching $49 payment, merchant order, receipt and timeline", async t => {
  const { service, snapshot, repo } = await setup(t);
  const checkout = await service.createCheckout(input(), ctx("create"));
  assert.equal(checkout.state, "awaiting_payment"); assert.equal(checkout.simulated, true);
  assert.equal(checkout.totals.at(-1)?.amount, 4900);
  const result = await service.completeCheckout(checkout.id, payment(), ctx("complete"));
  assert.equal(result.state, "completed"); assert.equal(result.status, "completed");
  assert.deepEqual(result.payment.handlers, []); assert.ok(result.order);
  assert.deepEqual(await service.getOrder(result.order.id), result.order);
  const proof = await service.proof(result.id);
  assert.equal(proof.payment?.status, "captured"); assert.equal(proof.payment?.amount, 4900);
  assert.equal(proof.merchant_order?.payment_reference, result.order.payment.reference);
  assert.match(result.order.payment.reference, /^pi_mock_/);
  assert.deepEqual(proof.vendor_calls.map(c => `${c.vendor}:${c.operation}`), ["stripe:authorize", "woo:place_order", "stripe:capture"]);
  assert.equal((await snapshot()).products[DEMO_VARIANT_ID].stock, 99);
  assert.deepEqual((await service.listCheckoutEvents(result.id)).map(e => e.to_state), ["quoting", "awaiting_payment", "payment_authorized", "placing_order", "order_placed", "completed"]);
  const reopened = createCheckoutService(new FileCheckoutRepository(repo.filename));
  assert.deepEqual(await reopened.getCheckout(result.id), result);
});

test("create is idempotent across property ordering and rejects changed payloads", async t => {
  const { service, snapshot } = await setup(t);
  const a = await service.createCheckout(input(), ctx("stable"));
  const b = await service.createCheckout({ fulfillment: input().fulfillment, buyer: input().buyer, line_items: input().line_items }, ctx("stable"));
  assert.equal(a.id, b.id);
  await rejectsCode(service.createCheckout({ ...input(), line_items: [{ variant_id: DEMO_VARIANT_ID, quantity: 2 }] }, ctx("stable")), "idempotency_conflict");
  assert.equal(Object.keys((await snapshot()).checkouts).length, 1);
});

test("concurrent completion across repository instances creates no duplicate payment or order", async t => {
  const { service, repo, snapshot } = await setup(t);
  const checkout = await service.createCheckout(input(), ctx());
  const other = createCheckoutService(new FileCheckoutRepository(repo.filename), { now: () => Date.parse("2026-09-26T12:00:00Z") });
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? other : service).completeCheckout(checkout.id, payment(), ctx(`attempt-${i}`))));
  assert.equal(new Set(results.map(s => s.order?.id)).size, 1);
  const db = await snapshot();
  assert.equal(Object.keys(db.orders).length, 1); assert.equal(Object.keys(db.payments).length, 1);
  assert.equal(Object.keys(db.merchantOrders).length, 1); assert.equal(db.vendorCalls.length, 3);
});

test("same completion key with different input conflicts even after success", async t => {
  const { service } = await setup(t);
  const s = await service.createCheckout(input(), ctx());
  await service.completeCheckout(s.id, payment(), ctx("same"));
  await rejectsCode(service.completeCheckout(s.id, payment("mock_card_declined"), ctx("same")), "idempotency_conflict");
});

test("missing buyer/address is recoverable through update, with frozen quote totals", async t => {
  const { service } = await setup(t);
  const s = await service.createCheckout({ line_items: input().line_items }, ctx());
  assert.equal(s.state, "quoting"); assert.deepEqual(s.payment.handlers, []);
  assert.ok(s.messages?.some(m => m.code === "missing_buyer"));
  await rejectsCode(service.completeCheckout(s.id, payment(), ctx()), "invalid_state");
  const updated = await service.updateCheckout(s.id, { buyer: DEMO_BUYER, fulfillment: { address: DEMO_ADDRESS } }, ctx());
  assert.equal(updated.state, "awaiting_payment"); assert.equal(updated.totals.at(-1)?.amount, 4900);
});

test("malformed quantities, empty carts, invalid buyer details and excessive duplicate units are rejected", async t => {
  const { service } = await setup(t);
  for (const quantity of [0, -1, 1.5, 21]) await rejectsCode(service.createCheckout({ ...input(), line_items: [{ variant_id: DEMO_VARIANT_ID, quantity }] }, ctx()), "validation_error");
  await rejectsCode(service.createCheckout({ ...input(), line_items: [] }, ctx()), "validation_error");
  await rejectsCode(service.createCheckout({ ...input(), buyer: { email: "invalid" } }, ctx()), "validation_error");
  await rejectsCode(service.createCheckout({ ...input(), line_items: [{ variant_id: DEMO_VARIANT_ID, quantity: 15 }, { variant_id: DEMO_VARIANT_ID, quantity: 10 }] }, ctx()), "validation_error");
});

test("duplicate variant lines are aggregated for stock checks and the order", async t => {
  const { service, repo } = await setup(t);
  await repo.transaction(db => { db.products[DEMO_VARIANT_ID].stock = 1; });
  const s = await service.createCheckout({ ...input(), line_items: [...input().line_items, ...input().line_items] }, ctx());
  assert.equal(s.line_items.length, 1); assert.equal(s.line_items[0].quantity, 2);
  assert.ok(s.messages?.some(m => m.code === "out_of_stock"));
});

test("out-of-stock fixture never offers payment or calls vendors", async t => {
  const { service, snapshot } = await setup(t);
  const s = await service.createCheckout({ ...input(), line_items: [{ variant_id: SOLD_OUT_VARIANT_ID, quantity: 1 }] }, ctx());
  assert.equal(s.state, "quoting"); assert.deepEqual(s.payment.handlers, []);
  await rejectsCode(service.completeCheckout(s.id, payment(), ctx()), "invalid_state");
  assert.equal((await snapshot()).vendorCalls.length, 0);
});

test("stock changes between quote and confirmation prevent authorization", async t => {
  const { service, repo, snapshot } = await setup(t);
  const s = await service.createCheckout(input(), ctx());
  await repo.transaction(db => { db.products[DEMO_VARIANT_ID].stock = 0; });
  const result = await service.completeCheckout(s.id, payment(), ctx("stock"));
  assert.equal(result.state, "quoting"); assert.ok(result.messages?.some(m => m.code === "out_of_stock"));
  assert.equal((await snapshot()).vendorCalls.length, 0);
});

test("price changes require review and a new confirmation key; retry cannot silently charge", async t => {
  const { service, repo, snapshot } = await setup(t);
  const s = await service.createCheckout(input(), ctx());
  await repo.transaction(db => { db.products[DEMO_VARIANT_ID].price = 5400; });
  const reviewed = await service.completeCheckout(s.id, payment(), ctx("original-total"));
  assert.equal(reviewed.totals.at(-1)?.amount, 5900); assert.ok(reviewed.messages?.some(m => m.code === "price_changed"));
  await service.completeCheckout(s.id, payment(), ctx("original-total"));
  assert.equal((await snapshot()).vendorCalls.length, 0);
  const done = await service.completeCheckout(s.id, payment(), ctx("approved-new-total"));
  assert.equal(done.order?.payment.amount.amount, 5900);
});

test("order failure voids the authorization without creating a receipt or decrementing stock", async t => {
  const { service, snapshot } = await setup(t);
  const s = await service.createDemoCheckout("order_failed", ctx());
  const failed = await service.completeCheckout(s.id, payment(), ctx("fail"));
  assert.equal(failed.state, "failed"); assert.equal(failed.order, undefined);
  const proof = await service.proof(s.id); assert.equal(proof.payment?.status, "voided"); assert.equal(proof.merchant_order, null);
  assert.equal((await snapshot()).products[DEMO_VARIANT_ID].stock, 100);
});

test("capture failure cancels the mock merchant order, restores stock and voids payment", async t => {
  const { service, snapshot } = await setup(t);
  const s = await service.createDemoCheckout("capture_failed", ctx());
  const failed = await service.completeCheckout(s.id, payment(), ctx("fail"));
  assert.equal(failed.state, "failed"); assert.equal(failed.order?.status, "failed");
  const proof = await service.proof(s.id);
  assert.equal(proof.payment?.status, "voided"); assert.equal(proof.merchant_order?.status, "canceled");
  assert.equal((await snapshot()).products[DEMO_VARIANT_ID].stock, 100);
  await service.completeCheckout(s.id, payment(), ctx("fail"));
  assert.equal((await service.proof(s.id)).vendor_calls.length, proof.vendor_calls.length);
});

test("decline is recoverable with a new mock credential and attempt key", async t => {
  const { service } = await setup(t);
  const s = await service.createCheckout(input(), ctx());
  const declined = await service.completeCheckout(s.id, payment("mock_card_declined"), ctx("decline"));
  assert.equal(declined.state, "awaiting_payment"); assert.equal((await service.proof(s.id)).payment, null);
  assert.equal((await service.completeCheckout(s.id, payment(), ctx("retry"))).state, "completed");
});

test("buyer action is explicit and expires without creating an order", async t => {
  const { service, advance, snapshot } = await setup(t);
  const s = await service.createCheckout(input(), ctx());
  assert.equal((await service.completeCheckout(s.id, payment("mock_card_requires_action"), ctx())).state, "requires_action");
  advance(601_000);
  assert.equal((await service.getCheckout(s.id)).state, "failed");
  assert.equal(Object.keys((await snapshot()).orders).length, 0);
});

test("expired quote is persisted and cannot be completed or updated", async t => {
  const { service, advance } = await setup(t);
  const s = await service.createCheckout(input(), ctx());
  advance(600_001);
  await rejectsCode(service.completeCheckout(s.id, payment(), ctx()), "gone");
  assert.equal((await service.getCheckout(s.id)).state, "expired");
  await rejectsCode(service.updateCheckout(s.id, {}, ctx()), "gone");
});

test("unsupported merchant hands off without offering or authorizing payment", async t => {
  const { service, snapshot } = await setup(t);
  const s = await service.createCheckout({ ...input(), line_items: [{ variant_id: HANDOFF_VARIANT_ID, quantity: 1 }] }, ctx());
  assert.equal(s.status, "requires_escalation"); assert.equal(s.continue_url, "https://merchant.example/cart");
  assert.deepEqual(s.payment.handlers, []);
  await rejectsCode(service.completeCheckout(s.id, payment(), ctx()), "invalid_state");
  assert.equal((await snapshot()).vendorCalls.length, 0);
  assert.equal((await service.cancelCheckout(s.id, ctx())).state, "canceled");
});

test("cancel is idempotent; terminal checkouts reject modification", async t => {
  const { service } = await setup(t);
  const s = await service.createCheckout(input(), ctx());
  await service.cancelCheckout(s.id, ctx()); await service.cancelCheckout(s.id, ctx());
  await rejectsCode(service.completeCheckout(s.id, payment(), ctx()), "invalid_state");
  await rejectsCode(service.updateCheckout(s.id, { buyer: DEMO_BUYER }, ctx()), "invalid_state");
  const done = await service.createCheckout(input(), ctx()); await service.completeCheckout(done.id, payment(), ctx());
  await rejectsCode(service.cancelCheckout(done.id, ctx()), "invalid_state");
});

test("public timeline and proof contain no buyer PII or payment credential", async t => {
  const { service } = await setup(t);
  const s = await service.createCheckout(input(), ctx()); await service.completeCheckout(s.id, payment(), ctx());
  const publicData = JSON.stringify([await service.listCheckoutEvents(s.id), await service.proof(s.id)]);
  for (const secret of [DEMO_BUYER.email, DEMO_ADDRESS.name, DEMO_ADDRESS.line1, DEMO_ADDRESS.postal_code, "mock_card_visa"]) assert.ok(!publicData.includes(secret), secret);
});

test("cross-store carts, unknown variants, shipping options and live credentials fail safely", async t => {
  const { service, snapshot } = await setup(t);
  await rejectsCode(service.createCheckout({ ...input(), line_items: [...input().line_items, { variant_id: HANDOFF_VARIANT_ID, quantity: 1 }] }, ctx()), "unprocessable");
  await rejectsCode(service.createCheckout({ ...input(), line_items: [{ variant_id: randomUUID(), quantity: 1 }] }, ctx()), "not_found");
  const s = await service.createCheckout(input(), ctx());
  await rejectsCode(service.updateCheckout(s.id, { selected_shipping_option_id: "express" }, ctx()), "validation_error");
  await rejectsCode(service.updateCheckout(s.id, { line_items: [{ variant_id: HANDOFF_VARIANT_ID, quantity: 1 }] }, ctx()), "unprocessable");
  await rejectsCode(service.completeCheckout(s.id, payment("pm_card_visa"), ctx()), "validation_error");
  assert.equal((await service.getCheckout(s.id)).state, "awaiting_payment");
  assert.equal((await snapshot()).vendorCalls.length, 0);
});

test("unsupported shipping country returns an incomplete quote", async t => {
  const { service } = await setup(t);
  const s = await service.createCheckout({ ...input(), fulfillment: { address: { ...DEMO_ADDRESS, country: "GB" } } }, ctx());
  assert.equal(s.state, "quoting"); assert.ok(s.messages?.some(m => m.code === "unsupported_country"));
});

test("unexpected repository failure rolls back and releases its lock", async t => {
  const { repo, snapshot } = await setup(t);
  await assert.rejects(repo.transaction(db => { db.products[DEMO_VARIANT_ID].stock = 0; throw new Error("interrupted"); }));
  assert.equal((await snapshot()).products[DEMO_VARIANT_ID].stock, 100);
});


test("price-change scenario is isolated from later demo purchases", async t => {
  const { service } = await setup(t);
  const scenario = await service.createDemoCheckout("price_changed", ctx());
  const changed = await service.completeCheckout(scenario.id, payment(), ctx("first"));
  assert.equal(changed.totals.at(-1)?.amount, 5000);
  const done = await service.completeCheckout(scenario.id, payment(), ctx("reviewed"));
  assert.equal(done.state, "completed");
  assert.equal(done.order?.payment.amount.amount, 5000);
  const ordinary = await service.createDemoCheckout("success", ctx());
  assert.equal(ordinary.totals.at(-1)?.amount, 4900);
});
