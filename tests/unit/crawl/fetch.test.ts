import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { createGzip, gzipSync } from "node:zlib";
import { AppError } from "@/shared/errors";
import { createFetcher, detectChallenge } from "@/features/crawl/fetch";

const h = (o: Record<string, string> = {}) => new Headers(o);
const CF_JSD = `<script>(function(){var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';})();</script>`;
const bigPage = (extra: string) => `<html><head><title>Shop</title></head><body>${"<p>product</p>".repeat(3000)}${extra}</body></html>`;

test("detectChallenge: block pages", () => {
  assert.equal(detectChallenge(403, h(), "<html><title>Just a moment...</title><div id=cf-chl-widget></div></html>"), "challenge");
  assert.equal(detectChallenge(200, h({ "cf-mitigated": "challenge" }), "<html></html>"), "challenge");
  assert.equal(detectChallenge(403, h({ "x-dd-b": "1" }), `<script src="https://geo.captcha-delivery.com/captcha/"></script>`), "challenge");
  assert.equal(detectChallenge(200, h(), "<html>Request unsuccessful. Incapsula incident ID: 123</html>"), "challenge");
  assert.equal(detectChallenge(403, h(), `<div id="px-captcha"></div>`), "challenge");
  assert.equal(detectChallenge(403, h({ server: "AkamaiGHost" }), "<h1>Access Denied</h1>Reference #18.abc"), "forbidden");
  assert.equal(detectChallenge(403, h(), "nope"), "forbidden");
  assert.equal(detectChallenge(404, h(), "not found"), null);
});

test("detectChallenge: protected sites serving normal pages are not blocked", () => {
  assert.equal(detectChallenge(200, h(), bigPage(CF_JSD)), null);
  assert.equal(detectChallenge(200, h({ "x-datadome": "protected" }), bigPage("")), null);
  assert.equal(detectChallenge(200, h(), bigPage(`<script src="/_Incapsula_Resource?SWJIYLWA=x"></script>`)), null);
  assert.equal(detectChallenge(200, h(), bigPage(`<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>`)), null);
});

test("detectChallenge: weak markers on an error page are a challenge", () => {
  assert.equal(detectChallenge(503, h(), `<html>${CF_JSD}</html>`), "challenge");
  assert.equal(detectChallenge(429, h({ "x-datadome": "protected" }), "<html></html>"), "challenge");
});

