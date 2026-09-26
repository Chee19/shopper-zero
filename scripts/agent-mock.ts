import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DEMO_ADDRESS, DEMO_BUYER, DEMO_VARIANT_ID } from "../src/lib/checkout/fixtures";
import { PAYMENT_HANDLER_IDS, type CheckoutSession } from "../src/lib/checkout/contracts";

async function main() {
  const base = process.env.MOCK_CHECKOUT_APP_URL ?? "http://127.0.0.1:3000";
  const client = new Client({ name: "shopperzero-demo-agent", version: "1.0.0" });
  const transcript: { tool: string; result: unknown }[] = [];
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", base)));
    async function call(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) throw new Error(JSON.stringify(result.structuredContent ?? result.content));
      transcript.push({ tool: name, result: result.structuredContent });
      return result.structuredContent;
    }
    await call("search_catalog", { query: "hoodie" });
    await call("get_product", { id: DEMO_VARIANT_ID });
    const created = await call("create_checkout", { checkout: {
      line_items: [{ item: { id: `sz:variant:${DEMO_VARIANT_ID}` }, quantity: 1 }],
      buyer: DEMO_BUYER, fulfillment: { address: DEMO_ADDRESS },
    }, idempotency_key: randomUUID() }) as CheckoutSession;
    assert.equal(created.state, "awaiting_payment");
    // This script is explicitly authorized to confirm a simulated purchase only.
    assert.equal(created.simulated, true);
    const args = { id: created.id, checkout: { payment: { instruments: [{ handler_id: PAYMENT_HANDLER_IDS.stripe_spt,
      type: "card", credential: { type: "spt", token: "mock_card_visa" } }] }, idempotency_key: randomUUID() } };
    const done = await call("complete_checkout", args) as CheckoutSession;
    assert.equal(done.state, "completed"); assert.ok(done.order);
    const repeated = await call("complete_checkout", args) as CheckoutSession;
    assert.equal(repeated.order?.id, done.order.id);
    await call("get_order", { id: done.order.id });
    await call("get_checkout", { id: done.id });
    await mkdir("artifacts/mock-checkout", { recursive: true });
    await writeFile("artifacts/mock-checkout/agent-rehearsal.json", JSON.stringify({ simulated: true, at: new Date().toISOString(), transcript }, null, 2));
    console.log(JSON.stringify({ simulated: true, checkout: done.id, payment: done.order.payment.reference,
      merchant_order: done.order.merchant_order_id, amount: done.order.payment.amount,
      duplicate_prevented: true, timeline: `${base}/checkouts/${done.id}` }, null, 2));
  } finally { await client.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
