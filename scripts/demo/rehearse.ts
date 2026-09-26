import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { chromium, type Browser } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DEMO_ADDRESS, DEMO_BUYER, type ProductFixture } from "@/features/checkout/demo/fixtures";
import { PAYMENT_HANDLER_IDS, type CheckoutSession, type Order } from "@/features/checkout/contracts";

const { values } = parseArgs({ options: {
  runs: { type: "string", default: "2" }, quick: { type: "boolean", default: false },
  headed: { type: "boolean", default: false }, output: { type: "string" },
} });
const runs = Number(values.runs);
assert.ok(Number.isInteger(runs) && runs >= 1 && runs <= 5, "Use --runs=1 through --runs=5.");
function localOrigin(value: string) {
  const url = new URL(value);
  assert.ok(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash,
  "The rehearsal accepts local HTTP origins only.");
  return url.origin;
}
const app = localOrigin(process.env.MOCK_CHECKOUT_APP_URL ?? "http://127.0.0.1:4174");
const beforeStore = localOrigin(process.env.PROVENCE_BEFORE_URL ?? "http://127.0.0.1:4001");
const afterStore = localOrigin(process.env.PROVENCE_STORE_URL ?? "http://127.0.0.1:4002");
const out = resolve(values.output ?? join("artifacts/mock-checkout/judge-rehearsals", new Date().toISOString().replace(/[:.]/g, "-")));
const allowedOrigins = new Set([app, beforeStore, afterStore].flatMap(origin => {
  const url = new URL(origin);
  return [origin, `http://localhost:${url.port}`, `http://127.0.0.1:${url.port}`];
}));
async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "error" });
  assert.equal(response.status, 200, `${url} returned ${response.status}`);
  return response.json() as Promise<T>;
}
type MerchantOrder = { id: string; checkout_id: string; payment_reference: string; total: number; status: string;
  cart: { lines: { sku: string; qty: number }[] } };
type Proof = { payment: { reference: string; status: string; amount: number }; vendor_calls: { operation: string }[] };

