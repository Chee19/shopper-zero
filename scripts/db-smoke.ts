// scripts/db-smoke.ts: end-to-end check of the src/lib/db helpers against the Supabase in .env.local.
// Run with `npm run db:smoke` (local by default). Needs the seed (`npm run db:reset`).
// Wrapped in main(): the file runs as CommonJS under tsx, where top-level await is not allowed.
// Every row it creates is removed at the end (fixed seed ids are only read, never changed).
import assert from "node:assert/strict";
import {
  db, getStoreBySlug, searchProducts, getProduct, lookupProducts, listStoreProducts,
  upsertStoreProducts, getPublicMetrics, logAgentRequest, getVariantsForCheckout,
  getScan, getLatestScanForStore, upsertScan, claimScan, supersedeScans, getIndexStats,
  getStoreById, getStoreByDomain, resolveStore, listStores, upsertStoreForUrl, updateStore, setStoreReadiness,
  createCrawlRun, getCrawlRun, getLatestCrawlRun, updateCrawlRun, claimCrawlRun, getActiveCrawlRun,
  countActiveCrawlRuns, appendCrawlLog,
  getProductByHandle, getProductsByIds, findProducts, getProductSummaries, getVariantForVerify, updateVariantOffer,
  getActiveScanForStore, countActiveScans, uploadScanScreenshot,
  insertCheckout, getCheckoutRecord, getCheckoutByIdempotencyKey, updateCheckoutRecord, insertCheckoutEvent,
  listCheckoutEvents, insertOrder, getOrder, getOrderByCheckoutId, updateOrderStatus,
  upsertClaim, getOrCreateClaim, getClaim, markClaimVerified, setStoreOptOut,
} from "../src/lib/db";
import { isAppError } from "../src/lib/errors";

const STORE = "11111111-1111-4111-8111-111111111111";
const HOODIE = "22222222-2222-4222-8222-222222222201";
const HOODIE_S = "33333333-3333-4333-8333-333333333301";
const SEED_SCAN = "55555555-5555-4555-8555-555555555501";
const SMOKE_HANDLE = "smoke-beanie";

async function rejectsWith(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e) => isAppError(e) && e.code === code);
}

