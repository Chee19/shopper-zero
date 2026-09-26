// Lumière de Provence — a local, dependency-free demo storefront for Shopper Zero.
//
// It mirrors how a large Salesforce Commerce Cloud beauty store behaves (URL scheme,
// Cart-AddProduct endpoints, cookie wall, CDN bot check) under a fictional brand.
//
//   STORE_MODE=before  agent-hostile: JS-only prices, variant bug, pop-up policies, bot wall
//   STORE_MODE=after   the same store with every issue fixed
//
// No external network calls or payments. After-store orders are persisted locally.

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  BRAND, SHIPPING, CATEGORIES, PRODUCTS, productById, variantBySku,
  productPath, categoryPath, fromPrice,
} from './catalog.mjs';
import { productArt } from './art.mjs';
import { openOrders, commerceError } from './orders.mjs';
import { setStockSource, inStock } from './stock.mjs';
import { resolvePid, productVariation } from './sfcc.mjs';
import { handleRpc } from './mcp.mjs';
import { productsJson, toShopifyDetailProduct } from './formats/shopify.mjs';
import { buildUcpProfile } from './formats/ucp.mjs';
import { acpFeed, ACP_VERSION } from './formats/acp.mjs';
import { llmsTxt } from './formats/llms.mjs';
import { productJsonLd } from './formats/jsonld.mjs';

const MODE = process.env.STORE_MODE === 'after' ? 'after' : 'before';
const BEFORE = MODE === 'before';
const PORT = Number(process.env.PORT || (BEFORE ? 4001 : 4002));
const ORIGIN = `http://localhost:${PORT}`;
const DW = `/on/demandware.store/${BRAND.siteId}/${BRAND.locale}`;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

// Self-declared AI agents and automation clients. The "before" store's CDN rule
// turns all of these away from checkout; the "after" store lets them through.
const AGENT_UA = /bot|agent|headless|python|curl|wget|httpx|node-fetch|undici|axios|playwright|puppeteer|selenium|shopperzero|gpt|claude|anthropic|openai|perplexity/i;

// ---------------------------------------------------------------- state

const sessions = new Map(); // sid -> { cart: [{ sku, qty }], checkout: {} }
const persistent = BEFORE ? null : await openOrders(process.env.PROVENCE_DATA_FILE || '.demo-stores/provence-orders.json', variantBySku);
const orders = persistent?.orders ?? new Map();
setStockSource(persistent);   // serializers read live stock through stock.mjs
let orderSeq = 100231;

function session(req, res) {
  const sid = parseCookies(req).dwsid;
  if (sid && sessions.has(sid)) return sessions.get(sid);
  const id = randomBytes(12).toString('hex');
  const s = { id, cart: [], checkout: {} };
  sessions.set(id, s);
  res.setHeader('Set-Cookie', `dwsid=${id}; Path=/; HttpOnly; SameSite=Lax`);
  return s;
}

function cartSummary(s) {
  const lines = s.cart.map(l => {
    const { product, variant } = variantBySku[l.sku];
    const unitPrice = variant.price + (!BEFORE && l === s.cart[0] ? (s.checkout.priceDelta || 0) / 100 : 0);
    return {
      sku: l.sku, productId: product.id, name: product.name, size: variant.size,
      qty: l.qty, unitPrice, total: Math.round(unitPrice * l.qty * 100) / 100, url: productPath(product),
    };
  });
  const subtotal = lines.reduce((n, l) => n + l.total, 0);
  const count = lines.reduce((n, l) => n + l.qty, 0);
  return { lines, subtotal, count, currency: BRAND.currency };
}

function shippingCost(subtotal, method = 'standard') {
  if (method === 'express') return SHIPPING.express;
  return subtotal >= SHIPPING.freeThreshold ? 0 : SHIPPING.standard;
}

function checkoutQuote(s) {
  const cart = cartSummary(s);
  const subtotal = Math.round(cart.subtotal * 100);
  const shipping = Math.round(shippingCost(cart.subtotal, s.checkout.method) * 100);
  const tax = Math.round(subtotal * 825 / 10000);
  return { cart, subtotal_minor: subtotal, shipping: shipping / 100, tax: tax / 100,
    total: (subtotal + shipping + tax) / 100, total_minor: subtotal + shipping + tax,
    shipping_method: s.checkout.method || 'standard',
    shipping_options: ['standard', 'express'].map(id => ({ id, title: id === 'standard' ? 'Standard shipping' : 'Express shipping', amount: Math.round(shippingCost(cart.subtotal, id) * 100) })),
    unavailable: cart.lines.filter(l => !variantBySku[l.sku] || (persistent ? persistent.stock(l.sku) : variantBySku[l.sku].variant.stock) < l.qty).map(l => l.sku),
  };
}

// ---------------------------------------------------------------- helpers

