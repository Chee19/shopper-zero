// Locks the pinned Agent Readiness Scores.
//
// This re-implements spec 02 §6.8's scoring and the §6.7 readiness checks, then runs them
// against the live store, so the two grades in the design doc are asserted rather than
// asserted-by-hand. If anyone edits the store off-spec, this fails loudly.
//
//   before → 40.8 → 41 → D   (api_platform: reachable only via Demandware's private API)
//   after  → 100        → A   (api_standard: discoverable UCP + products.json + MCP + ACP)

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startStore, robotsAllows, hasProductWithPrice, sitemapProductUrls } from './helpers.mjs';

// --- constants, copied from the specs ---------------------------------------

// spec 00
const READINESS_WEIGHTS = {
  products_json: 15, well_known_ucp: 15, mcp_endpoint: 15, llms_txt: 10,
  jsonld_product_coverage: 15, sitemap: 10, robots_allows_agents: 10, agent_checkout: 10,
};
const gradeFor = s => (s >= 90 ? 'A' : s >= 75 ? 'B' : s >= 60 ? 'C' : s >= 40 ? 'D' : 'F');

// spec 02 §6.8
const BAND = { api_standard: 45, api_platform: 20, dom: 15, computer_use: 5, none: 0 };
const FACTOR = { api_standard: 1.0, api_platform: 0.7, dom: 0.6, computer_use: 0.3, none: 0 };
const CAPABILITY_WEIGHTS = {
  catalog: 7, product_detail: 5, price_availability: 8, variants: 4, cart: 6, checkout_reachable: 5,
};
const CHECKS_SHARE = 0.20;

// spec 02 §6.7
const SCAN_AGENTS = ['ShoperZeroBot', 'GPTBot', 'ClaudeBot', 'OAI-SearchBot', 'PerplexityBot'];

const DW = '/on/demandware.store/Sites-LDP_US-Site/en_US';

// --- the eight readiness checks (§6.7) --------------------------------------

async function runChecks(store) {
  const pass = {};
  const okJson = async (path, predicate) => {
    try {
      const res = await store.get(path);
      if (!res.ok) return false;
      return predicate(await res.json());
    } catch { return false; }
  };

  pass.products_json = await okJson('/products.json?limit=1', b => Array.isArray(b?.products));

  const profile = await store.get('/.well-known/ucp').then(r => (r.ok ? r.json() : null)).catch(() => null);
  pass.well_known_ucp = typeof profile?.ucp?.version === 'string';

  const advertisesMcp = (profile?.ucp?.services?.['dev.ucp.shopping'] ?? []).some(s => s.transport === 'mcp');
  pass.mcp_endpoint = advertisesMcp || await okJson('/.well-known/mcp/server-card.json', b => !!b);

  pass.llms_txt = await (async () => {
    const res = await store.get('/llms.txt');
    if (!res.ok) return false;
    const body = (await res.text()).trim();
    return body.startsWith('#') && !body.startsWith('<');
  })();

  const productUrls = await sitemapProductUrls(store);
  pass.sitemap = productUrls.length >= 1;

  // Sample 3 product pages, as checks.ts does, and fill the shared pdpSample.
  const sample = productUrls.slice(0, 3);
  let withJsonLd = 0;
  for (const url of sample) {
    const html = await (await fetch(url)).text();
    if (hasProductWithPrice(html)) withJsonLd++;
  }
  pass.jsonld_product_coverage = withJsonLd >= 2;

  const robotsTxt = await store.text('/robots.txt');
  const firstProduct = productUrls[0] ?? `${store.origin}/`;
  const firstPath = new URL(firstProduct).pathname + new URL(firstProduct).search;
  pass.robots_allows_agents = SCAN_AGENTS.every(ua => robotsAllows(robotsTxt, ua, firstPath));

  pass.agent_checkout = !!profile?.ucp?.capabilities?.['dev.ucp.shopping.checkout'];

  const score = Object.entries(pass).reduce((n, [id, ok]) => n + (ok ? READINESS_WEIGHTS[id] : 0), 0);
  return { pass, score, sample, productUrls };
}

// --- the api probe (§6.3) ---------------------------------------------------

const noCaps = () => ({
  catalog: false, product_detail: false, price_availability: false,
  variants: false, cart: false, checkout_reachable: false,
});

