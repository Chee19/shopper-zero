// Asserts that what the store serves matches the contracts in docs/specs.
// Key ORDER is part of the Shopify contract, so those are deep-equals on Object.keys().

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startStore, parseJsonLdNodes, hasProductWithPrice, sitemapProductUrls } from './helpers.mjs';
import { PRODUCTS } from '../catalog.mjs';

const MULTI = PRODUCTS.filter(p => p.variants.length > 1);
const SINGLE = PRODUCTS.filter(p => p.variants.length === 1);
const VARIANT_COUNT = PRODUCTS.reduce((n, p) => n + p.variants.length, 0);

let beforeStore;
let afterStore;

before(async () => {
  [beforeStore, afterStore] = await Promise.all([startStore('before'), startStore('after')]);
});
after(() => { beforeStore?.stop(); afterStore?.stop(); });

describe('catalogue fixture assumptions (design §3.3)', () => {
  test('the conditional-key branches both have coverage', () => {
    assert.equal(PRODUCTS.length, 10);
    assert.equal(VARIANT_COUNT, 18);
    assert.equal(SINGLE.length, 4, 'single-variant products exercise the omitted-key branch');
    assert.ok(MULTI.length > 0);
    const oos = PRODUCTS.flatMap(p => p.variants).filter(v => v.stock === 0);
    assert.equal(oos.length, 1, 'one out-of-stock variant exercises the availability mapping');
  });
});

describe('products.json (spec 03 §6.1)', () => {
  test('list product key order', async () => {
    const { products } = await afterStore.json('/products.json?limit=1');
    assert.deepEqual(Object.keys(products[0]), [
      'id', 'title', 'handle', 'body_html', 'published_at', 'created_at', 'updated_at',
      'vendor', 'product_type', 'tags', 'variants', 'images', 'options',
    ]);
  });

  test('list variant key order', async () => {
    const { products } = await afterStore.json('/products.json?limit=1');
    assert.deepEqual(Object.keys(products[0].variants[0]), [
      'id', 'title', 'option1', 'option2', 'option3', 'sku', 'requires_shipping', 'taxable',
      'featured_image', 'available', 'price', 'grams', 'compare_at_price', 'position',
      'product_id', 'created_at', 'updated_at',
    ]);
  });

  test('image object key order follows §6.1 worked example (design §9.5)', async () => {
    const { products } = await afterStore.json('/products.json?limit=1');
    assert.deepEqual(Object.keys(products[0].images[0]), [
      'id', 'created_at', 'position', 'updated_at', 'product_id', 'variant_ids', 'src', 'width', 'height',
    ]);
  });

  test('tags is an array in the list shape, a string in the detail shape', async () => {
    const { products } = await afterStore.json('/products.json?limit=1');
    assert.ok(Array.isArray(products[0].tags));
    const { product } = await afterStore.json('/products/shea-hand-cream.json');
    assert.equal(typeof product.tags, 'string');
  });

  test('price is a decimal string and body_html is never null', async () => {
    const { products } = await afterStore.json('/products.json?limit=250');
    for (const p of products) {
      assert.match(p.body_html, /^<p>/);
      for (const v of p.variants) assert.match(v.price, /^\d+\.\d{2}$/);
    }
  });

  test('no product uses the "Default Title" fallback (design §6.2)', async () => {
    const { products } = await afterStore.json('/products.json?limit=250');
    for (const p of products) {
      assert.equal(p.options[0].name, 'Size');
      for (const v of p.variants) assert.notEqual(v.title, 'Default Title');
    }
  });

  test('parseShopifyPaging semantics', async () => {
    assert.equal((await afterStore.json('/products.json')).products.length, 10);      // default 30
    assert.equal((await afterStore.json('/products.json?limit=2')).products.length, 2);
    assert.equal((await afterStore.json('/products.json?limit=0')).products.length, 10); // invalid -> 30
    const page2 = await afterStore.json('/products.json?limit=4&page=2');
    assert.equal(page2.products[0].id, 5);

    const res = await afterStore.get('/products.json?limit=250&page=200');
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { errors: 'Page * Limit exceeds the 25000 limit.' });
  });

  test('detail shape key order and unknown handle', async () => {
    const { product } = await afterStore.json('/products/shea-hand-cream.json');
    assert.deepEqual(Object.keys(product), [
      'id', 'title', 'body_html', 'vendor', 'product_type', 'created_at', 'handle',
      'updated_at', 'published_at', 'template_suffix', 'published_scope', 'tags',
      'variants', 'options', 'images', 'image',
    ]);
    assert.deepEqual(Object.keys(product.images[0]), [
      'id', 'product_id', 'position', 'created_at', 'updated_at', 'alt', 'width', 'height', 'src', 'variant_ids',
    ]);
    assert.deepEqual(Object.keys(product.variants[0]), [
      'id', 'product_id', 'title', 'price', 'sku', 'position', 'inventory_policy',
      'compare_at_price', 'fulfillment_service', 'inventory_management', 'option1',
      'option2', 'option3', 'created_at', 'updated_at', 'taxable', 'barcode', 'grams',
      'image_id', 'weight', 'weight_unit', 'inventory_quantity', 'old_inventory_quantity',
      'tax_code', 'requires_shipping', 'quantity_rule', 'price_currency',
      'compare_at_price_currency', 'quantity_price_breaks',
    ]);

    const missing = await afterStore.get('/products/no-such-thing.json');
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { errors: 'Not Found' });
  });
});