async function rehearse(browser: Browser, run: number) {
  const directory = join(out, `run-${run}`);
  await mkdir(directory, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
    userAgent: "ShopperZero/1.0 judge-rehearsal", recordVideo: { dir: directory, size: { width: 1440, height: 1000 } } });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const video = page.video()!;
  const client = new Client({ name: "shopperzero-stage-rehearsal", version: "1.0.0" });
  const transcript: { tool: string; result: unknown }[] = [];
  const stages: { name: string; planned_seconds: number; actual_seconds: number }[] = [];
  const errors: string[] = [], external: string[] = [];
  let expectingBlock = false;
  let created: CheckoutSession | undefined;
  const started = performance.now();
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && !allowedOrigins.has(url.origin)) {
      external.push(url.href); return route.abort();
    }
    return route.continue();
  });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && !expectingBlock) errors.push(message.text());
  });
  page.on("response", response => {
    if (response.status() >= 400 && !(response.status() === 403 && response.url() === `${beforeStore}/en-us/checkout`)) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  async function at(seconds: number, name: string) {
    if (!values.quick) {
      const remaining = seconds * 1000 - (performance.now() - started);
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    }
    const elapsed = Math.round(performance.now() - started) / 1000;
    stages.push({ name, planned_seconds: seconds, actual_seconds: elapsed });
    console.log(`[Run ${run} · ${elapsed.toFixed(1)}s] ${name}`);
  }
  const screenshot = (name: string) => page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
  async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result.structuredContent ?? result.content));
    transcript.push({ tool: name, result: result.structuredContent });
    return result.structuredContent as T;
  }
  async function dismissConsent() {
    const button = page.getByRole("button", { name: "No thanks", exact: true });
    if (await button.count()) await button.click();
  }
  try {
    await at(0, "Lumière before: a prepared store with a simulated payment flow");
    await page.goto(`${beforeStore}/en-us/`);
    await page.getByRole("button", { name: "Necessary only", exact: true }).click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("link", { name: "Shop hand cream", exact: true }).click();
    await page.locator("[data-add-to-bag]:not([disabled])").waitFor();
    const productPath = new URL(page.url()).pathname;

    await at(12, "Select 75 ml: the before-store adds 150 ml");
    await page.getByRole("button", { name: "75 ml", exact: true }).click();
    assert.equal(await page.locator("[data-pdp-price]").innerText(), "$24.00");
    await screenshot("01-before-selected-75ml");
    const wrongCartResponse = page.waitForResponse(r => r.url().includes("/Cart-AddProduct"));
    await page.getByRole("button", { name: "Add to bag", exact: true }).click();
    const wrongCart = await (await wrongCartResponse).json();
    assert.equal(wrongCart.addedSku, "01HC150");
    await page.getByRole("link", { name: /^Bag/ }).click();
    await page.getByText("150 ml", { exact: true }).waitFor();
    await screenshot("02-before-wrong-cart");

    await at(27, "Declared shopping agent is blocked at checkout");
    expectingBlock = true;
    const blocked = page.waitForResponse(r => r.url() === `${beforeStore}/en-us/checkout` && r.request().isNavigationRequest());
    await page.getByRole("link", { name: "Checkout", exact: true }).click();
    assert.equal((await blocked).status(), 403);
    await page.getByRole("heading", { name: "Access denied", exact: true }).waitFor();
    assert.equal((await fetch(`${beforeStore}/products.json`)).status, 404);
    await screenshot("03-before-agent-blocked");

    await at(38, "Lumière after: the same 75 ml selection adds the correct SKU");
    await context.clearCookies();
    await page.goto(afterStore + productPath);
    expectingBlock = false;
    await dismissConsent();
    await page.locator("label.swatch").filter({ hasText: "75 ml" }).click();
    assert.equal(await page.getByRole("radio", { name: /75 ml/ }).isChecked(), true);
    const correctCartResponse = page.waitForResponse(r => r.url().includes("/Cart-AddProduct"));
    await page.getByRole("button", { name: "Add to bag", exact: true }).click();
    assert.equal((await (await correctCartResponse).json()).addedSku, "01HC075");
    await page.getByRole("link", { name: /^Bag/ }).click();
    await page.getByText("75 ml", { exact: true }).waitFor();
    await screenshot("04-after-correct-cart");
    await page.getByRole("link", { name: "Checkout", exact: true }).click();
    await page.getByRole("heading", { name: "Checkout", exact: true }).waitFor();

    await at(52, "Public product feed, structured data and shopping instructions");
    const feed = await json<{ products: { variants: { sku: string; price: string }[] }[] }>(`${afterStore}/products.json`);
    assert.equal(feed.products.flatMap(p => p.variants).find(v => v.sku === "01HC075")?.price, "24.00");
    await json(`${afterStore}/.well-known/ucp`);
    await page.goto(`${afterStore}/llms.txt`);
    assert.ok((await page.locator("body").innerText()).includes("Lumière"));
    await screenshot("05-agent-instructions");

    await at(64, "MCP discovery and quote: 75 ml, one item, $32.93 total");
    await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", app)));
    const tools = await client.listTools();
    assert.equal(tools.tools.find(tool => tool.name === "complete_checkout")?.annotations?.destructiveHint, true);
    const found = await call<{ products: ProductFixture[] }>("search_catalog", { query: "Shea Butter Hand Cream" });
    const variant = found.products.find(product => product.external_id === "01HC075");
    assert.ok(variant && variant.stock > 0, "The 75 ml item must have stock.");
    await call("get_product", { id: variant.id });
    created = await call<CheckoutSession>("create_checkout", { checkout: {
      line_items: [{ item: { id: `sz:variant:${variant.id}` }, quantity: 1 }],
      buyer: DEMO_BUYER, fulfillment: { address: DEMO_ADDRESS },
    }, idempotency_key: randomUUID() });
    assert.equal(created.simulated, true);
    assert.equal(created.state, "awaiting_payment");
    assert.deepEqual(created.totals.map(total => total.amount), [2400, 695, 198, 3293]);
    const timeline = `${app}/checkouts/${created.id}`;
    console.log(`Watch checkout: ${timeline}`);
    await page.goto(timeline);
    await page.getByRole("list", { name: "Checkout events", exact: true }).waitFor();
    assert.equal(await page.getByText(/Agent checkout complete/).count(), 0);
    await screenshot("06-approved-quote");

    await at(84, "Confirm simulated payment; the open timeline updates automatically");
    const args = { id: created.id, checkout: { payment: { instruments: [{ handler_id: PAYMENT_HANDLER_IDS.stripe_spt,
      type: "card", credential: { type: "spt", token: "mock_card_visa" } }] }, idempotency_key: randomUUID() } };
    const done = await call<CheckoutSession>("complete_checkout", args);
    assert.equal(done.state, "completed"); assert.ok(done.order);
    await page.getByText(/Agent checkout complete/).waitFor({ timeout: 6000 });
    await page.getByText(`Merchant order #${done.order.merchant_order_id}`, { exact: true }).waitFor();
    await screenshot("07-purchase-complete");

    await at(100, "Merchant receipt: matching LDP order, size, quantity and total");
    const receiptLink = page.getByRole("link", { name: "Open Lumière order", exact: true });
    assert.equal(await receiptLink.getAttribute("href"), done.order.merchant_order_url);
    await page.goto(done.order.merchant_order_url!);
    await dismissConsent();
    const receiptText = await page.locator("body").innerText();
    assert.ok(receiptText.includes(done.order.merchant_order_id!));
    assert.ok(receiptText.includes("75 ml") && receiptText.includes("$32.93"));
    await screenshot("08-merchant-receipt");

    await at(111, "Repeat confirmation: still one order, one authorization and one capture");
    const repeated = await call<CheckoutSession>("complete_checkout", args);
    assert.deepEqual(repeated, done);
    assert.deepEqual(await call<CheckoutSession>("get_checkout", { id: done.id }), done);
    assert.deepEqual(await json<CheckoutSession>(`${app}/api/v1/checkouts/${done.id}`), done);
    const order = await call<Order>("get_order", { id: done.order.id });
    assert.equal(order.merchant_order_id, done.order.merchant_order_id);
    const { orders } = await json<{ orders: MerchantOrder[] }>(`${afterStore}/__demo/orders?checkout_id=${done.id}`);
    assert.equal(orders.length, 1);
    const merchant = orders[0];
    assert.equal(merchant.id, order.merchant_order_id);
    assert.equal(merchant.checkout_id, done.id);
    assert.equal(merchant.payment_reference, order.payment.reference);
    assert.equal(merchant.status, "placed");
    assert.equal(Math.round(merchant.total * 100), 3293);
    assert.equal(merchant.cart.lines[0].sku, "01HC075"); assert.equal(merchant.cart.lines[0].qty, 1);
    const proof = await json<Proof>(`${app}/api/mock/checkouts/${done.id}/proof`);
    assert.equal(proof.payment.status, "captured"); assert.equal(proof.payment.amount, 3293);
    assert.equal(proof.payment.reference, merchant.payment_reference);
    for (const operation of ["authorize", "capture"]) assert.equal(proof.vendor_calls.filter(call => call.operation === operation).length, 1);
    await page.goto(timeline);
    await page.getByText(/Agent checkout complete/).waitFor();
    await screenshot("09-retry-same-order");
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    await writeFile(join(directory, "evidence.json"), JSON.stringify({ transcript, merchant, proof }, null, 2));
    await at(120, "Rehearsal complete");
    return { run, status: "passed", duration_seconds: Math.round(performance.now() - started) / 1000,
      checkout: done.id, merchant_order: merchant.id, payment: merchant.payment_reference, total_cents: 3293,
      timeline_url: timeline, merchant_receipt_url: done.order.merchant_order_url, duplicate_prevented: true,
      browser_errors: errors, external_requests: external, stages };
  } catch (error) {
    await screenshot("failure").catch(() => {});
    await writeFile(join(directory, "failure.json"), JSON.stringify({ message: String(error), checkout: created?.id,
      stages, transcript, browser_errors: errors, external_requests: external }, null, 2));
    throw error;
  } finally {
    await client.close().catch(() => {});
    await context.close();
    await video.saveAs(join(directory, "rehearsal.webm"));
  }
}

async function main() {
  await mkdir(out, { recursive: true });
  for (const url of [`${app}/demo/checkout`, `${beforeStore}/en-us/`, `${afterStore}/products.json`]) {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200, `Start npm run demo:provence first: ${url} returned ${response.status}`);
  }
  const browser = await chromium.launch({ headless: !values.headed,
    ...(existsSync(chromium.executablePath()) ? {} : { channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL ?? "chrome" }) });
  const results: Awaited<ReturnType<typeof rehearse>>[] = [];
  try {
    for (let run = 1; run <= runs; run++) {
      results.push(await rehearse(browser, run));
      await writeFile(join(out, "results.json"), JSON.stringify({ at: new Date().toISOString(), simulated: true,
        timed: !values.quick, intended_duration_seconds: values.quick ? null : 120, results }, null, 2));
    }
    console.log(`Passed ${results.length} complete rehearsals. Evidence: ${out}`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