const money = n => `$${n.toFixed(2)}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(c => {
    const i = c.indexOf('=');
    return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  if ((req.headers['content-type'] || '').includes('application/json')) {
    try { return JSON.parse(raw || '{}'); } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

const wantsHtml = req => (req.headers.accept || '').includes('text/html') && req.headers['x-requested-with'] !== 'XMLHttpRequest';

function send(res, status, body, type = 'text/html; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, 'X-Demo-Store-Mode': MODE, ...headers });
  res.end(body);
}
const json = (res, data, status = 200, headers = {}) => send(res, status, JSON.stringify(data, null, 2), 'application/json; charset=utf-8', headers);
const redirect = (res, to) => { res.writeHead(302, { Location: to }); res.end(); };

// ---------------------------------------------------------------- layout

function stars(r) {
  const full = Math.round(r);
  return `<span class="stars" aria-label="${r} out of 5">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</span>`;
}

function layout(s, { title, description, head = '', body, scripts = [] }) {
  const { count } = cartSummary(s);
  const nav = CATEGORIES.map(c => `<a href="${categoryPath(c)}">${c.name}</a>`).join('');
  const promo = BEFORE
    ? 'Complimentary deluxe sample with every order · <u>Details</u>'
    : `Free standard shipping on orders over $${SHIPPING.freeThreshold} · Free 30-day returns`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | ${BRAND.name}</title>
<meta name="description" content="${esc(description)}">
<link rel="stylesheet" href="/static/store.css">
${BEFORE ? '' : `<link rel="alternate" type="application/x-ndjson" href="${ORIGIN}/feed.acp.jsonl" title="ACP product feed">`}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23f4d23c'/%3E%3Ctext x='16' y='22' font-family='Georgia' font-size='16' text-anchor='middle'%3EL%3C/text%3E%3C/svg%3E">
${head}
</head>
<body data-mode="${MODE}">
<div class="promo">${promo}</div>
<header class="site-header">
  <div class="header-row">
    <form class="search" action="/en-us/search" method="get" role="search">
      <input name="q" placeholder="Search products" aria-label="Search products">
    </form>
    <a class="wordmark" href="/en-us/">
      <span class="wm-main">${BRAND.short}</span>
      <span class="wm-sub">DE PROVENCE</span>
    </a>
    <div class="header-actions">
      <a href="/en-us/account" class="muted-link">Sign in</a>
      <a href="/en-us/cart" class="bag">Bag <span class="bag-count" data-bag-count>${count}</span></a>
    </div>
  </div>
  <nav class="main-nav">${nav}</nav>
</header>
<main>${body}</main>
<footer class="site-footer">
  <div class="footer-cols">
    <div><h4>Customer care</h4><a href="/en-us/delivery-returns.html">Delivery &amp; returns</a><a href="/en-us/contact">Contact us</a><a href="/en-us/faq">FAQ</a></div>
    <div><h4>Our house</h4><a href="/en-us/our-story">Our story</a><a href="/en-us/sourcing">Sourcing</a><a href="/en-us/stores">Find a boutique</a></div>
    <div><h4>Shop</h4>${CATEGORIES.slice(0, 4).map(c => `<a href="${categoryPath(c)}">${c.name}</a>`).join('')}</div>
    <div class="newsletter"><h4>Letters from Provence</h4><p>Seasonal news and early access to launches.</p></div>
  </div>
  <p class="legal">© 2026 ${BRAND.name} (fictional brand). Local demo storefront for Shopper Zero · <span class="mode-tag">${MODE}</span></p>
</footer>
<div id="consent-root"></div>
<script>window.__store = ${JSON.stringify({ mode: MODE, dw: DW })};</script>
<script src="/static/site.js" defer></script>
${scripts.map(src => `<script src="${src}" defer></script>`).join('\n')}
</body>
</html>`;
}

function productCard(p) {
  return `<a class="card" href="${productPath(p)}">
    <div class="card-art">${productArt(p, { size: 190 })}</div>
    <div class="card-body">
      <span class="kicker">${esc(p.kicker)}</span>
      <h3>${esc(p.name)}</h3>
      <div class="card-meta">${stars(p.rating)} <span class="muted">(${p.reviews.toLocaleString('en-US')})</span></div>
      ${BEFORE
        ? `<div class="card-price" data-price-for="${p.variants[0].sku}"><span class="skeleton"></span></div>`
        : `<div class="card-price">${p.variants.length > 1 ? 'From ' : ''}${money(fromPrice(p))}</div>`}
    </div>
  </a>`;
}

// ---------------------------------------------------------------- pages

function homePage(s) {
  const best = PRODUCTS.filter(p => p.bestseller);
  const body = `
  <section class="hero">
    <div class="hero-copy">
      <span class="eyebrow">New season</span>
      <h1>The shea ritual, from palm to heel</h1>
      <p>Rich, fast-absorbing care made with shea butter from our partner cooperatives.</p>
      <a class="btn" href="${productPath(productById['shea-hand-cream'])}">Shop hand cream</a>
    </div>
    <div class="hero-art">${productArt(productById['shea-rich-body-cream'], { size: 300 })}${productArt(productById['shea-hand-cream'], { size: 260 })}</div>
  </section>
  <section class="section">
    <div class="section-head"><h2>Bestsellers</h2><a href="${categoryPath(CATEGORIES[1])}">Shop all</a></div>
    <div class="grid">${best.map(productCard).join('')}</div>
  </section>
  <section class="section tiles">
    ${CATEGORIES.map(c => `<a class="tile" href="${categoryPath(c)}"><h3>${c.name}</h3><p>${c.blurb}</p></a>`).join('')}
  </section>`;
  return layout(s, {
    title: 'Provençal skincare and fragrance',
    description: `${BRAND.name}: skincare, body care and fragrance inspired by Provence.`,
    body, scripts: BEFORE ? ['/static/prices-before.js'] : [],
  });
}

