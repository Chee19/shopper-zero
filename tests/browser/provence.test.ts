import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright";

let browser: Browser;
before(async () => {
  browser = await chromium.launch({ headless: true,
    ...(existsSync(chromium.executablePath()) ? {} : { channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL ?? "chrome" }) });
});
after(async () => { await browser?.close(); });

for (const mode of ["before", "after"] as const) test(`judge demo: ${mode} storefront prices, size selection and agent checkout`, async () => {
  const origin = mode === "before" ? process.env.PROVENCE_BEFORE_URL ?? "http://127.0.0.1:4001" : process.env.PROVENCE_STORE_URL ?? "http://127.0.0.1:4002";
  const context = await browser.newContext({ userAgent: "ShopperZero/1.0 judge-rehearsal", viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(`${origin}/en-us/`);
    await page.getByRole("button", { name: mode === "before" ? "Necessary only" : "No thanks", exact: true }).click();
    if (mode === "before") {
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.locator("[data-price-for]").first().filter({ hasText: /\$\d/ }).waitFor();
    }
    await page.getByRole("link", { name: "Shop hand cream", exact: true }).click();
    if (mode === "before") {
      await page.locator("[data-add-to-bag]:not([disabled])").waitFor();
      await page.getByRole("button", { name: "75 ml", exact: true }).click();
    }
    else {
      await page.locator("label.swatch").filter({ hasText: "75 ml" }).click();
      assert.equal(await page.getByRole("radio", { name: /75 ml/ }).isChecked(), true);
    }
    await page.locator("[data-pdp-price]").filter({ hasText: "$24.00" }).waitFor();
    const added = page.waitForResponse(r => r.url().includes("/Cart-AddProduct"));
    await page.getByRole("button", { name: "Add to bag", exact: true }).click();
    const cart = await (await added).json();
    assert.equal(cart.addedSku, mode === "before" ? "01HC150" : "01HC075");
    await page.getByRole("link", { name: /^Bag/ }).click();
    await page.getByText(mode === "before" ? "150 ml" : "75 ml", { exact: true }).waitFor();
    const checkout = page.waitForResponse(r => new URL(r.url()).pathname === "/en-us/checkout" && r.request().isNavigationRequest());
    await page.getByRole("link", { name: "Checkout", exact: true }).click();
    assert.equal((await checkout).status(), mode === "before" ? 403 : 200);
    await page.getByRole("heading", { name: mode === "before" ? "Access denied" : "Checkout", exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
