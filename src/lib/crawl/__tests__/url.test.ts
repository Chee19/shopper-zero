import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "@/lib/errors";
import { assertPublicHost, canonicalizeProductUrl, isPrivateAddress, storeTarget } from "../url";

test("canonicalizeProductUrl", () => {
  const base = "https://shop.example.com";
  assert.equal(
    canonicalizeProductUrl("/p/hoodie/?utm_source=x&variant=42&gclid=1#reviews", base),
    "https://shop.example.com/p/hoodie?variant=42",
  );
  assert.equal(canonicalizeProductUrl("https://shop.example.com/", base), "https://shop.example.com/");
  assert.equal(canonicalizeProductUrl("https://SHOP.example.com/a///", base), "https://shop.example.com/a");
  assert.equal(canonicalizeProductUrl("/x?ref=home&srsltid=abc", base), "https://shop.example.com/x");
  // same product, same canonical form, whatever the source encoding
  assert.equal(canonicalizeProductUrl("/x?q=a%20b", base), canonicalizeProductUrl("/x?q=a+b&utm_medium=y", base));
});

test("storeTarget", () => {
  assert.deepEqual(storeTarget({ domain: "bulk.com/uk", base_url: "https://www.bulk.com/uk" }), {
    origin: "https://www.bulk.com", baseUrl: "https://www.bulk.com/uk", domainKey: "bulk.com/uk",
  });
});

test("isPrivateAddress", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
  assert.equal(isPrivateAddress("not-an-ip"), true);
});

test("assertPublicHost", async () => {
  const rejects = (url: string, reason: string) =>
    assert.rejects(assertPublicHost(url, false), (e: unknown) =>
      e instanceof AppError && e.code === "validation_error" && (e.details as { reason: string }).reason === reason);
  await rejects("http://127.0.0.1/", "url_not_allowed");
  await rejects("http://[::1]/", "url_not_allowed");
  await rejects("https://8.8.8.8:22/", "url_not_allowed");
  await rejects("ftp://8.8.8.8/", "invalid_url");
  await rejects("not a url", "invalid_url");
  await assertPublicHost("https://8.8.8.8/", false);
  await assertPublicHost("https://8.8.8.8:8443/", false); // DECISIONS C3 ports
  await assertPublicHost("http://127.0.0.1:9999/", true);
});