function categoryPage(s, cat) {
  const items = PRODUCTS.filter(p => p.category === cat.id);
  const grid = BEFORE
    // Grid is fetched after load by Search-UpdateGrid, like an infinite-scroll SFCC listing.
    ? `<div class="grid" data-grid-cgid="${cat.id}">${items.map(() => '<div class="card skeleton-card"></div>').join('')}</div>`
    : `<div class="grid">${items.map(productCard).join('')}</div>`;
  return layout(s, {
    title: cat.name, description: cat.blurb,
    body: `<section class="section"><div class="plp-head"><h1>${cat.name}</h1><p>${cat.blurb}</p><span class="muted">${items.length} products</span></div>${grid}</section>`,
    scripts: BEFORE ? ['/static/plp-before.js'] : [],
  });
}

function searchPage(s, q) {
  const needle = q.trim().toLowerCase();
  const hits = needle ? PRODUCTS.filter(p => `${p.name} ${p.summary} ${p.category}`.toLowerCase().includes(needle)) : [];
  return layout(s, {
    title: `Search: ${q}`, description: 'Search results',
    body: `<section class="section"><div class="plp-head"><h1>Results for “${esc(q)}”</h1><span class="muted">${hits.length} products</span></div>
      ${hits.length ? `<div class="grid">${hits.map(productCard).join('')}</div>` : '<p>No products matched your search.</p>'}</section>`,
    scripts: BEFORE ? ['/static/prices-before.js'] : [],
  });
}

function shippingText() {
  return `Free standard shipping on orders over $${SHIPPING.freeThreshold}. Otherwise standard shipping is ${money(SHIPPING.standard)} (${SHIPPING.standardDays}) and express is ${money(SHIPPING.express)} (${SHIPPING.expressDays}). Orders placed before 1 pm ET ship the same day.`;
}
function returnsText() {
  return `Free returns within ${SHIPPING.returnDays} days of delivery on unopened and gently used items. Start a return from your order confirmation email; we email a prepaid label.`;
}


function productPage(s, p, pid) {
  const selected = p.variants.find(v => v.sku === pid) || p.variants.find(inStock) || p.variants[0];
  const og = `
<meta property="og:type" content="product">
<meta property="og:title" content="${esc(p.name)}">
<meta property="og:description" content="${esc(p.summary)}">
<meta property="og:image" content="${ORIGIN}/static/og/${p.id}.svg">`;

  const head = BEFORE ? og : `${og}
<meta property="og:price:amount" content="${selected.price.toFixed(2)}">
<meta property="og:price:currency" content="${BRAND.currency}">
<meta property="product:availability" content="${inStock(selected) ? 'in stock' : 'out of stock'}">
<link rel="canonical" href="${ORIGIN}${productPath(p)}">
<script type="application/ld+json">${JSON.stringify(productJsonLd(p))}</script>`;

  const details = `
    <details open><summary>Description</summary><p>${esc(p.description)}</p></details>
    <details><summary>How to use</summary><p>${esc(p.howTo)}</p></details>
    <details><summary>Ingredients</summary><p>${esc(p.ingredients)}</p></details>`;

  let buy;
  if (BEFORE) {
    // Swatches carry a 1-based data-index; pdp-before.js indexes a 0-based array with it.
    buy = `
      <div class="price-row"><span class="price" data-pdp-price><span class="skeleton"></span></span>
        <span class="stock" data-pdp-stock></span></div>
      <div class="swatches" role="group" aria-label="Size">
        ${p.variants.map((v, i) => `<button type="button" class="swatch${i === 0 ? ' is-selected' : ''}" data-index="${i + 1}" data-sku="${v.sku}" aria-pressed="${i === 0}">${v.size}</button>`).join('')}
      </div>
      <div class="qty-row">
        <button type="button" class="btn add-to-bag" data-add-to-bag disabled>Add to bag</button>
      </div>
      <p class="policy-link"><button type="button" class="linklike" data-open-policy>Delivery &amp; returns</button></p>
      <script>window.pdpData = ${JSON.stringify({ pid: p.master, variants: p.variants.map(v => ({ sku: v.sku, size: v.size })) })};</script>`;
  } else {
    buy = `
      <form class="buy" method="post" action="${DW}/Cart-AddProduct" data-buy-form>
        <div class="price-row"><span class="price" data-pdp-price>${money(selected.price)}</span>
          <span class="stock ${inStock(selected) ? 'in' : 'out'}" data-pdp-stock>${inStock(selected) ? 'In stock · ships within 1 business day' : 'Out of stock'}</span></div>
        <fieldset class="swatches"><legend>Size</legend>
          ${p.variants.map(v => `<label class="swatch${v === selected ? ' is-selected' : ''}${inStock(v) ? '' : ' is-oos'}">
            <input type="radio" name="pid" value="${v.sku}" data-price="${v.price}" data-stock="${inStock(v) ? 1 : 0}" ${v === selected ? 'checked' : ''} ${inStock(v) ? '' : 'disabled'}>
            <span>${v.size}</span><small>${money(v.price)}${inStock(v) ? '' : ' · sold out'}</small></label>`).join('')}
        </fieldset>
        <div class="qty-row">
          <label class="qty">Qty <input type="number" name="quantity" value="1" min="1" max="10"></label>
          <button class="btn add-to-bag" type="submit">Add to bag</button>
        </div>
      </form>
      <section class="policy" aria-labelledby="ship-h">
        <h2 id="ship-h">Shipping</h2><p>${shippingText()}</p>
        <h2>Returns</h2><p>${returnsText()}</p>
      </section>`;
  }

  const body = `
  <nav class="crumbs"><a href="/en-us/">Home</a> / <a href="${categoryPath(CATEGORIES.find(c => c.id === p.category))}">${CATEGORIES.find(c => c.id === p.category).name}</a> / <span>${esc(p.name)}</span></nav>
  <section class="pdp" data-product-id="${p.master}">
    <div class="pdp-art">${productArt(p, { size: 420 })}</div>
    <div class="pdp-info">
      <span class="kicker">${esc(p.kicker)}</span>
      <h1>${esc(p.name)}</h1>
      <div class="card-meta">${stars(p.rating)} <a href="#reviews" class="muted">${p.reviews.toLocaleString('en-US')} reviews</a></div>
      <p class="summary">${esc(p.summary)}</p>
      ${buy}
      <div class="accordion">${details}</div>
    </div>
  </section>
  <div class="toast" data-toast hidden></div>`;

  return layout(s, {
    title: p.name, description: p.summary, head, body,
    scripts: [BEFORE ? '/static/pdp-before.js' : '/static/pdp-after.js'],
  });
}