describe('UCP profile (spec 03 §6.6)', () => {
  test('`ucp` is the only top-level key and the service is MCP', async () => {
    const profile = await afterStore.json('/.well-known/ucp');
    assert.deepEqual(Object.keys(profile), ['ucp']);
    assert.equal(typeof profile.ucp.version, 'string');
    const svc = profile.ucp.services['dev.ucp.shopping'][0];
    assert.equal(svc.transport, 'mcp');
    assert.equal(svc.endpoint, `${afterStore.origin}/api/mcp`);
  });

  test('declares the capabilities the api probe maps to', async () => {
    const { ucp } = await afterStore.json('/.well-known/ucp');
    for (const c of ['catalog.search', 'catalog.lookup', 'cart', 'checkout', 'fulfillment', 'order']) {
      assert.ok(ucp.capabilities[`dev.ucp.shopping.${c}`], `missing dev.ucp.shopping.${c}`);
    }
    assert.deepEqual(ucp.payment_handlers, {}, 'design §9.3: this store never takes a payment');
  });
});

describe('ACP feed (spec 03 §6.3)', () => {
  test('one line per variant, and never a null, empty or "null" value', async () => {
    const body = await afterStore.text('/feed.acp.jsonl');
    assert.ok(body.endsWith('\n'));
    const lines = body.trim().split('\n');
    assert.equal(lines.length, VARIANT_COUNT);
    for (const line of lines) {
      const row = JSON.parse(line);
      for (const [k, v] of Object.entries(row)) {
        assert.ok(v !== null && v !== '' && v !== 'null', `${k} was emitted as an unknown value`);
      }
      for (const k of ['item_id', 'title', 'description', 'url', 'brand', 'seller_name', 'image_url', 'price', 'availability']) {
        assert.ok(row[k], `required ACP field ${k} missing`);
      }
      assert.match(row.price, /^\d+\.\d{2} [A-Z]{3}$/);
    }
  });

  test('variation keys are present for multi-variant and absent for single-variant products', async () => {
    const rows = (await afterStore.text('/feed.acp.jsonl')).trim().split('\n').map(l => JSON.parse(l));
    const byId = Object.fromEntries(rows.map(r => [r.item_id, r]));

    const multi = MULTI[0];
    const multiRow = byId[multi.variants[0].sku];
    assert.equal(multiRow.group_id, multi.master);
    assert.notEqual(multiRow.group_id, multiRow.item_id, '§6.3: group_id must differ from item_id');
    assert.equal(multiRow.listing_has_variations, true);
    assert.ok(multiRow.variant_dict);
    assert.ok(multiRow.title.includes(' - '));

    for (const p of SINGLE) {
      const row = byId[p.variants[0].sku];
      assert.ok(!('group_id' in row), `${p.id} should not carry group_id`);
      assert.ok(!('listing_has_variations' in row), `${p.id} should not carry listing_has_variations`);
      assert.ok(!('variant_dict' in row), `${p.id} should not carry variant_dict`);
      assert.equal(row.title, p.name, `${p.id} title should carry no size suffix`);
    }
  });

  test('feed version header and download switch', async () => {
    const plain = await afterStore.get('/feed.acp.jsonl');
    assert.equal(plain.headers.get('x-acp-feed-version'), '2026-04-17');
    assert.match(plain.headers.get('content-type'), /text\/plain/);

    const dl = await afterStore.get('/feed.acp.jsonl?download=1');
    assert.match(dl.headers.get('content-type'), /application\/x-ndjson/);
    assert.match(dl.headers.get('content-disposition'), /attachment/);
  });
});

