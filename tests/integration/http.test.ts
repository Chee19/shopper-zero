import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DEMO_ADDRESS, DEMO_BUYER, DEMO_VARIANT_ID } from "@/features/checkout/demo/fixtures";
import { PAYMENT_HANDLER_IDS, type CheckoutSession } from "@/features/checkout/contracts";

let directory: string, base: string, child: ChildProcess, output = "";
const createInput = { line_items: [{ variant_id: DEMO_VARIANT_ID, quantity: 1 }], buyer: DEMO_BUYER, fulfillment: { address: DEMO_ADDRESS } };
const completeInput = { payment: { instruments: [{ handler_id: PAYMENT_HANDLER_IDS.stripe_spt, type: "card", credential: { type: "spt", token: "mock_card_visa" } }] } };
async function freePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  return port;
}
async function start(enabled = true) {
  const port = await freePort(); base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    env: { ...process.env, CHECKOUT_DEMO_STORE: "fixtures", SHOPPERZERO_MOCK_ENABLED: enabled ? "1" : "0", MOCK_CHECKOUT_DATA_FILE: join(directory, "ledger.json"),
      MOCK_CHECKOUT_APP_URL: base, NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "", SUPABASE_SECRET_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", chunk => { output = (output + chunk).slice(-12000); });
  child.stderr?.on("data", chunk => { output = (output + chunk).slice(-12000); });
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
    try { if ((await fetch(`${base}/demo/checkout`)).status === 200) return; } catch { /* startup */ }
    if (Date.now() > deadline) throw new Error(`Server did not start: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  await new Promise<void>(resolve => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
}
before(async () => { directory = await mkdtemp(join(tmpdir(), "shopperzero-http-")); await start(); });
after(async () => { await stop(); if (directory) await rm(directory, { recursive: true, force: true }); });
async function api(path: string, method = "GET", data?: unknown, key?: string) {
  const response = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
}

test("production HTTP routes work with no Supabase/vendor credentials and survive a server restart", async () => {
  const key = randomUUID();
  const created = await api("/api/v1/checkouts", "POST", createInput, key);
  assert.equal(created.status, 201); assert.equal(created.body.state, "awaiting_payment"); assert.equal(created.cache, "no-store");
  assert.equal((await api("/api/v1/checkouts", "POST", createInput, key)).body.id, created.body.id);
  const completed = await api(`/api/v1/checkouts/${created.body.id}/complete`, "POST", completeInput, "complete-http");
  assert.equal(completed.status, 200); assert.equal(completed.body.state, "completed");
  const repeated = await api(`/api/v1/checkouts/${created.body.id}/complete`, "POST", completeInput, "complete-http");
  assert.deepEqual(repeated.body, completed.body);
  assert.deepEqual((await api(`/api/v1/orders/${completed.body.order.id}`)).body, completed.body.order);
  const events = await api(`/api/v1/checkouts/${created.body.id}/events`); assert.equal(events.body.events.length, 6);
  const proof = await api(`/api/mock/checkouts/${created.body.id}/proof`); assert.equal(proof.body.vendor_calls.length, 3);
  await stop(); await start();
  assert.deepEqual((await api(`/api/v1/checkouts/${created.body.id}`)).body, completed.body);
});

test("REST validates malformed requests, reports conflicts and supports update/cancel", async () => {
  const malformed = await fetch(`${base}/api/v1/checkouts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);
  assert.equal((await api("/api/v1/checkouts", "POST", { line_items: [] })).status, 400);
  assert.equal((await api(`/api/v1/checkouts/${randomUUID()}`)).status, 404);
  const key = randomUUID();
  const created = await api("/api/v1/checkouts", "POST", { line_items: createInput.line_items }, key);
  assert.equal(created.body.state, "quoting");
  assert.equal((await api("/api/v1/checkouts", "POST", createInput, key)).status, 409);
  const updated = await api(`/api/v1/checkouts/${created.body.id}`, "PUT", { buyer: DEMO_BUYER, fulfillment: { address: DEMO_ADDRESS } });
  assert.equal(updated.body.state, "awaiting_payment");
  assert.equal((await api(`/api/v1/checkouts/${created.body.id}/cancel`, "POST")).body.state, "canceled");
});

test("every HTTP demo scenario returns the expected state and compensates failures", async () => {
  const expected = { success: "completed", declined: "awaiting_payment", requires_action: "requires_action", out_of_stock: "quoting", price_changed: "awaiting_payment", order_failed: "failed", capture_failed: "failed", handoff: "handoff" };
  for (const [scenario, state] of Object.entries(expected)) {
    const created = await api("/api/mock/checkouts", "POST", { scenario }, randomUUID());
    assert.equal(created.status, 201);
    const done = created.body.state === "awaiting_payment" ? await api(`/api/v1/checkouts/${created.body.id}/complete`, "POST", completeInput, randomUUID()) : created;
    assert.equal(done.body.state, state, scenario);
    const proof = (await api(`/api/mock/checkouts/${created.body.id}/proof`)).body;
    if (["out_of_stock", "price_changed", "handoff"].includes(scenario)) assert.equal(proof.vendor_calls.length, 0);
    if (["order_failed", "capture_failed"].includes(scenario)) assert.equal(proof.payment.status, "voided");
  }
});

test("official MCP HTTP client performs the purchase and returns the same body as REST", async () => {
  const client = new Client({ name: "http-agent-test", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", base)));
    assert.equal((await client.listTools()).tools.length, 8);
    const result = await client.callTool({ name: "create_checkout", arguments: { checkout: createInput, idempotency_key: randomUUID() } });
    assert.ok(!result.isError);
    const created = result.structuredContent as unknown as CheckoutSession;
    const completed = await client.callTool({ name: "complete_checkout", arguments: { id: created.id, checkout: { ...completeInput, idempotency_key: randomUUID() } } });
    assert.ok(!completed.isError); assert.equal((completed.structuredContent as unknown as CheckoutSession).state, "completed");
    assert.deepEqual((await api(`/api/v1/checkouts/${created.id}`)).body, completed.structuredContent);
  } finally { await client.close(); }
});

test("disabled mock mode fails closed for REST/MCP and displays a clear message", async () => {
  await stop(); await start(false);
  assert.equal((await api("/api/v1/checkouts", "POST", createInput)).status, 503);
  assert.equal((await api("/api/mock/checkouts", "POST", { scenario: "success" })).status, 503);
  assert.equal((await api("/api/mcp", "POST", {})).status, 503);
  const page = await (await fetch(`${base}/demo/checkout`)).text();
  assert.ok(page.includes("Checkout unavailable"));
});