function policyPage(s) {
  const body = BEFORE
    ? `<section class="section narrow"><h1>Delivery &amp; returns</h1>
        <p class="muted">Select a topic to learn more.</p>
        <div class="faq" data-faq>
          <button type="button" class="faq-q" data-cid="shipping">Shipping options and costs</button>
          <button type="button" class="faq-q" data-cid="returns">Returns and exchanges</button>
        </div></section>`
    : `<section class="section narrow"><h1>Delivery &amp; returns</h1>
        <h2>Shipping</h2><p>${shippingText()}</p>
        <table class="rates"><tr><th>Method</th><th>Cost</th><th>Delivery</th></tr>
          <tr><td>Standard</td><td>${money(SHIPPING.standard)} · free over $${SHIPPING.freeThreshold}</td><td>${SHIPPING.standardDays}</td></tr>
          <tr><td>Express</td><td>${money(SHIPPING.express)}</td><td>${SHIPPING.expressDays}</td></tr></table>
        <h2>Returns</h2><p>${returnsText()}</p></section>`;
  return layout(s, {
    title: 'Delivery & returns', description: 'Shipping costs, delivery times and returns.', body,
    scripts: BEFORE ? ['/static/policy-before.js'] : [],
  });
}

function stubPage(s, title) {
  return layout(s, {
    title, description: title,
    body: `<section class="section narrow"><h1>${esc(title)}</h1><p>This page isn't part of the demo storefront.</p><p><a href="/en-us/">Back to the homepage</a></p></section>`,
  });
}

function cartLinesTable(cart, { editable }) {
  return `<table class="lines">
    <thead><tr><th>Item</th><th>Size</th><th>Qty</th><th class="num">Price</th>${editable ? '<th></th>' : ''}</tr></thead>
    <tbody>${cart.lines.map(l => `<tr data-sku="${l.sku}">
      <td><a href="${l.url}">${esc(l.name)}</a><div class="muted small">Item no. ${l.sku}</div></td>
      <td>${esc(l.size)}</td><td>${l.qty}</td><td class="num">${money(l.total)}</td>
      ${editable ? `<td><form method="post" action="${DW}/Cart-RemoveProductLineItem"><input type="hidden" name="pid" value="${l.sku}"><button class="linklike">Remove</button></form></td>` : ''}
    </tr>`).join('')}</tbody></table>`;
}

function cartPage(s) {
  const cart = cartSummary(s);
  const ship = shippingCost(cart.subtotal);
  const body = cart.lines.length === 0
    ? '<section class="section narrow"><h1>Your bag</h1><p>Your bag is empty.</p><a class="btn" href="/en-us/">Continue shopping</a></section>'
    : `<section class="section narrow cart"><h1>Your bag <span class="muted">(${cart.count})</span></h1>
      ${cartLinesTable(cart, { editable: true })}
      <dl class="totals">
        <dt>Subtotal</dt><dd>${money(cart.subtotal)}</dd>
        <dt>Shipping</dt><dd>${BEFORE ? 'Calculated at checkout' : ship === 0 ? 'Free (standard)' : `${money(ship)} standard`}</dd>
        ${BEFORE ? '' : `<dt class="total">Estimated total</dt><dd class="total">${money(cart.subtotal + ship)}</dd>`}
      </dl>
      <a class="btn wide" href="/en-us/checkout">Checkout</a></section>`;
  return layout(s, { title: 'Your bag', description: 'Shopping bag', body });
}

