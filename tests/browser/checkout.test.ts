import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const base = process.env.MOCK_CHECKOUT_APP_URL ?? "http://127.0.0.1:4174";
const artifacts = "artifacts/mock-checkout/browser";
let browser: Browser;
before(async () => {
  await mkdir(artifacts, { recursive: true });
  browser = await chromium.launch({ headless: true,
    ...(existsSync(chromium.executablePath()) ? {} : { channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL ?? "chrome" }) });
});
after(async () => { await browser?.close(); });

async function monitor(context: BrowserContext, page: Page) {
  const errors: string[] = [], external: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await context.route("**/*", route => {
    if (![new URL(base).origin, process.env.PROVENCE_STORE_URL ?? "http://127.0.0.1:4002"].includes(new URL(route.request().url()).origin)) {
      external.push(route.request().url()); return route.abort();
    }
    return route.continue();
  });
  return () => { assert.deepEqual(errors, []); assert.deepEqual(external, []); };
}
async function start(page: Page, scenario: string) {
  await page.getByLabel("Scenario").selectOption(scenario);
  const response = page.waitForResponse(r => r.url().endsWith("/api/mock/checkouts") && r.request().method() === "POST");
  await page.getByRole("button", { name: /Create checkout|New checkout/ }).click();
  const data = await (await response).json();
  await page.getByRole("region", { name: "Order details" }).getByText(data.id, { exact: true }).waitFor();
  return data;
}
async function complete(page: Page) {
  const response = page.waitForResponse(r => r.url().endsWith("/complete") && r.request().method() === "POST");
  await page.getByRole("button", { name: /Confirm purchase/ }).click();
  return (await response).json();
}

test("browser: purchase, repeat completion and reopen saved receipt; records a backup", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, recordVideo: { dir: artifacts, size: { width: 1440, height: 1100 } } });
  const page = await context.newPage();
  const verify = await monitor(context, page);
  const video = page.video()!;
  try {
    await page.goto(`${base}/demo/checkout`);
    await page.getByRole("button", { name: "Create checkout" }).waitFor();
    // Short pauses make the backup recording legible; assertions use UI/network conditions.
    await page.waitForTimeout(900);
    const created = await start(page, "success");
    assert.equal(created.state, "awaiting_payment");
    await page.waitForTimeout(1100);
    const done = await complete(page);
    await page.getByRole("heading", { name: "Purchase complete", exact: true }).waitFor();
    assert.equal(done.state, "completed");
    await page.getByRole("region", { name: "Order details" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${artifacts}/purchase-complete.png`, fullPage: true });
    await page.waitForTimeout(1500);
    const before = await page.getByRole("region", { name: "Order details" }).innerText();
    const retry = page.waitForResponse(r => r.url().endsWith("/complete"));
    await page.getByRole("button", { name: "Retry checkout" }).click();
    const repeated = await (await retry).json();
    assert.equal(repeated.order.id, done.order.id);
    assert.equal(await page.getByRole("region", { name: "Order details" }).innerText(), before);
    await page.getByRole("link", { name: "View checkout →" }).click();
    await page.waitForURL(`**/checkouts/${done.id}`);
    await page.getByRole("heading", { name: "Purchase complete", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("heading", { name: "Purchase complete", exact: true }).waitFor();
    assert.ok((await page.getByRole("region", { name: "Order details" }).innerText()).includes(done.order.payment.reference));
    await page.waitForTimeout(1500);
    assert.equal(await page.locator("[data-nextjs-dialog]").count(), 0);
    verify();
  } finally {
    await context.close();
    await video.saveAs(`${artifacts}/mock-checkout-demo.webm`);
  }
});

test("browser: all failure scenarios display their actual outcome and price changes can be reviewed", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await context.newPage(); const verify = await monitor(context, page);
  try {
    await page.goto(`${base}/demo/checkout`);
    const expected: Record<string, string> = { declined: "Payment declined. No order was placed.", requires_action: "Buyer approval required.", out_of_stock: "The requested quantity is unavailable.", order_failed: "Order could not be placed. Payment authorization released.", capture_failed: "Payment failed. Order canceled and authorization released.", handoff: "Finish checkout on the merchant’s website." };
    for (const [scenario, message] of Object.entries(expected)) {
      const created = await start(page, scenario);
      if (created.state === "awaiting_payment") await complete(page);
      await page.getByRole("region", { name: "Checkout summary" }).getByText(message, { exact: true }).waitFor();
      assert.equal(await page.getByRole("heading", { name: "Purchase complete", exact: true }).count(), 0, scenario);
    }
    await start(page, "price_changed");
    const changed = await complete(page);
    assert.equal(changed.state, "awaiting_payment");
    await page.getByText("The price changed. Review the new total and confirm again.", { exact: true }).waitFor();
    assert.equal((await complete(page)).state, "completed");
    await page.getByRole("heading", { name: "Purchase complete", exact: true }).waitFor();
    verify();
  } finally { await context.close(); }
});

test("browser: mobile layout is usable and checkout cancellation works", async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(); const verify = await monitor(context, page);
  try {
    await page.goto(`${base}/demo/checkout`);
    await start(page, "success");
    await page.getByRole("button", { name: "Cancel checkout", exact: true }).click();
    await page.getByText("Canceled", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: /Confirm purchase/ }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: `${artifacts}/mobile.png`, fullPage: true });
    verify();
  } finally { await context.close(); }
});

test("browser: product size, quantity and shipping select the matching merchant purchase", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await context.newPage(); const verify = await monitor(context, page);
  try {
    await page.goto(`${base}/demo/checkout`);
    await page.getByLabel("Size").selectOption({ label: "30 ml" });
    await page.getByLabel("Quantity").selectOption("6");
    const created = await start(page, "success"); assert.equal(created.totals.at(-1).amount, 7794);
    const updated = page.waitForResponse(r => r.url().includes(`/api/v1/checkouts/${created.id}`) && r.request().method() === "PUT");
    await page.getByLabel("Shipping").selectOption("express");
    assert.equal((await (await updated).json()).totals.at(-1).amount, 9289);
    await page.getByRole("button", { name: "Confirm purchase · $92.89", exact: true }).waitFor();
    const done = await complete(page); assert.equal(done.state, "completed"); assert.equal(done.line_items[0].variant_title, "30 ml"); assert.equal(done.line_items[0].quantity, 6);
    await page.getByRole("link", { name: "View merchant receipt →" }).waitFor();
    const receipt = await (await fetch(done.order.merchant_order_url)).text();
    assert.ok(receipt.includes("$92.89")); assert.ok(receipt.includes("30 ml")); verify();
  } finally { await context.close(); }
});