describe('availability mapping', () => {
  test('the one out-of-stock variant reads as such in all three formats', async () => {
    const oosProduct = PRODUCTS.find(p => p.variants.some(v => v.stock === 0));
    const oosSku = oosProduct.variants.find(v => v.stock === 0).sku;

    const rows = (await afterStore.text('/feed.acp.jsonl')).trim().split('\n').map(l => JSON.parse(l));
    assert.equal(rows.find(r => r.item_id === oosSku).availability, 'out_of_stock');

    const { product } = await afterStore.json(`/products/${oosProduct.id}.json`);
    const { products } = await afterStore.json('/products.json?limit=250');
    const listProduct = products.find(p => p.handle === oosProduct.id);
    assert.equal(listProduct.variants.find(v => v.sku === oosSku).available, false);
    assert.equal(product.variants.find(v => v.sku === oosSku).inventory_quantity, 0);

    const html = await afterStore.text(`/en-us/${oosProduct.id}/${oosProduct.master}.html`);
    const group = parseJsonLdNodes(html)[0];
    const variant = group.hasVariant.find(v => v.sku === oosSku);
    assert.equal(variant.offers.availability, 'https://schema.org/OutOfStock');
  });
});

describe('JSON-LD (spec 02 §5.7)', () => {
  test('after-mode PDPs carry a ProductGroup whose url matches the page', async () => {
    for (const p of PRODUCTS) {
      const path = `/en-us/${p.id}/${p.master}.html`;
      const html = await afterStore.text(path);
      const nodes = parseJsonLdNodes(html);
      assert.equal(nodes.length, 1, `${p.id} should carry exactly one JSON-LD block`);
      const g = nodes[0];
      assert.equal(g['@type'], 'ProductGroup');
      assert.equal(g.url, afterStore.origin + path, 'url must canonicalize to the page (§5.7 rule 6)');
      assert.equal(g.productGroupID, p.master);
      assert.equal(g.hasVariant.length, p.variants.length);
      for (const v of g.hasVariant) {
        assert.equal(v['@type'], 'Product');
        assert.equal(v.inProductGroupWithID, p.master);
        assert.match(v.offers.price, /^\d+\.\d{2}$/);
        assert.equal(v.offers.priceCurrency, 'USD');
        assert.match(v.offers.availability, /schema\.org\/(InStock|OutOfStock)$/);
      }
      assert.ok(hasProductWithPrice(html));
    }
  });

  test('before-mode PDPs carry none, which is the point of before-mode', async () => {
    const html = await beforeStore.text('/en-us/shea-hand-cream/01HC150.html');
    assert.equal(parseJsonLdNodes(html).length, 0);
    assert.equal(hasProductWithPrice(html), false);
  });
});