const STATES = ['CA', 'NY', 'TX', 'FL', 'IL', 'WA', 'MA', 'CO', 'GA', 'OR'];

function checkoutPage(s, stage) {
  const cart = cartSummary(s);
  if (!cart.lines.length) return null;
  const c = s.checkout;
  const method = c.method || 'standard';
  const ship = shippingCost(cart.subtotal, method);
  const tax = Math.round(cart.subtotal * 0.0825 * 100) / 100;

  const summary = `<aside class="co-summary"><h2>Order summary</h2>${cartLinesTable(cart, { editable: false })}
    <dl class="totals"><dt>Subtotal</dt><dd>${money(cart.subtotal)}</dd>
    ${stage === 'payment' ? `<dt>Shipping (${method})</dt><dd>${ship === 0 ? 'Free' : money(ship)}</dd><dt>Estimated tax</dt><dd>${money(tax)}</dd><dt class="total">Total</dt><dd class="total">${money(cart.subtotal + ship + tax)}</dd>` : ''}
    </dl></aside>`;

  let main;
  if (stage === 'payment' && c.email) {
    main = `<form method="post" action="/en-us/checkout/place-order" class="co-form">
      <h1>Payment</h1>
      <div class="review"><h3>Shipping to</h3><p>${esc(c.firstName)} ${esc(c.lastName)}<br>${esc(c.address1)}<br>${esc(c.city)}, ${esc(c.state)} ${esc(c.postalCode)}<br>${esc(c.email)}</p><a href="/en-us/checkout">Edit</a></div>
      <div class="test-banner">Test mode · no real payment is taken on this demo store.</div>
      <fieldset class="pay-methods"><legend>Payment method</legend>
        <label class="pay-option"><input type="radio" name="paymentMethod" value="test_card" checked> Adyen test card · Visa ending 4242</label>
      </fieldset>
      <button class="btn wide" type="submit">Place order · ${money(cart.subtotal + ship + tax)}</button>
    </form>`;
  } else {
    const f = (name, label, attrs = '') => `<label>${label}<input name="${name}" value="${esc(c[name])}" ${attrs}></label>`;
    main = `<form method="post" action="/en-us/checkout/shipping" class="co-form">
      <h1>Checkout</h1><p class="muted">Guest checkout · <a href="/en-us/account">Sign in</a></p>
      <h2>Contact</h2>${f('email', 'Email', 'type="email" required autocomplete="email"')}
      <h2>Shipping address</h2>
      <div class="two">${f('firstName', 'First name', 'required')}${f('lastName', 'Last name', 'required')}</div>
      ${f('address1', 'Address', 'required')}
      <div class="three">${f('city', 'City', 'required')}
        <label>State<select name="state" required>${STATES.map(st => `<option ${c.state === st ? 'selected' : ''}>${st}</option>`).join('')}</select></label>
        ${f('postalCode', 'ZIP code', 'required pattern="[0-9]{5}"')}</div>
      <h2>Shipping method</h2>
      <label class="pay-option"><input type="radio" name="method" value="standard" ${method === 'standard' ? 'checked' : ''}> Standard · ${SHIPPING.standardDays} · ${shippingCost(cart.subtotal) === 0 ? 'Free' : money(SHIPPING.standard)}</label>
      <label class="pay-option"><input type="radio" name="method" value="express" ${method === 'express' ? 'checked' : ''}> Express · ${SHIPPING.expressDays} · ${money(SHIPPING.express)}</label>
      <label class="check"><input type="checkbox" name="marketing" value="yes"> Email me news and offers</label>
      <button class="btn wide" type="submit">Continue to payment</button>
    </form>`;
  }
  return layout(s, {
    title: 'Checkout', description: 'Secure checkout',
    body: `<section class="section checkout">${main}${summary}</section>`,
  });
}

function confirmationPage(s, order) {
  const body = `<section class="section narrow confirmation">
    <span class="eyebrow">Thank you</span>
    <h1>Order ${order.id} ${order.status === 'canceled' ? 'canceled' : 'confirmed'}</h1>
    <p>A confirmation will be sent to ${esc(order.email)}. Estimated delivery: ${order.method === 'express' ? SHIPPING.expressDays : SHIPPING.standardDays}.</p>
    ${cartLinesTable(order.cart, { editable: false })}
    <dl class="totals"><dt>Subtotal</dt><dd>${money(order.cart.subtotal)}</dd><dt>Shipping</dt><dd>${order.shipping === 0 ? 'Free' : money(order.shipping)}</dd>
      <dt>Tax</dt><dd>${money(order.tax)}</dd><dt class="total">${order.status === 'canceled' ? 'Canceled total' : 'Total (test)'}</dt><dd class="total">${money(order.total)}</dd></dl>
  </section>`;
  return layout(s, { title: `Order ${order.id}`, description: 'Order confirmation', body });
}

