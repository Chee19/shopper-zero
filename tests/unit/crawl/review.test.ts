import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { resetRateLimits } from "@/features/catalog/ratelimit";
import { staleAware } from "@/features/crawl/view";
import { redactUrlQueries } from "@/features/scan/browser";
import { POST as postScan } from "@/app/api/v1/scans/route";
import { POST as postStore } from "@/app/api/v1/stores/route";

test("staleAware: queued/running rows untouched for 6 min read as failed/stale", () => {
  const now = Date.parse("2026-01-01T00:10:00Z");
  const row = (status: string, updated_at: string) => ({ id: "r", status, updated_at, error: null as string | null });
  assert.deepEqual(staleAware(row("running", "2026-01-01T00:03:00Z"), now), { id: "r", status: "failed", updated_at: "2026-01-01T00:03:00Z", error: "stale" });
  assert.equal(staleAware(row("queued", "2026-01-01T00:03:59Z"), now).status, "failed");
  assert.equal(staleAware(row("running", "2026-01-01T00:05:00Z"), now).status, "running");
  assert.equal(staleAware(row("succeeded", "2026-01-01T00:00:00Z"), now).status, "succeeded");
});

test("redactUrlQueries strips signing keys from logged URLs", () => {
  const msg = "browserType.connectOverCDP: connect ECONNREFUSED wss://connect.browserbase.com?signingKey=secret123&x=1 failed";
  const out = redactUrlQueries(msg);
  assert.doesNotMatch(out, /secret123/);
  assert.match(out, /wss:\/\/connect\.browserbase\.com failed/);
  assert.equal(redactUrlQueries("plain error"), "plain error");
});

test("POST /scans and /stores: per-IP limit returns 429 with the error envelope", async () => {
  resetRateLimits();
  const req = (path: string, body: unknown, ip: string) => new NextRequest(`http://localhost/api/v1/${path}`, {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body),
  });
  const ctx = { params: Promise.resolve({}) } as never;
  // A private host is rejected before any database work, so these only spend tokens.
  for (let i = 0; i < 5; i++) assert.equal((await postScan(req("scans", { url: "http://127.0.0.1/" }, "203.0.113.9"), ctx)).status, 400);
  const limited = await postScan(req("scans", { url: "http://127.0.0.1/" }, "203.0.113.9"), ctx);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.equal((await limited.json()).error.code, "rate_limited");
  // The bucket is per IP and shared by scans and crawls, force included.
  assert.equal((await postStore(req("stores", { url: "http://127.0.0.1/", force: true }, "203.0.113.9"), ctx)).status, 429);
  assert.equal((await postStore(req("stores", { url: "http://127.0.0.1/", force: true }, "198.51.100.7"), ctx)).status, 400);
  resetRateLimits();
});