describe('SFCC Product-Variation (spec 02 §5.5.4)', () => {
  const DW = '/on/demandware.store/Sites-LDP_US-Site/en_US';

  for (const mode of ['before', 'after']) {
    test(`${mode}-mode returns the fields the adapter and probe require`, async () => {
      const store = mode === 'before' ? beforeStore : afterStore;
      const body = await store.json(`${DW}/Product-Variation?pid=01HC150`);
      const prod = body.product;
      assert.ok(prod, '§5.5.4 continues only if body.product exists');
      assert.equal(prod.productName, 'Shea Butter Hand Cream');
      assert.ok(prod.price.sales.value > 0, '§6.3 signal requires price.sales');
      assert.equal(prod.price.sales.currency, 'USD');
      assert.equal(typeof prod.available, 'boolean');
      assert.equal(prod.readyToOrder, true);
      assert.ok(prod.variationAttributes[0].values.length > 1, 'non-empty variationAttributes sets the `variants` capability');
      assert.equal(prod.masterId, '01HC150');
    });
  }

  test('the pid taken from the product URL resolves for every product', async () => {
    // §5.5.4 reads the pid as the last path segment before .html. If that ever stops
    // resolving, 3 misses out of 5 throw AdapterError('unavailable') and indexing dies.
    for (const p of PRODUCTS) {
      const body = await beforeStore.json(`${DW}/Product-Variation?pid=${p.master}`);
      assert.ok(body.product?.productName, `pid ${p.master} (from ${p.id}) did not resolve`);
    }
  });

  test('the legacy {slug}-{master} id form still resolves', async () => {
    const body = await beforeStore.json(`${DW}/Product-Variation?pid=shea-hand-cream-01HC150`);
    assert.equal(body.product.productName, 'Shea Butter Hand Cream');
  });
});

describe('llms.txt (spec 03 §6.5)', () => {
  test('starts with a heading and keeps the template section order', async () => {
    const body = await afterStore.text('/llms.txt');
    assert.ok(body.trimStart().startsWith('#'));
    assert.ok(!body.trimStart().startsWith('<'));
    const headings = [...body.matchAll(/^#{2,3} .+$/gm)].map(m => m[0]);
    assert.deepEqual(headings, [
      '## For AI agents', '### Typical agent flow', '## Catalog data', '## Products', '## Optional',
    ]);
    for (const p of PRODUCTS) assert.ok(body.includes(p.name), `${p.name} missing from llms.txt`);
  });
});

describe('MCP endpoint (spec 03 §3)', () => {
  const rpc = (store, body) => store.json('/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });

  test('tools/list returns result.tools[], which is what the api probe reads', async () => {
    const res = await rpc(afterStore, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const names = res.result.tools.map(t => t.name);
    assert.deepEqual(names, ['search_catalog', 'lookup_catalog', 'get_product']);
  });

  test('initialize and tools/call work', async () => {
    const init = await rpc(afterStore, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    assert.ok(init.result.serverInfo.name);

    const call = await rpc(afterStore, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'get_product', arguments: { handle: 'shea-hand-cream' } },
    });
    assert.equal(call.result.structuredContent.product.title, 'Shea Butter Hand Cream');
    assert.equal(call.result.structuredContent.product.variants.length, 3);
  });
});

describe('before-mode withholds the whole agent surface (design §5.3)', () => {
  for (const path of ['/products.json', '/llms.txt', '/.well-known/ucp', '/feed.acp.jsonl', '/products/shea-hand-cream.json']) {
    test(`${path} is 404`, async () => {
      assert.equal((await beforeStore.get(path)).status, 404);
    });
  }
  test('/api/mcp is 404', async () => {
    assert.equal((await beforeStore.get('/api/mcp', { method: 'POST', body: '{}' })).status, 404);
  });
});

describe('sitemap (spec 02 §5.5.4)', () => {
  for (const mode of ['before', 'after']) {
    test(`${mode}-mode publishes a sitemapindex with a product child`, async () => {
      const store = mode === 'before' ? beforeStore : afterStore;
      const index = await store.text('/sitemap_index.xml');
      assert.match(index, /<sitemapindex/);
      const urls = await sitemapProductUrls(store);
      assert.equal(urls.length, PRODUCTS.length);
      // The knife-edge (design §3.1): a `?pid=` URL here would trip before-mode's
      // robots.txt Disallow and drop the score from 41/D to 38.8/F.
      for (const u of urls) assert.ok(!u.includes('?'), `${u} must not carry a query string`);
    });
  }
});