// Cloudflare-style interstitial. Declared agents get a hard 403; everyone else gets a
// JS check that only passes in a real, non-automated browser.
function challengePage(hard) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Just a moment…</title>
<meta name="robots" content="noindex"><link rel="stylesheet" href="/static/store.css"></head>
<body class="challenge"><div class="challenge-box">
<h1>${hard ? 'Access denied' : 'Checking your browser before accessing checkout'}</h1>
<p>${hard
    ? 'Error 1020: This request was blocked by the security rules of this website. Automated clients are not permitted on checkout.'
    : 'This process is automatic. You will be redirected shortly.'}</p>
<p class="muted small">Ray ID: ${randomBytes(8).toString('hex')} · Performance &amp; security by EdgeShield</p>
</div>${hard ? '' : '<script src="/static/challenge.js"></script>'}</body></html>`;
}

function botGate(req, res) {
  if (!BEFORE) return false;
  const ua = req.headers['user-agent'] || '';
  if (AGENT_UA.test(ua) || req.headers['signature-agent']) {
    send(res, 403, challengePage(true), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
    return true;
  }
  if (parseCookies(req).__edge_clearance !== 'ok') {
    send(res, 503, challengePage(false), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- machine-readable files

function robotsTxt() {
  if (BEFORE) {
    return `User-agent: *
Disallow: */cart
Disallow: */checkout
Disallow: /on/demandware.store/
Disallow: */search
Disallow: *?pid=
Allow: /on/demandware.store/${BRAND.siteId}/${BRAND.locale}/Product-Show

Sitemap: ${ORIGIN}/sitemap_index.xml
`;
  }
  return `User-agent: *
Disallow: */account

# AI shopping agents are welcome to browse, cart and check out.
User-agent: ShopperZero
User-agent: ChatGPT-User
User-agent: Claude-User
User-agent: PerplexityBot
Allow: /

Sitemap: ${ORIGIN}/sitemap_index.xml
`;
}




/** A real <sitemapindex>. Spec 02 §5.5.4 prefers child sitemaps matching /product/i. */
function sitemapIndex() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['/sitemap_0-product.xml', '/sitemap_1-pages.xml'].map(u => `  <sitemap><loc>${ORIGIN}${u}</loc></sitemap>`).join('\n')}
</sitemapindex>`;
}

function urlSet(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${ORIGIN}${u}</loc></url>`).join('\n')}
</urlset>`;
}

// Clean .html product URLs only — never `?pid=`, which before-mode's robots.txt
// disallows. A query string here would fail robots_allows_agents and drop the scan
// score from 41/D to 38.8/F (see docs/superpowers/specs/2026-09-26-provence-*).
const productSitemap = () => urlSet(PRODUCTS.map(productPath));
const pageSitemap = () => urlSet(['/en-us/', ...CATEGORIES.map(categoryPath), '/en-us/delivery-returns.html']);

// ---------------------------------------------------------------- router

const MIME = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