async function runApiProbe(store, productUrls) {
  const caps = noCaps();
  const signals = [];
  // Tracks whether a STANDARD-class signal set any capability, which is what §6.8 uses to
  // choose api_standard over api_platform.
  let standardSetACap = false;

  const record = (id, cls, ok, sets = []) => {
    signals.push({ id, cls, ok });
    if (!ok || !sets.length) return;
    for (const c of sets) caps[c] = true;
    if (cls === 'standard') standardSetACap = true;
  };

  // ucp_profile + ucp_capabilities (standard)
  const profile = await store.get('/.well-known/ucp').then(r => (r.ok ? r.json() : null)).catch(() => null);
  const ucpOk = typeof profile?.ucp?.version === 'string';
  record('ucp_profile', 'standard', ucpOk);
  if (ucpOk) {
    const c = profile.ucp.capabilities ?? {};
    const sets = [];
    if (c['dev.ucp.shopping.catalog.search'] || c['dev.ucp.shopping.catalog.lookup']) {
      sets.push('catalog', 'product_detail', 'price_availability');
    }
    if (c['dev.ucp.shopping.cart']) sets.push('cart');
    if (c['dev.ucp.shopping.checkout']) sets.push('checkout_reachable');
    record('ucp_capabilities', 'standard', sets.length > 0, sets);
  } else {
    record('ucp_capabilities', 'standard', false);
  }

  // mcp_endpoint (standard)
  const endpoint = (profile?.ucp?.services?.['dev.ucp.shopping'] ?? []).find(s => s.transport === 'mcp')?.endpoint;
  let mcpOk = false;
  const mcpSets = [];
  if (endpoint) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      const body = await res.json();
      const names = (body?.result?.tools ?? []).map(t => t.name);
      mcpOk = names.length > 0;
      if (names.includes('search_catalog')) mcpSets.push('catalog');
      if (names.includes('get_product') || names.includes('lookup_catalog')) mcpSets.push('product_detail', 'price_availability');
      if (names.includes('create_cart')) mcpSets.push('cart');
      if (names.includes('create_checkout')) mcpSets.push('checkout_reachable');
    } catch { mcpOk = false; }
  }
  record('mcp_endpoint', 'standard', mcpOk, mcpSets);

  // acp_feed (standard): discovered via a homepage <link rel="alternate">
  const home = await store.text('/en-us/');
  const feedHref = home.match(/<link[^>]+type=["']application\/(?:x-ndjson|jsonl)["'][^>]*href=["']([^"']+)["']/i)?.[1]
    ?? home.match(/<link[^>]+href=["']([^"']+)["'][^>]*type=["']application\/(?:x-ndjson|jsonl)["']/i)?.[1];
  let acpOk = false;
  if (feedHref) {
    try {
      const rows = (await (await fetch(feedHref)).text()).trim().split('\n').map(l => JSON.parse(l));
      acpOk = rows.length > 0 && rows.every(r => r.item_id && r.price && r.availability);
    } catch { acpOk = false; }
  }
  record('acp_feed', 'standard', acpOk, acpOk ? ['catalog', 'price_availability'] : []);

  // products_json (standard)
  let pjOk = false;
  const pjSets = [];
  try {
    const res = await store.get('/products.json?limit=5');
    if (res.ok) {
      const body = await res.json();
      const products = body?.products ?? [];
      pjOk = products.length > 0 && products.every(p => p.variants?.every(v => v.price !== undefined && v.available !== undefined));
      if (pjOk) {
        pjSets.push('catalog', 'price_availability');
        if (products.some(p => p.variants.length > 1)) pjSets.push('variants');
        const handle = products[0].handle;
        if ((await store.get(`/products/${handle}.js`)).ok) pjSets.push('product_detail');
      }
    }
  } catch { pjOk = false; }
  record('products_json', 'standard', pjOk, pjSets);

  // sfcc_product_variation (platform): first sitemap PDP pid, then Product-Variation
  let sfccOk = false;
  const sfccSets = [];
  const firstPdp = productUrls[0];
  if (firstPdp) {
    const pid = new URL(firstPdp).pathname.match(/\/([A-Za-z0-9_\-.]+)\.html(?:$|\?)/)?.[1];
    if (pid) {
      try {
        const body = await store.json(`${DW}/Product-Variation?pid=${pid}`);
        const prod = body?.product;
        sfccOk = !!(prod?.price?.sales && prod?.available !== undefined);
        if (sfccOk) {
          sfccSets.push('catalog', 'product_detail', 'price_availability');
          if ((prod.variationAttributes ?? []).length > 0) sfccSets.push('variants');
        }
      } catch { sfccOk = false; }
    }
  }
  record('sfcc_product_variation', 'platform', sfccOk, sfccSets);

  const status = caps.catalog && caps.price_availability
    ? 'passed'
    : Object.values(caps).some(Boolean) ? 'partial' : 'failed';
  const methodClass = status === 'failed' ? 'none' : standardSetACap ? 'api_standard' : 'api_platform';

  return { caps, signals, status, methodClass };
}

function scoreScan({ caps, methodClass }, checksScore) {
  const capScore = Object.entries(caps)
    .reduce((n, [k, on]) => n + (on ? CAPABILITY_WEIGHTS[k] * FACTOR[methodClass] : 0), 0);
  const raw = BAND[methodClass] + capScore + CHECKS_SHARE * checksScore;
  const score = Math.min(100, Math.max(0, Math.round(raw)));
  return { raw, score, grade: gradeFor(score) };
}

// --- the assertions ---------------------------------------------------------

let beforeStore;
let afterStore;

before(async () => {
  [beforeStore, afterStore] = await Promise.all([startStore('before'), startStore('after')]);
});
after(() => { beforeStore?.stop(); afterStore?.stop(); });

describe('before-mode pins to 41 → D (design §3.1)', () => {
  test('only sitemap and robots_allows_agents pass, for 20 check points', async () => {
    const checks = await runChecks(beforeStore);
    assert.deepEqual(checks.pass, {
      products_json: false,
      well_known_ucp: false,
      mcp_endpoint: false,
      llms_txt: false,
      jsonld_product_coverage: false,
      sitemap: true,
      robots_allows_agents: true,
      agent_checkout: false,
    });
    assert.equal(checks.score, 20);
  });

  test('the api probe passes on the private Demandware API alone → api_platform', async () => {
    const checks = await runChecks(beforeStore);
    const probe = await runApiProbe(beforeStore, checks.productUrls);

    assert.equal(probe.status, 'passed', 'catalog && price_availability (§6.1)');
    assert.equal(probe.methodClass, 'api_platform', 'no standard-class signal set a capability');
    assert.equal(probe.signals.find(s => s.id === 'sfcc_product_variation').ok, true);
    for (const id of ['ucp_profile', 'ucp_capabilities', 'mcp_endpoint', 'acp_feed', 'products_json']) {
      assert.equal(probe.signals.find(s => s.id === id).ok, false, `${id} must not pass in before-mode`);
    }
    assert.deepEqual(probe.caps, {
      catalog: true, product_detail: true, price_availability: true,
      variants: true, cart: false, checkout_reachable: false,
    });
  });

  test('scores 20 + 16.8 + 4 = 40.8 → 41 → D', async () => {
    const checks = await runChecks(beforeStore);
    const probe = await runApiProbe(beforeStore, checks.productUrls);
    const { raw, score, grade } = scoreScan(probe, checks.score);

    assert.ok(Math.abs(raw - 40.8) < 1e-9, `expected 40.8, got ${raw}`);
    assert.equal(score, 41);
    assert.equal(grade, 'D');
  });

  test('KNIFE-EDGE: robots_allows_agents is worth the difference between D and F', async () => {
    // Design §3.1. Losing this one check takes the score to 38.8 → F, so the guards that
    // protect it get asserted explicitly rather than left to chance.
    const checks = await runChecks(beforeStore);
    const probe = await runApiProbe(beforeStore, checks.productUrls);
    const withoutRobots = scoreScan(probe, checks.score - READINESS_WEIGHTS.robots_allows_agents);
    assert.equal(withoutRobots.grade, 'F', 'this is what we are protecting against');

    // Guard 1: no product URL in the sitemap carries a query string, which before-mode's
    // `Disallow: *?pid=` would otherwise match.
    for (const u of checks.productUrls) assert.ok(!u.includes('?'), `${u} carries a query string`);

    // Guard 2: every scan agent is allowed on the first product URL.
    const robotsTxt = await beforeStore.text('/robots.txt');
    const firstPath = new URL(checks.productUrls[0]).pathname;
    for (const ua of SCAN_AGENTS) {
      assert.ok(robotsAllows(robotsTxt, ua, firstPath), `${ua} is blocked from ${firstPath}`);
    }
  });
});

describe('after-mode pins to 100 → A (design §3.2)', () => {
  test('all eight checks pass, for 100 check points', async () => {
    const checks = await runChecks(afterStore);
    for (const [id, ok] of Object.entries(checks.pass)) assert.ok(ok, `check ${id} failed`);
    assert.equal(checks.score, 100);
  });

  test('standard signals fire → api_standard, all six capabilities', async () => {
    const checks = await runChecks(afterStore);
    const probe = await runApiProbe(afterStore, checks.productUrls);

    assert.equal(probe.status, 'passed');
    assert.equal(probe.methodClass, 'api_standard', 'this is what lifts the band from 20 to 45');
    for (const id of ['ucp_profile', 'ucp_capabilities', 'mcp_endpoint', 'acp_feed', 'products_json']) {
      assert.equal(probe.signals.find(s => s.id === id).ok, true, `${id} should pass in after-mode`);
    }
    assert.deepEqual(probe.caps, {
      catalog: true, product_detail: true, price_availability: true,
      variants: true, cart: true, checkout_reachable: true,
    });
  });

  test('scores 45 + 35 + 20 = 100 → A', async () => {
    const checks = await runChecks(afterStore);
    const probe = await runApiProbe(afterStore, checks.productUrls);
    const { raw, score, grade } = scoreScan(probe, checks.score);

    assert.equal(raw, 100);
    assert.equal(score, 100);
    assert.equal(grade, 'A');
  });
});

describe('the cascade stops at api in both modes (§6.1)', () => {
  for (const mode of ['before', 'after']) {
    test(`${mode}: api passes, so dom and computer_use are skipped`, async () => {
      const store = mode === 'before' ? beforeStore : afterStore;
      const checks = await runChecks(store);
      const probe = await runApiProbe(store, checks.productUrls);
      assert.equal(probe.status, 'passed');
    });
  }
});
