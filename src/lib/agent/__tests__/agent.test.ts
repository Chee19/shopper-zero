import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Offer } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { product } from "../../formats/__tests__/fixtures";
import { decodeCursor, encodeCursor } from "../cursor";
import { clientKey, rateLimit, resetRateLimits } from "../ratelimit";
import { selectVariants } from "../select";
import { verifyVariants } from "../verify";

const req = (ip: string) => new Request("https://app.test/x", { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });

describe("cursor", () => {
  it("round-trips offsets", () => {
    assert.equal(decodeCursor(encodeCursor(20)), 20);
    assert.equal(decodeCursor(undefined), 0);
  });
  it("rejects garbage and out-of-range offsets with bad_request", () => {
    for (const c of ["%%%", "abc", encodeCursor(1001), Buffer.from('{"o":-1}').toString("base64url")]) {
      assert.throws(() => decodeCursor(c), (e: unknown) => e instanceof AppError && e.code === "bad_request");
    }
  });
});

describe("rateLimit", () => {
  it("allows the bucket capacity then refuses, per client", () => {
    resetRateLimits();
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) assert.equal(rateLimit(req("1.1.1.1"), "expensive", now), true);
    assert.equal(rateLimit(req("1.1.1.1"), "expensive", now), false);
    assert.equal(rateLimit(req("2.2.2.2"), "expensive", now), true);
    // refills over time (5 per 10 min → one token every 2 min)
    assert.equal(rateLimit(req("1.1.1.1"), "expensive", now + 120_000), true);
  });
  it("keys on the first forwarded address", () => {
    assert.equal(clientKey(req("9.9.9.9")), "9.9.9.9");
    assert.equal(clientKey(null), "anon");
  });
});

describe("selectVariants", () => {
  const p = product();
  it("a variant ref selects that variant's options", () => {
    const s = selectVariants(p, "v-m");
    assert.deepEqual(s.variantIds, ["v-m"]);
    assert.deepEqual(s.selected, [{ name: "Size", label: "M" }]);
  });
  it("explicit selection is case-insensitive", () => {
    assert.deepEqual(selectVariants(p, "p-1", [{ name: "SIZE", label: "l" }]).variantIds, ["v-l"]);
  });
  it("no match keeps all variants with a warning", () => {
    const s = selectVariants(p, "p-1", [{ name: "Size", label: "XXL" }]);
    assert.deepEqual(s.variantIds, ["v-s", "v-m", "v-l"]);
    assert.equal(s.messages[0].code, "no_matching_variant");
  });
  it("a product ref with no selection keeps every variant", () => {
    assert.equal(selectVariants(p, "p-1").variantIds.length, 3);
  });
});

describe("verifyVariants", () => {
  const offer = (amount: number, availability: Offer["availability"] = "in_stock"): Offer => ({
    price: { amount, currency: "USD" },
    compare_at: null,
    availability,
    url: null,
    checked_at: "2026-09-26T11:02:13.000Z",
  });

  it("applies live offers and reports changes", async () => {
    const r = await verifyVariants(product(), ["v-m", "v-l"], async (id) => (id === "v-m" ? offer(4200) : offer(4500, "out_of_stock")));
    assert.deepEqual(r.verifiedIds.sort(), ["v-l", "v-m"]);
    assert.deepEqual(r.verification.changed_variant_ids.sort(), ["v-l", "v-m"]);
    assert.equal(r.verification.ok, true);
    const codes = r.messages.map((m) => m.code).sort();
    assert.deepEqual(codes, ["availability_changed", "price_changed"]);
    assert.equal(r.messages.find((m) => m.code === "price_changed")?.content, "M: was 45.00 USD, now 42.00 USD");
    assert.equal(r.product.variants.find((v) => v.id === "v-m")?.offer.price.amount, 4200);
  });

  it("does not mutate the input product", async () => {
    const p = product();
    await verifyVariants(p, ["v-m"], async () => offer(1));
    assert.equal(p.variants[1].offer.price.amount, 4500);
  });

  it("maps not_implemented, not_found and other failures to warnings", async () => {
    const r1 = await verifyVariants(product(), ["v-m"], async () => {
      throw new AppError("not_implemented", "x");
    });
    assert.deepEqual(r1.messages.map((m) => m.code), ["verify_unavailable"]);
    assert.equal(r1.verification.ok, false);

    const r2 = await verifyVariants(product(), ["v-m"], async () => {
      throw new AppError("not_found", "gone");
    });
    assert.equal(r2.messages[0].code, "no_longer_sold");
    assert.equal(r2.product.variants.find((v) => v.id === "v-m")?.offer.availability, "out_of_stock");

    const r3 = await verifyVariants(product(), ["v-m", "v-l"], async () => {
      throw new Error("ECONNRESET");
    });
    assert.deepEqual(r3.messages.map((m) => m.code), ["verify_failed"]);
  });

  it("times out slow verifiers", async () => {
    const r = await verifyVariants(product(), ["v-m"], () => new Promise(() => {}), { timeoutMs: 20 });
    assert.equal(r.messages[0].code, "verify_failed");
    assert.deepEqual(r.verification.errors, ["v-m: timeout"]);
  });

  it("checks at most 5 variants, available first", async () => {
    const seen: string[] = [];
    const many = product({
      variants: Array.from({ length: 8 }, (_, i) => ({
        ...product().variants[1],
        id: `v${i}`,
        position: i + 1,
        offer: offer(100, i < 3 ? "out_of_stock" : "in_stock"),
      })),
    });
    await verifyVariants(many, many.variants.map((v) => v.id), async (id) => {
      seen.push(id);
      return offer(100);
    });
    assert.deepEqual(seen, ["v3", "v4", "v5", "v6", "v7"]);
  });
});