async function serveStatic(res, rel) {
  const ogMatch = rel.match(/^og\/([a-z0-9-]+)\.svg$/);
  if (ogMatch && productById[ogMatch[1]]) {
    const svg = productArt(productById[ogMatch[1]], { size: 480 }).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" style="background:#fbf7ee" ');
    return send(res, 200, svg, 'image/svg+xml');
  }
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 404, 'Not found', 'text/plain');
  try {
    send(res, 200, await readFile(file), `${MIME[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`);
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

async function handle(req, res) {
  const url = new URL(req.url, ORIGIN);
  const p = url.pathname;
  const method = req.method;
  const structured = !BEFORE && (req.headers.accept || '').includes('application/json');

  if (p.startsWith('/static/')) return serveStatic(res, p.slice('/static/'.length));
  if (p === '/favicon.ico') return send(res, 204, '');
  if (p === '/robots.txt') return send(res, 200, robotsTxt(), 'text/plain; charset=utf-8');
  if (p === '/sitemap_index.xml') return send(res, 200, sitemapIndex(), 'application/xml');
  if (p === '/sitemap_0-product.xml') return send(res, 200, productSitemap(), 'application/xml');
  if (p === '/sitemap_1-pages.xml') return send(res, 200, pageSitemap(), 'application/xml');

  // --- the agent surface: after-mode only, 404 in before-mode.
  if (p === '/llms.txt') {
    return BEFORE ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, llmsTxt(), 'text/plain; charset=utf-8');
  }
  if (p === '/.well-known/ucp') {
    return BEFORE ? send(res, 404, 'Not found', 'text/plain') : json(res, buildUcpProfile(), 200, { 'Access-Control-Allow-Origin': '*' });
  }
  if (p === '/products.json') {
    if (BEFORE) return send(res, 404, 'Not found', 'text/plain');
    const body = productsJson(url.searchParams);
    if (body.error) return json(res, { errors: body.error }, 400);
    return json(res, body, 200, { 'Access-Control-Allow-Origin': '*' });
  }
  if (p === '/feed.acp.jsonl') {
    if (BEFORE) return send(res, 404, 'Not found', 'text/plain');
    const download = url.searchParams.get('download') === '1';
    return send(res, 200, acpFeed(),
      download ? 'application/x-ndjson; charset=utf-8' : 'text/plain; charset=utf-8', {
        'X-ACP-Feed-Version': ACP_VERSION,
        'Access-Control-Allow-Origin': '*',
        ...(download ? { 'Content-Disposition': 'attachment; filename="lumiere-de-provence.acp.jsonl"' } : {}),
      });
  }
  if (p === '/api/mcp') {
    if (BEFORE) return send(res, 404, 'Not found', 'text/plain');
    if (method !== 'POST') return json(res, { error: 'Use POST with JSON-RPC' }, 405);
    const rpcBody = await readBody(req);
    const reply = Array.isArray(rpcBody) ? rpcBody.map(handleRpc).filter(Boolean) : handleRpc(rpcBody);
    if (!reply || (Array.isArray(reply) && !reply.length)) return send(res, 202, '');
    return json(res, reply, 200, {
      'Access-Control-Allow-Origin': '*',
      ...(req.headers['mcp-session-id'] ? { 'Mcp-Session-Id': req.headers['mcp-session-id'] } : {}),
    });
  }
  {
    const single = p.match(/^\/products\/([a-z0-9-]+)(\.json|\.js)?$/);
    if (single) {
      if (BEFORE) return send(res, 404, 'Not found', 'text/plain');
      const prod = productById[single[1]];
      if (!prod) return json(res, { errors: 'Not Found' }, 404);
      if (single[2] === '.js') return json(res, { errors: 'Not Found' }, 404);   // MVP, spec 03 §6.2
      if (!single[2]) return redirect(res, productPath(prod));
      return json(res, { product: toShopifyDetailProduct(prod) }, 200, { 'Access-Control-Allow-Origin': '*' });
    }
  }
  if (p === '/__demo/orders') return json(res, { mode: MODE, orders: [...orders.values()].filter(o => !url.searchParams.has('checkout_id') || o.checkout_id === url.searchParams.get('checkout_id')) });
  const cancelMatch = p.match(/^\/__demo\/orders\/(LDP\d+)\/cancel$/);
  if (!BEFORE && cancelMatch && method === 'POST') {
    const b = await readBody(req);
    return json(res, await persistent.cancel(cancelMatch[1], b.checkout_id));
  }

  const s = session(req, res);

  // --- SFCC-style controller endpoints
  if (p === `${DW}/Product-Variation`) {
    const hit = resolvePid(url.searchParams.get('pid'));
    if (!hit) return json(res, { error: true, message: 'Unknown product' }, 404);
    await new Promise(r => setTimeout(r, 350)); // simulated API latency
    return json(res, productVariation(hit));
  }
  if (p === `${DW}/Search-UpdateGrid`) {
    await new Promise(r => setTimeout(r, 400));
    const items = PRODUCTS.filter(x => x.category === url.searchParams.get('cgid'));
    return send(res, 200, items.map(productCard).join(''));
  }
  if (p === `${DW}/Page-Include`) {
    const cid = url.searchParams.get('cid');
    const text = cid === 'returns' ? returnsText() : cid === 'shipping' ? shippingText() : null;
    if (!text) return send(res, 404, '', 'text/plain');
    return send(res, 200, `<p>${text}</p>`);
  }
  if (p === `${DW}/Cart-Show`) return json(res, cartSummary(s));
  if (p === `${DW}/Cart-AddProduct` && method === 'POST') {
    const b = await readBody(req);
    const hit = variantBySku[b.pid];
    const qty = Math.max(1, Math.min(10, parseInt(b.quantity || '1', 10) || 1));
    if (!hit || !inStock(hit.variant)) {
      return wantsHtml(req) ? redirect(res, '/en-us/cart') : json(res, { error: true, message: 'This item is unavailable.' }, 400);
    }
    const line = s.cart.find(l => l.sku === b.pid);
    if (line) line.qty = Math.min(10, line.qty + qty); else s.cart.push({ sku: b.pid, qty });
    if (wantsHtml(req)) return redirect(res, '/en-us/cart');
    return json(res, { error: false, message: `${hit.product.name}, ${hit.variant.size} added to your bag`, addedSku: b.pid, cart: cartSummary(s) });
  }
  if (p === `${DW}/Cart-RemoveProductLineItem` && method === 'POST') {
    const b = await readBody(req);
    s.cart = s.cart.filter(l => l.sku !== b.pid);
    return wantsHtml(req) ? redirect(res, '/en-us/cart') : json(res, cartSummary(s));
  }

  // --- storefront pages
  if (p === '/' || p === '/en-us') return redirect(res, '/en-us/');
  if (p === '/en-us/') return send(res, 200, homePage(s));
  if (p === '/en-us/search') return send(res, 200, searchPage(s, url.searchParams.get('q') || ''));
  if (p === '/en-us/cart') return send(res, 200, cartPage(s));
  if (p === '/en-us/delivery-returns.html') return send(res, 200, policyPage(s));

  if (p.startsWith('/en-us/checkout') || p === '/en-us/order-confirmation') {
    if (botGate(req, res)) return;
  }
  if (p === '/en-us/checkout' && method === 'GET') {
    if (structured) return json(res, checkoutQuote(s));
    const html = checkoutPage(s, url.searchParams.get('stage'));
    return html ? send(res, 200, html) : redirect(res, '/en-us/cart');
  }
  if (p === '/en-us/checkout/shipping' && method === 'POST') {
    const b = await readBody(req);
    s.checkout = {
      email: b.email, firstName: b.firstName, lastName: b.lastName, address1: b.address1,
      city: b.city, state: b.state, postalCode: b.postalCode,
      method: b.method === 'express' ? 'express' : 'standard', marketing: b.marketing === 'yes',
      ...(!BEFORE && structured ? { priceDelta: b.price_delta === 100 ? 100 : 0 } : {}),
    };
    if (structured) return json(res, checkoutQuote(s));
    return redirect(res, '/en-us/checkout?stage=payment');
  }
  if (p === '/en-us/checkout/place-order' && method === 'POST') {
    const b = await readBody(req);
    // Replay is resolved before the session/cart check: a previous response may have been lost.
    const existing = structured && b.checkout_id && [...orders.values()].find(o => o.checkout_id === b.checkout_id);
    if (existing) {
      if (existing.payment_reference !== b.payment_reference || Math.round(existing.total * 100) !== b.expected_total) throw commerceError('idempotency_conflict', 'Order details do not match the existing checkout.');
      return json(res, { ...existing, url: `${ORIGIN}/en-us/order-confirmation?order_id=${existing.id}` });
    }
    const cart = cartSummary(s);
    if (!cart.lines.length || !s.checkout.email) {
      if (structured) throw commerceError('validation_error', 'A cart and shipping details are required.', 400);
      return redirect(res, '/en-us/checkout');
    }
    const q = checkoutQuote(s);
    if (structured && (!/^[0-9a-f-]{36}$/i.test(b.checkout_id || '') || !String(b.payment_reference || '').startsWith('pi_mock_'))) throw commerceError('validation_error', 'A checkout ID and simulated payment reference are required.', 400);
    if (structured && b.expected_total !== q.total_minor) throw commerceError('price_changed', 'The price changed. Review the updated total.');
    const input = { mode: MODE, cart, ...s.checkout, shipping: q.shipping, tax: q.tax, total: q.total,
      payment: 'test_card', userAgent: req.headers['user-agent'] || '',
      ...(structured ? { checkout_id: b.checkout_id, payment_reference: b.payment_reference } : {}),
    };
    const order = persistent ? await persistent.place(input) : { ...input, id: `LDP${orderSeq++}`, placedAt: new Date().toISOString() };
    if (!persistent) orders.set(order.id, order);
    s.cart = [];
    s.checkout = {};
    if (structured) return json(res, { ...order, url: `${ORIGIN}/en-us/order-confirmation?order_id=${order.id}` });
    return redirect(res, `/en-us/order-confirmation?order_id=${order.id}`);
  }
  if (p === '/en-us/order-confirmation') {
    const order = orders.get(url.searchParams.get('order_id'));
    return order ? send(res, 200, confirmationPage(s, order)) : send(res, 404, stubPage(s, 'Order not found'));
  }

  const cat = CATEGORIES.find(c => p === categoryPath(c) || p === categoryPath(c).slice(0, -1));
  if (cat) return send(res, 200, categoryPage(s, cat));

  // Current: /en-us/{slug}/{master}.html — §5.5.4 reads the pid as the last path segment
  // before .html. Legacy: /en-us/{slug}-{master}.html.
  const pdp = p.match(/^\/en-us\/([a-z0-9-]+)\/[0-9A-Z]+\.html$/) || p.match(/^\/en-us\/([a-z0-9-]+)-[0-9A-Z]+\.html$/);
  if (pdp && productById[pdp[1]]) return send(res, 200, productPage(s, productById[pdp[1]], BEFORE ? null : url.searchParams.get('pid')));

  const stub = { '/en-us/account': 'Sign in', '/en-us/contact': 'Contact us', '/en-us/faq': 'FAQ', '/en-us/our-story': 'Our story', '/en-us/sourcing': 'Sourcing', '/en-us/stores': 'Find a boutique' }[p];
  if (stub) return send(res, 200, stubPage(s, stub));

  send(res, 404, stubPage(s, 'Page not found'));
}

http.createServer((req, res) => {
  handle(req, res).catch(err => {
    if (!err.code) console.error(err);
    if (!res.headersSent) json(res, { error: { code: err.code || 'internal_error', message: err.code ? err.message : 'Store unavailable.' } }, err.status || 500);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`${BRAND.name} demo store [${MODE}] → ${ORIGIN}/en-us/`);
});