let server: Server;
let bombClosed = false;
const RAW_BOMB = gzipSync(Buffer.alloc(13_000_000)); // ~13 KB on the wire, past the 12 MB xml cap once inflated
let base = "";
const hits: Record<string, number> = {};
before(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? "/";
    hits[path] = (hits[path] ?? 0) + 1;
    if (path === "/ok") return res.end(`<html>ua=${req.headers["user-agent"]} accept=${req.headers.accept}</html>`);
    if (path === "/flaky") {
      if (hits[path] === 1) { res.writeHead(503, { "retry-after": "0" }); return res.end("busy"); }
      return res.end("recovered");
    }
    if (path === "/missing") { res.writeHead(404); return res.end("no"); }
    if (path === "/forbidden") { res.writeHead(403); return res.end("no"); }
    if (path === "/redirect") { res.writeHead(302, { location: "/ok" }); return res.end(); }
    if (path === "/redirect-private") { res.writeHead(302, { location: "http://127.0.0.1:1/x" }); return res.end(); }
    if (path === "/big") return res.end("x".repeat(3_100_000));
    if (path === "/gz") { res.writeHead(200, { "content-type": "application/octet-stream" }); return res.end(gzipSync("<urlset/>")); }
    if (path === "/latin1") { res.writeHead(200, { "content-type": "text/html; charset=windows-1252" }); return res.end(Buffer.from([0x63, 0x61, 0x66, 0xe9])); }
    if (path === "/gzip-bomb") {
      // Content-Encoding: gzip that never ends: only a streaming, decoded-byte cap can stop it.
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      const gz = createGzip();
      gz.pipe(res);
      const zeros = Buffer.alloc(1 << 20);
      let open = true;
      res.on("close", () => { open = false; bombClosed = true; gz.destroy(); });
      const pump = () => { while (open && gz.write(zeros)); if (open) gz.once("drain", pump); };
      return pump();
    }
    if (path === "/raw-gz-bomb") { res.writeHead(200, { "content-type": "application/octet-stream" }); return res.end(RAW_BOMB); }
    if (path === "/json") { res.writeHead(200, { "content-type": "application/json" }); return res.end(`{"a":1}`); }
    res.writeHead(500); res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

test("fetcher: identifies itself, follows redirects, caches", async () => {
  const f = createFetcher({ allowPrivate: true, userAgent: "ShoperZeroBot/test" });
  const r = await f.get(`${base}/redirect`);
  assert.equal(r.ok, true);
  assert.equal(r.finalUrl, `${base}/ok`);
  assert.match(r.body, /ua=ShoperZeroBot\/test accept=text\/html/);
  assert.equal((await f.get(`${base}/redirect`)).fromCache, true);
  assert.equal(hits["/ok"], 1);
});

test("fetcher: retries 5xx, never 404/403", async () => {
  const f = createFetcher({ allowPrivate: true });
  assert.equal((await f.get(`${base}/flaky`)).body, "recovered");
  assert.equal(hits["/flaky"], 2);
  const miss = await f.get(`${base}/missing`);
  assert.equal(miss.status, 404);
  assert.equal(miss.blocked, null);
  assert.equal(hits["/missing"], 1);
  assert.equal((await f.get(`${base}/forbidden`)).blocked, "forbidden");
  assert.equal(hits["/forbidden"], 1);
});

test("fetcher: blocks robots, ssrf, oversize, deadline, dead hosts", async () => {
  const f = createFetcher({ allowPrivate: true });
  f.robots = { isAllowed: () => false } as never;
  assert.equal((await f.get(`${base}/ok`)).blocked, "robots");
  assert.equal((await f.get(`${base}/ok`, { skipRobots: true })).ok, true);
  f.robots = null;
  assert.equal((await f.get(`${base}/big`)).blocked, "too_large");
  assert.equal((await createFetcher({ allowPrivate: true, deadline: Date.now() }).get(`${base}/ok`)).blocked, "deadline");
  assert.equal((await f.get("http://127.0.0.1:1/", { retries: 0 })).blocked, "network");

  process.env.WOO_DEMO_URL = base; // lets the first hop through without allowPrivate
  try {
    const strict = createFetcher({ allowPrivate: false });
    assert.equal((await strict.get(`${base}/redirect-private`)).blocked, "ssrf");
  } finally {
    delete process.env.WOO_DEMO_URL;
  }
});

test("fetcher: decodes raw gzip and declared charsets", async () => {
  const f = createFetcher({ allowPrivate: true });
  assert.equal((await f.get(`${base}/gz`, { kind: "xml" })).body, "<urlset/>");
  assert.equal((await f.get(`${base}/latin1`)).body, "café");
});

test("fetcher: asFetch is GET-only and flags blocks", async () => {
  const f = createFetcher({ allowPrivate: true });
  const doFetch = f.asFetch();
  const ok = await doFetch(`${base}/json`, { headers: { accept: "application/json" } });
  assert.deepEqual(await ok.json(), { a: 1 });
  const blocked = await doFetch(`${base}/forbidden`);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get("x-shoperzero-blocked"), "forbidden");
  await assert.rejects(doFetch(`${base}/ok`, { method: "POST" }), (e: unknown) => e instanceof AppError && e.code === "bad_request");
});

test("fetcher: gzip bombs stop at the byte cap instead of buffering", async () => {
  const f = createFetcher({ allowPrivate: true });
  const started = Date.now();
  const bomb = await f.get(`${base}/gzip-bomb`, { timeoutMs: 10_000, retries: 0 });
  assert.equal(bomb.blocked, "too_large");
  assert.ok(Date.now() - started < 10_000, "stopped by the cap, not the timeout");
  for (let i = 0; i < 50 && !bombClosed; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(bombClosed, true, "the reader cancels the stream");

  const raw = await f.get(`${base}/raw-gz-bomb`, { kind: "xml" });
  assert.equal(raw.blocked, "too_large");
  assert.equal(raw.body, "");
});

test("fetcher: crawl-delay above 10 s throttles; queued tasks re-check the deadline", async () => {
  const slow = createFetcher({ allowPrivate: true });
  slow.robots = { url: `${base}/robots.txt`, crawlDelaySec: 30, isAllowed: () => true } as never;
  const before = hits["/ok"] ?? 0;
  assert.equal((await slow.get(`${base}/ok`, { noCache: true })).blocked, "rate_limited");
  assert.equal(hits["/ok"] ?? 0, before);

  // 3 s delay, 4.5 s deadline: the second task leaves the queue after the 2 s deadline margin.
  const f = createFetcher({ allowPrivate: true, deadline: Date.now() + 4500 });
  f.robots = { url: `${base}/robots.txt`, crawlDelaySec: 3, isAllowed: () => true } as never;
  const jsonHits = hits["/json"] ?? 0;
  const [first, second] = await Promise.all([f.get(`${base}/missing`), f.get(`${base}/json`, { kind: "json" })]);
  assert.equal(first.status, 404);
  assert.equal(second.blocked, "deadline");
  assert.equal(hits["/json"] ?? 0, jsonHits);
});
