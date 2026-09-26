// src/lib/db/upsert-row.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUpsertRow, collisionHandle, dedupeHandles, sameProduct, variantKey } from "@/infrastructure/database/upsert-row";

const offer = (amount: number, availability = "in_stock") => ({
  price: { amount, currency: "USD" }, compare_at: null, availability, url: null, checked_at: "2026-09-26T10:00:00.000Z",
});
const base = {
  external_id: "101", url: "https://x.com/p/hoodie", handle: "hoodie", title: " Hoodie ",
  description_html: null, description_text: "warm", brand: "NW", product_type: "Hoodies", category: null,
  tags: ["a", "a", " b "], images: [{ url: "https://x.com/1.jpg" }, { url: "https://x.com/1.jpg" }],
  options: [{ name: "Size", values: ["S", "M"] }], source: "platform_api",
  variants: [
    { external_id: null, title: "S", options: { Size: "S" }, sku: null, gtin: null, image_url: null, inventory_quantity: null, offer: offer(4500, "out_of_stock") },
    { external_id: null, title: "M", options: { Size: "M" }, sku: null, gtin: null, image_url: null, inventory_quantity: 3, offer: offer(5000) },
    { external_id: null, title: "M", options: { Size: "M" }, sku: null, gtin: null, image_url: null, inventory_quantity: 3, offer: offer(5000) },
  ],
};

test("buildUpsertRow", () => {
  const r = buildUpsertRow(base);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.row.title, "Hoodie");
  assert.deepEqual(r.row.tags, ["a", "b"]);
  assert.deepEqual(r.row.images, ["https://x.com/1.jpg"]);
  assert.equal(r.row.price_min_minor, 4500);
  assert.equal(r.row.price_max_minor, 5000);
  assert.equal(r.row.price, "45.00");
  assert.equal(r.row.available, true);
  assert.equal(r.row.availability, "in_stock");
  assert.deepEqual(r.row.variants.map((v) => v.external_id), [variantKey(base.variants[0] as never), variantKey(base.variants[1] as never), `${variantKey(base.variants[1] as never)}~2`]);
  assert.match(r.row.variants[0].external_id, /^opt:s-[0-9a-f]{8}$/);
  const again = buildUpsertRow({ ...base, variants: base.variants.map((v) => ({ ...v, offer: { ...v.offer, checked_at: "2026-09-27T00:00:00.000Z" } })) });
  assert.ok(again.ok && again.row.content_hash === r.row.content_hash);
  const bad = buildUpsertRow({ ...base, variants: [] });
  assert.equal(bad.ok, false);
  const mixed = buildUpsertRow({ ...base, variants: [base.variants[0], { ...base.variants[1], offer: { ...offer(1), price: { amount: 1, currency: "EUR" } } }] });
  assert.deepEqual(mixed, { ok: false, url: "https://x.com/p/hoodie", reason: "mixed_currency" });
  assert.equal(variantKey({ ...base.variants[0], options: {}, title: "Default Title" } as never), "default");
  const red = variantKey({ ...base.variants[0], external_id: null, sku: null, options: { color: "赤" } } as never);
  const blue = variantKey({ ...base.variants[0], external_id: null, sku: null, options: { color: "青" } } as never);
  assert.notEqual(red, blue);
  const redM = variantKey({ ...base.variants[0], external_id: null, sku: null, options: { color: "赤", Size: "M" } } as never);
  const blueM = variantKey({ ...base.variants[0], external_id: null, sku: null, options: { color: "青", Size: "M" } } as never);
  assert.notEqual(redM, blueM);
  const other = "https://x.com/other";
  const rows = dedupeHandles([
    r.row,
    { ...r.row, url: other, external_id: "999" },   // different product (different external_id)
    r.row,                                           // same url: same product
    { ...r.row, url: "https://x.com/moved" },        // same non-null external_id: same product, url moved
    { ...r.row, url: "https://x.com/nulls", external_id: null }, // url differs, one external_id null: different
  ]);
  assert.equal(rows[0].handle, "hoodie");
  assert.equal(rows[1].handle, collisionHandle("hoodie", other));
  assert.match(rows[1].handle, /^hoodie-[0-9a-f]{6}$/);
  assert.equal(rows[2].handle, "hoodie");
  assert.equal(rows[3].handle, "hoodie");
  assert.equal(rows[4].handle, collisionHandle("hoodie", "https://x.com/nulls"));
  assert.equal(sameProduct({ url: "a", external_id: null }, { url: "b", external_id: null }), false);
  assert.equal(sameProduct({ url: "a", external_id: "1" }, { url: "b", external_id: "1" }), true);
});