async function main() {
  // Leftovers from an aborted earlier run.
  await db().from("products").delete().eq("store_id", STORE).eq("handle", SMOKE_HANDLE);

  const store = await getStoreBySlug("demo-store-example");
  assert.ok(store, "seed store missing: run npm run db:reset");
  assert.ok(store.urls.products_json.endsWith("/s/demo-store-example/products.json"));

  const s = await searchProducts({ query: "hoodie", max_minor: 5000 });
  assert.equal(s.products[0]?.id, HOODIE);
  assert.equal(s.products[0].price_range.min.amount, 4500);

  const byVariant = await getProduct(HOODIE_S);
  assert.ok(byVariant);
  assert.equal(byVariant.id, HOODIE);
  assert.deepEqual(byVariant.variants.map((v) => v.title), ["S", "M", "L"]);
  assert.equal(byVariant.variants[2].offer.availability, "out_of_stock");
  assert.equal((await getProduct(`demo-store-example:${byVariant.seq}`))?.id, HOODIE);

  const lk = await lookupProducts([HOODIE, "nope"]);
  assert.deepEqual([lk.products.length, lk.not_found], [1, ["nope"]]);

  const page = await listStoreProducts(store.id, { limit: 2, page: 1 });
  assert.equal(page.products.length, 2);
  assert.ok(page.total >= 3);

  const [group] = await getVariantsForCheckout([{ variant_id: HOODIE_S, quantity: 2 }]);
  assert.ok(group);
  assert.equal(group.lines[0].quantity, 2);

  const now = new Date().toISOString();
  const beanie = (variants: string[]) => ({
    external_id: "smoke-1", url: "https://demo-store.example/product/smoke-beanie/", handle: SMOKE_HANDLE,
    title: "Smoke Test Beanie", description_html: null, description_text: "test", brand: "Northwind",
    product_type: "Hats", category: null, tags: ["beanie"], images: [], options: [], source: "jsonld" as const,
    variants: variants.map((t, i) => ({ external_id: t, title: t, options: { Color: t }, sku: null, gtin: null,
      image_url: null, inventory_quantity: null,
      offer: { price: { amount: 2200 + i * 100, currency: "USD" }, compare_at: null, availability: "in_stock" as const, url: null, checked_at: now } })),
  });

  let smokeStoreId: string | null = null;
  const scanIds: string[] = [];
  try {
    const up1 = await upsertStoreProducts(store.id, [beanie(["Red", "Blue"])]);
    assert.deepEqual([up1.upserted, up1.failed.length], [1, 0]);
    const blueId = (await getProduct(up1.product_ids[0]))?.variants.find((v) => v.title === "Blue")?.id;
    await upsertStoreProducts(store.id, [beanie(["Blue"])]); // Red is kept but marked unavailable and sorted last
    const b = await getProduct(up1.product_ids[0]);
    assert.deepEqual(b?.variants.map((v) => [v.title, v.offer.availability]), [["Blue", "in_stock"], ["Red", "out_of_stock"]]);
    assert.equal(b?.variants[0].id, blueId);                 // Blue kept its uuid
    const same = await upsertStoreProducts(store.id, [beanie(["Blue"])]);
    assert.equal(same.unchanged, 1);                         // unchanged content_hash: write skipped
    const clash = await upsertStoreProducts(store.id, [{ ...beanie(["Blue"]), external_id: "other", url: "https://demo-store.example/p/other/" }]);
    assert.deepEqual(clash.failed.map((f) => f.error), ["handle_collision"]);
    assert.equal((await getStoreBySlug("demo-store-example"))?.product_count, 4);
    const invalid = await upsertStoreProducts(store.id, [{ ...beanie(["Blue"]), variants: [] }]);
    assert.deepEqual([invalid.upserted, invalid.skipped.length], [0, 1]);
    const badStore = await upsertStoreProducts("not-a-uuid", [beanie(["Blue"])]);
    assert.deepEqual([badStore.upserted, badStore.failed.length], [0, 1]); // chunk error -> failed[], never throws

    // Product readers
    const beanieId = up1.product_ids[0];
    assert.equal((await getProductByHandle(store.id, SMOKE_HANDLE))?.id, beanieId);
    assert.deepEqual((await getProductsByIds([beanieId, "nope", HOODIE])).map((p) => p.id), [beanieId, HOODIE]);
    assert.deepEqual((await getProductSummaries([HOODIE, beanieId])).map((p) => [p.id, p.variants_count]), [[HOODIE, 3], [beanieId, 2]]);
    assert.deepEqual((await findProducts({ variantIds: [HOODIE_S] })).map((p) => p.id), [HOODIE]);
    assert.deepEqual(await findProducts({ variantIds: [HOODIE_S], handles: [SMOKE_HANDLE] }), []); // keys are ANDed
    assert.equal((await findProducts({ storeId: store.id, limit: 2 })).length, 2);
    assert.equal(await getProduct("nope"), null);
    await rejectsWith(getVariantsForCheckout([{ variant_id: "00000000-0000-4000-8000-000000000000", quantity: 1 }]), "not_found");

    // verifyOffer path, on the smoke product only (seed rows stay untouched)
    const verify = await getVariantForVerify(blueId!);
    assert.equal(verify?.product.id, beanieId);
    assert.equal(verify?.store.id, store.id);
    assert.equal(await getVariantForVerify("bad"), null);
    await updateVariantOffer(blueId!, { price: { amount: 1999, currency: "USD" }, compare_at: null, availability: "in_stock", url: null, checked_at: now });
    const verified = await getProduct(beanieId);
    assert.deepEqual([verified?.price_range.min.amount, verified?.price_range.max.amount], [1999, 1999]); // stale Red excluded

    // scans (DECISIONS §A)
    const seedScan = await getScan(SEED_SCAN);
    assert.equal(seedScan?.best_method, "api");
    assert.equal(seedScan?.probes.length, 3);
    assert.equal(await getScan("bad-id"), null);
    const sc = await upsertScan({ store_id: store.id, url: store.base_url });
    scanIds.push(sc.id);
    assert.deepEqual([sc.status, sc.best_method, sc.grade], ["queued", "none", "F"]);
    assert.equal((await getActiveScanForStore(store.id, 5))?.id, sc.id);
    assert.ok((await countActiveScans(5)) >= 1);
    assert.equal((await claimScan(sc.id))?.status, "running");
    assert.equal(await claimScan(sc.id), null);              // second claim loses
    const done = await upsertScan({ id: sc.id, status: "done", best_method: "dom", score: 60, grade: "C" });
    assert.equal(done.best_method, "dom");
    assert.equal(done.url, store.base_url);                  // untouched keys kept
    assert.equal((await getLatestScanForStore(store.id))?.id, sc.id);
    assert.equal((await getLatestScanForStore(store.id, { status: "queued" })), null);
    const stale = await upsertScan({ store_id: store.id, url: store.base_url });
    scanIds.push(stale.id);
    assert.ok((await supersedeScans(store.id, sc.id)) >= 1);
    assert.equal((await getScan(stale.id))?.status, "failed");
    assert.equal(await supersedeScans(store.id, sc.id), 0);
    const png = Uint8Array.from(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
    const shotUrl = await uploadScanScreenshot(sc.id, "0.png", png, "image/png");
    assert.equal((await fetch(shotUrl)).status, 200);
    await db().storage.from("scan-screenshots").remove([`${sc.id}/0.png`]);

    assert.ok((await getIndexStats()).stores >= 1);
    const stats = await getIndexStats(store.id);
    assert.equal(stats.product_count >= 3, true);
    assert.equal(stats.offers_complete_ratio, 1);

    // stores
    assert.equal((await resolveStore(store.id))?.id, store.id);
    assert.equal((await resolveStore("https://www.demo-store.example/product/x"))?.id, store.id);
    assert.equal((await resolveStore("demo-store-example"))?.id, store.id);
    assert.equal(await getStoreById("bad"), null);
    assert.equal((await getStoreByDomain("demo-store.example"))?.id, store.id);
    assert.ok((await listStores({ query: "northwind" })).some((x) => x.id === store.id));
    assert.ok((await listStores({ platform: "woocommerce", status: "indexed" })).some((x) => x.id === store.id));
    assert.ok(!(await listStores({ has_checkout: true })).some((x) => x.id === store.id));
    await rejectsWith(upsertStoreForUrl("localhost"), "validation_error");
    const tag = Date.now().toString(36);
    const created = await upsertStoreForUrl(`https://www.db-smoke-${tag}.example/shop/item`);
    smokeStoreId = created.store.id;
    assert.deepEqual([created.created, created.store.status, created.store.platform], [true, "pending", "unknown"]);
    assert.equal(created.store.domain, `db-smoke-${tag}.example`);
    assert.equal((await upsertStoreForUrl(`db-smoke-${tag}.example`)).created, false);
    assert.ok((await listStores({ platform: "unknown", query: `db-smoke-${tag}` })).some((x) => x.id === smokeStoreId));
    await updateStore(smokeStoreId, { metadata: { a: 1 } });
    const upd = await updateStore(smokeStoreId, { metadata: { b: 2 }, name: "Smoke", best_method: "dom" });
    assert.deepEqual([upd.name, upd.best_method], ["Smoke", "dom"]);
    const { data: meta } = await db().from("stores").select("metadata").eq("id", smokeStoreId).single();
    assert.deepEqual(meta?.metadata, { a: 1, b: 2 });          // merged, not replaced
    const report = { score: 90, grade: "A" as const, checks: [], computed_at: now };
    await setStoreReadiness(smokeStoreId, "before", { ...report, score: 20, grade: "F" });
    await setStoreReadiness(smokeStoreId, "after", report);
    const ready = await getStoreById(smokeStoreId);
    assert.deepEqual([ready?.readiness.before?.grade, ready?.readiness.after?.grade], ["F", "A"]);
    await rejectsWith(updateStore("00000000-0000-4000-8000-000000000000", { name: "x" }), "not_found");

    // crawl runs
    const run = await createCrawlRun(smokeStoreId);
    assert.equal(run.status, "queued");
    assert.equal((await getActiveCrawlRun(smokeStoreId, 5))?.id, run.id);
    assert.ok((await countActiveCrawlRuns(5)) >= 1);
    assert.equal((await claimCrawlRun(run.id))?.status, "running");
    assert.equal(await claimCrawlRun(run.id), null);
    await appendCrawlLog(run.id, Array.from({ length: 55 }, (_, i) => ({ level: "info" as const, msg: `m${i}` })));
    await appendCrawlLog(run.id, [{ step: "done", level: "info", msg: "last", at: now }]);
    const logged = await getCrawlRun(run.id);
    assert.equal(logged?.log.length, 50);
    assert.deepEqual([logged?.log[49].msg, logged?.log[49].step, logged?.log[0].msg], ["last", "done", "m6"]);
    const fin = await updateCrawlRun(run.id, { status: "succeeded", products_found: 3, finished_at: now });
    assert.deepEqual([fin.status, fin.products_found, fin.strategy], ["succeeded", 3, null]);
    assert.equal((await getLatestCrawlRun(smokeStoreId))?.id, run.id);
    assert.equal(await getActiveCrawlRun(smokeStoreId, 5), null);

    // claims
    const c1 = await getOrCreateClaim(smokeStoreId);
    assert.equal(c1.method, "dns_txt");
    assert.match(c1.token, /^[0-9a-f]{32}$/);
    const c2 = await getOrCreateClaim(smokeStoreId, "meta_tag");
    assert.deepEqual([c2.token, c2.method], [c1.token, "meta_tag"]); // non-rotating
    const c3 = await upsertClaim(smokeStoreId, "dns_txt");
    assert.notEqual(c3.token, c1.token);                            // rotates
    await markClaimVerified(smokeStoreId);
    assert.ok((await getClaim(smokeStoreId))?.verified_at);
    assert.equal((await getStoreById(smokeStoreId))?.claimed, true);
    assert.equal((await upsertClaim(smokeStoreId, "dns_txt")).verified_at, null);
    await setStoreOptOut(smokeStoreId, true);
    assert.equal((await getStoreById(smokeStoreId))?.opted_out, true);
    assert.ok(!(await listStores({ query: `db-smoke-${tag}` })).some((x) => x.id === smokeStoreId));
    assert.ok((await listStores({ query: `db-smoke-${tag}`, include_opted_out: true })).some((x) => x.id === smokeStoreId));

    // checkouts + orders
    const key = `db-smoke-${tag}`;
    const co = await insertCheckout({
      store_id: smokeStoreId, connector: "handoff", state: "quoting", line_items: [], buyer: null, fulfillment: null,
      totals: [], currency: "USD", total_minor: 4500, connector_state: { cart: "x" }, payment: {}, continue_url: null,
      idempotency_key: key, agent_profile: null, messages: [], error: null, expires_at: null,
    });
    assert.equal(co.state, "quoting");
    await rejectsWith(insertCheckout({ ...co, idempotency_key: key }), "conflict");
    assert.equal((await getCheckoutByIdempotencyKey(key))?.id, co.id);
    assert.equal(await getCheckoutRecord("bad"), null);
    assert.equal(await updateCheckoutRecord(co.id, { state: "awaiting_payment" }, { expectState: "completed" }), null);
    const moved = await updateCheckoutRecord(co.id, { state: "awaiting_payment" }, { expectState: "quoting" });
    assert.deepEqual([moved?.state, moved?.connector_state], ["awaiting_payment", { cart: "x" }]);
    await insertCheckoutEvent({ checkout_id: co.id, from_state: null, to_state: "quoting", message: "created", data: {} });
    await insertCheckoutEvent({ checkout_id: co.id, from_state: "quoting", to_state: "awaiting_payment", message: null, data: { rail: "x402" } });
    assert.deepEqual((await listCheckoutEvents(co.id)).map((e) => e.to_state), ["quoting", "awaiting_payment"]);
    const order = await insertOrder({
      checkout_id: co.id, store_id: smokeStoreId, status: "placed", merchant_order_id: "42", merchant_order_url: null,
      payment: { rail: "x402", reference: "0xabc", amount: { amount: 4500, currency: "USD" }, payer: "0x1" },
    });
    assert.deepEqual([order.payment.amount.amount, order.payment.payer], [4500, "0x1"]);
    await rejectsWith(insertOrder({ ...order }), "conflict");
    assert.equal((await getOrder(order.id))?.id, order.id);
    assert.equal((await getOrderByCheckoutId(co.id))?.id, order.id);
    assert.equal((await updateOrderStatus(order.id, "confirmed")).status, "confirmed");

    // metrics
    await logAgentRequest({ surface: "rest", tool: "db-smoke", store_id: store.id });
    await logAgentRequest({ surface: "bogus" as never, store_id: "not-a-uuid" }); // must not throw
    const m = await getPublicMetrics();
    assert.ok(m.products >= 4 && m.agent_requests >= 1);
  } finally {
    // Cleanup: orders and checkouts do not cascade from stores; everything else does.
    if (smokeStoreId) {
      await db().from("orders").delete().eq("store_id", smokeStoreId);
      await db().from("checkouts").delete().eq("store_id", smokeStoreId);
      await db().from("stores").delete().eq("id", smokeStoreId);
    }
    if (scanIds.length) await db().from("scans").delete().in("id", scanIds);
    await db().from("products").delete().eq("store_id", STORE).eq("handle", SMOKE_HANDLE);
    // Restore the seed product_count (the delete above does not go through upsert_product_batch).
    const { count } = await db().from("products").select("id", { count: "exact", head: true }).eq("store_id", STORE);
    await db().from("stores").update({ product_count: count ?? 0 }).eq("id", STORE);
  }
  console.log("db-smoke OK");
}

main().catch((err) => { console.error(err); process.exit(1); });
