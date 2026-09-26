import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createProvenceService } from "@/features/checkout/provence-service";
import { ProvenceConnector, provenceId } from "@/features/checkout/connectors/provence";
import { FileCheckoutRepository } from "@/features/checkout/storage/file-repository";
import { CheckoutError } from "@/features/checkout/errors";
import { DEMO_BUYER, DEMO_ADDRESS } from "@/features/checkout/demo/fixtures";
import { PAYMENT_HANDLER_IDS, type CheckoutSession, type RequestContext } from "@/features/checkout/contracts";

let directory: string, origin: string, app: string, beforeOrigin: string, store: ChildProcess, web: ChildProcess;
const children = new Set<ChildProcess>();
async function freePort() {
  const s = createServer(); await new Promise<void>(r => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as { port: number }).port; await new Promise<void>(r => s.close(() => r())); return port;
}
async function launch(args: string[], env: Partial<NodeJS.ProcessEnv>, url: string) {
  const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child); let output = "";
  child.stdout?.on("data", b => { output = (output + b).slice(-4000); }); child.stderr?.on("data", b => { output = (output + b).slice(-4000); });
  const deadline = Date.now() + 20000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(output);
    try { if ((await fetch(url)).ok) return child; } catch { /* startup */ }
    if (Date.now() > deadline) throw new Error(output || "Startup timed out");
    await new Promise(r => setTimeout(r, 50));
  }
}
async function stop(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) await new Promise<void>(r => { child.once("exit", () => r()); child.kill("SIGTERM"); });
  children.delete(child);
}
async function startStore() {
  store = await launch(["demos/provence/server.mjs"], { STORE_MODE: "after", PORT: new URL(origin).port, PROVENCE_DATA_FILE: join(directory, "store.json") }, `${origin}/products.json`);
}
async function startApp() {
  web = await launch(["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", new URL(app).port], {
    SHOPPERZERO_MOCK_ENABLED: "1", CHECKOUT_DEMO_STORE: "provence", PROVENCE_STORE_URL: origin, MOCK_CHECKOUT_APP_URL: app,
    MOCK_CHECKOUT_DATA_FILE: join(directory, "http.json"), NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "", SUPABASE_SECRET_KEY: "",
  }, `${app}/demo/checkout`);
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "shopperzero-provence-"));
  origin = `http://127.0.0.1:${await freePort()}`; app = `http://127.0.0.1:${await freePort()}`; beforeOrigin = `http://127.0.0.1:${await freePort()}`;
  await startStore(); await startApp();
  await launch(["demos/provence/server.mjs"], { STORE_MODE: "before", PORT: new URL(beforeOrigin).port }, `${beforeOrigin}/en-us/`);
});
after(async () => { await Promise.all([...children].map(stop)); if (directory) await rm(directory, { recursive: true, force: true }); });
const ctx = (key = randomUUID()): RequestContext => ({ surface: "rest", request_id: randomUUID(), idempotency_key: key });
const payment = { payment: { instruments: [{ handler_id: PAYMENT_HANDLER_IDS.stripe_spt, type: "card" as const, credential: { type: "spt" as const, token: "mock_card_visa" } }] } };
const input = (sku = "01HC075", quantity = 1) => ({ line_items: [{ variant_id: provenceId("variant", sku), quantity }], buyer: DEMO_BUYER, fulfillment: { address: DEMO_ADDRESS } });
function setup(connector = new ProvenceConnector(origin), clock?: () => number) {
  const repo = new FileCheckoutRepository(join(directory, `${randomUUID()}.json`));
  const service = createProvenceService(repo, { origin, appUrl: app, connector, now: clock });
  return { repo, service };
}
async function api(path: string, method = "GET", body?: unknown, key?: string) {
  const response = await fetch(app + path, { method, headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
async function orders(id: string) { return (await (await fetch(`${origin}/__demo/orders?checkout_id=${id}`)).json()).orders; }

test("Lumière REST purchase selects the exact 75 ml SKU, reconciles payment/receipt and survives both restarts", async () => {
  const key = randomUUID(); const created = await api("/api/v1/checkouts", "POST", input(), key);
  assert.equal(created.status, 201); assert.equal(created.data.connector, "provence_demo");
  assert.deepEqual(created.data.totals.map((t: { amount: number }) => t.amount), [2400, 695, 198, 3293]);
  assert.equal(created.data.line_items[0].variant_title, "75 ml"); assert.ok(created.data.line_items[0].image_url.includes(".svg"));
  assert.equal((await api("/api/v1/checkouts", "POST", input(), key)).data.id, created.data.id);
  const attempt = randomUUID(); const done = (await api(`/api/v1/checkouts/${created.data.id}/complete`, "POST", payment, attempt)).data;
  assert.equal(done.state, "completed"); assert.match(done.order.merchant_order_id, /^LDP/); assert.equal(done.order.payment.amount.amount, 3293);
  assert.equal((await orders(done.id))[0].cart.lines[0].sku, "01HC075");
  assert.equal((await orders(done.id))[0].payment_reference, done.order.payment.reference);
  assert.equal((await api(`/api/v1/checkouts/${done.id}/complete`, "POST", payment, attempt)).data.order.id, done.order.id);
  const receipt = await (await fetch(done.order.merchant_order_url)).text(); assert.ok(receipt.includes(done.order.merchant_order_id)); assert.ok(receipt.includes("$32.93"));
  await stop(web); await stop(store); await startStore(); await startApp();
  assert.deepEqual((await api(`/api/v1/checkouts/${done.id}`)).data, done);
  assert.equal((await orders(done.id)).length, 1);
  assert.equal((await api(`/api/v1/checkouts/${done.id}/complete`, "POST", payment, attempt)).data.order.id, done.order.id);
});

test("MCP discovers Lumière sizes and uses the same checkout service as REST", async () => {
  const client = new Client({ name: "provence-test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${app}/api/mock/mcp`)));
  try {
    const found = await client.callTool({ name: "search_catalog", arguments: { query: "Shea Butter Hand Cream" } });
    const products = (found.structuredContent as { products: { id: string; external_id: string }[] }).products;
    assert.deepEqual(products.map(p => p.external_id), ["01HC030", "01HC075", "01HC150"]);
    const result = await client.callTool({ name: "create_checkout", arguments: { checkout: input(), idempotency_key: randomUUID() } });
    assert.equal(result.isError, undefined); const session = result.structuredContent as unknown as CheckoutSession;
    const done = await client.callTool({ name: "complete_checkout", arguments: { id: session.id, checkout: { ...payment, idempotency_key: randomUUID() } } });
    assert.equal(done.isError, undefined); assert.equal((done.structuredContent as unknown as CheckoutSession).state, "completed");
    assert.deepEqual((await api(`/api/v1/checkouts/${session.id}`)).data, done.structuredContent);
  } finally { await client.close(); }
});

test("shipping choices, free-shipping threshold, validation, expiry and real sold-out variant", async () => {
  let clock = Date.now(); const { service } = setup(undefined, () => clock);
  const s = await service.createCheckout(input(), ctx());
  assert.equal((await service.updateCheckout(s.id, { selected_shipping_option_id: "express" }, ctx())).totals.at(-1)?.amount, 4093);
  const free = await service.updateCheckout(s.id, { line_items: input("01HC075", 3).line_items, selected_shipping_option_id: "standard" }, ctx());
  assert.deepEqual(free.totals.map(t => t.amount), [7200, 0, 594, 7794]);
  await assert.rejects(service.updateCheckout(s.id, { selected_shipping_option_id: "overnight" }, ctx()), /Unknown shipping/);
  await assert.rejects(service.createCheckout(input("01HC075", 11), ctx()), /10 units/);
  const missing = await service.createCheckout({ line_items: input().line_items }, ctx()); assert.equal(missing.state, "quoting");
  assert.equal((await service.updateCheckout(missing.id, { buyer: DEMO_BUYER, fulfillment: { address: DEMO_ADDRESS } }, ctx())).state, "awaiting_payment");
  const unavailable = await service.createCheckout(input("04FM150"), ctx()); assert.equal(unavailable.state, "quoting"); assert.equal(unavailable.payment.handlers.length, 0);
  const unsupported = await service.createCheckout({ ...input(), fulfillment: { address: { ...DEMO_ADDRESS, country: "GB" } } }, ctx()); assert.equal(unsupported.state, "quoting");
  clock += 601000; assert.equal((await service.getCheckout(s.id)).state, "expired");
  await assert.rejects(service.completeCheckout(s.id, payment, ctx()), /expired/);
});

test("price changes require a new confirmation and do not alter the catalog", async () => {
  const { service } = setup(); const s = await service.createDemoCheckout("price_changed", ctx()); const attempt = ctx();
  const changed = await service.completeCheckout(s.id, payment, attempt); assert.equal(changed.state, "awaiting_payment"); assert.equal(changed.totals.at(-1)?.amount, 3401);
  assert.equal((await service.proof(s.id)).payment, null); assert.equal((await service.completeCheckout(s.id, payment, attempt)).state, "awaiting_payment");
  const done = await service.completeCheckout(s.id, payment, ctx()); assert.equal(done.state, "completed"); assert.equal((await orders(s.id))[0].total, 34.01);
  const ordinary = await service.createDemoCheckout("success", ctx()); assert.equal(ordinary.totals.at(-1)?.amount, 3293);
});

test("declines, buyer action, order failure and merchant handoff do not create orders", async () => {
  const { service } = setup();
  for (const scenario of ["declined", "requires_action", "order_failed", "handoff"] as const) {
    const s = await service.createDemoCheckout(scenario, ctx()); const done = s.state === "awaiting_payment" ? await service.completeCheckout(s.id, payment, ctx()) : s;
    assert.equal(done.state, { declined: "awaiting_payment", requires_action: "requires_action", order_failed: "failed", handoff: "handoff" }[scenario]);
    assert.equal((await orders(s.id)).length, 0);
    if (scenario === "order_failed") assert.equal((await service.proof(s.id)).payment?.status, "voided");
  }
});

test("capture failure cancels the native order and restores merchant stock", async () => {
  const { service } = setup(); const before = (await service.catalog()).find(p => p.external_id === "01HC075")!.stock;
  const s = await service.createDemoCheckout("capture_failed", ctx()); assert.equal((await service.completeCheckout(s.id, payment, ctx())).state, "failed");
  assert.equal((await orders(s.id))[0].status, "canceled"); assert.equal((await service.proof(s.id)).payment?.status, "voided");
  assert.equal((await service.catalog()).find(p => p.external_id === "01HC075")!.stock, before);
});

test("parallel retries across service instances produce exactly one native order and authorization", async () => {
  const { service, repo } = setup(); const s = await service.createCheckout(input(), ctx()); const attempt = ctx();
  const second = createProvenceService(new FileCheckoutRepository(repo.filename), { origin });
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => (i % 2 ? second : service).completeCheckout(s.id, payment, attempt)));
  assert.ok(results.every(r => r.order?.id === results[0].order?.id)); assert.equal((await orders(s.id)).length, 1);
  const proof = await service.proof(s.id); assert.equal(proof.vendor_calls.filter(c => c.operation === "authorize").length, 1);
  const conflict = structuredClone(payment); conflict.payment.instruments[0].credential.token = "mock_card_declined";
  await assert.rejects(service.completeCheckout(s.id, conflict, attempt), /different input/);
});

test("a lost order response is reconciled after restart without a second purchase", async () => {
  class LostReply extends ProvenceConnector {
    override async placeOrder(...args: Parameters<ProvenceConnector["placeOrder"]>): Promise<never> { await super.placeOrder(...args); throw new CheckoutError("upstream_timeout", "Response lost.", 504); }
  }
  const { service, repo } = setup(new LostReply(origin)); const s = await service.createCheckout(input(), ctx()); const attempt = ctx();
  await assert.rejects(service.completeCheckout(s.id, payment, attempt), /Response lost/);
  assert.equal((await service.getCheckout(s.id)).state, "placing_order"); assert.equal((await orders(s.id)).length, 1);
  await stop(store); await startStore();
  const resumed = createProvenceService(new FileCheckoutRepository(repo.filename), { origin }); const done = await resumed.completeCheckout(s.id, payment, attempt);
  assert.equal(done.state, "completed"); assert.equal((await orders(s.id)).length, 1); assert.equal((await resumed.proof(s.id)).vendor_calls.filter(c => c.operation === "authorize").length, 1);
});

test("a lost cancellation response resumes compensation without capturing payment", async () => {
  class LostCancel extends ProvenceConnector {
    override async cancelOrder(...args: Parameters<ProvenceConnector["cancelOrder"]>): Promise<never> { await super.cancelOrder(...args); throw new CheckoutError("upstream_timeout", "Cancellation response lost.", 504); }
  }
  const { service, repo } = setup(new LostCancel(origin)); const s = await service.createDemoCheckout("capture_failed", ctx()); const attempt = ctx();
  await assert.rejects(service.completeCheckout(s.id, payment, attempt), /Cancellation response lost/);
  assert.equal((await orders(s.id))[0].status, "canceled");
  const resumed = createProvenceService(repo, { origin }); assert.equal((await resumed.completeCheckout(s.id, payment, attempt)).state, "failed");
  assert.equal((await resumed.proof(s.id)).payment?.status, "voided");
});

test("competing carts cannot oversell inventory", async () => {
  const { service } = setup(); const a = await service.createCheckout(input("03RS050", 10), ctx()), b = await service.createCheckout(input("03RS050", 10), ctx());
  const results = await Promise.all([service.completeCheckout(a.id, payment, ctx()), service.completeCheckout(b.id, payment, ctx())]);
  assert.equal(results.filter(r => r.state === "completed").length, 1);
  assert.equal((await service.catalog()).find(p => p.external_id === "03RS050")!.stock, 2);
});

test("unreachable stores fail closed and the before storefront still blocks declared agents", async () => {
  const dead = `http://127.0.0.1:${await freePort()}`; const { repo } = setup(); const service = createProvenceService(repo, { origin: dead });
  await assert.rejects(service.createCheckout(input(), ctx()), /unavailable/); assert.equal(await repo.transaction(db => Object.keys(db.checkouts).length), 0);
  assert.throws(() => new ProvenceConnector("https://example.com"), /local storefront/);
  assert.equal((await fetch(`${beforeOrigin}/en-us/checkout`, { headers: { "user-agent": "ShopperZero/1" } })).status, 403);
  assert.equal((await fetch(`${beforeOrigin}/products.json`)).status, 404);
  assert.equal((await fetch(`${origin}/en-us/checkout`, { headers: { "user-agent": "ShopperZero/1", accept: "application/json" } })).status, 200);
});
