import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { detectPlatform } from "@/features/crawl/detect";
import { createFetcher } from "@/features/crawl/fetch";
import { loadRobots, parseRobots } from "@/features/crawl/robots";
import { storeTarget } from "@/features/crawl/url";

test("parseRobots: a crawl-delay above 10 s counts as a block", () => {
  const o = "https://shop.example.com";
  assert.equal(parseRobots(`${o}/robots.txt`, 200, "User-agent: *\nCrawl-delay: 5", o).blocksUs, null);
  const slow = parseRobots(`${o}/robots.txt`, 200, "User-agent: *\nCrawl-delay: 30", o);
  assert.equal(slow.crawlDelaySec, 30);
  assert.equal(slow.blocksUs, "robots");
});

// Two origins stand in for apex -> www: the homepage on `apex` redirects to `www`.
const servers: Server[] = [];
let apex = "";
let www = "";
let wwwRobots = "";
const serve = async (handler: Parameters<typeof createServer>[1]) => {
  const s = createServer(handler);
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
};
before(async () => {
  www = await serve((req, res) => {
    if (req.url === "/robots.txt") return res.end(wwwRobots);
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><head><title>Shop</title></head><body>hi</body></html>");
  });
  apex = await serve((req, res) => {
    if (req.url === "/robots.txt") return res.end("User-agent: *\nAllow: /");
    res.writeHead(301, { location: `${www}${req.url}` });
    res.end();
  });
});
after(() => servers.forEach((s) => s.close()));

async function detectVia(robots: string) {
  wwwRobots = robots;
  const fetcher = createFetcher({ allowPrivate: true });
  const target = storeTarget({ domain: "shop.test", base_url: apex });
  await loadRobots(fetcher, target.origin);
  const d = await detectPlatform(fetcher, target);
  return { d, fetcher, target };
}

test("detectPlatform: a cross-origin redirect reloads robots.txt for the new origin", async () => {
  const blocked = await detectVia("User-agent: *\nDisallow: /");
  assert.equal(blocked.target.origin, www);
  assert.equal(blocked.fetcher.robots?.url, `${www}/robots.txt`);
  assert.equal(blocked.d.blocked, "robots");

  const delayed = await detectVia("User-agent: *\nCrawl-delay: 1");
  assert.equal(delayed.d.blocked, null);
  assert.equal(delayed.fetcher.robots?.crawlDelaySec, 1);
  assert.equal(delayed.fetcher.robots?.isAllowed(`${www}/p/x`), true);
});
