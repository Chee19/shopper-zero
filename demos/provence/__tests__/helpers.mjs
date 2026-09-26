// Shared test plumbing: boot the store in a given mode on an ephemeral port, plus the
// small pieces of spec 02 machinery the scoring test needs (a robots matcher and a
// JSON-LD reader).

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));

/** Ask the OS for a port nobody is using, so parallel runs don't collide. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Boots the store and resolves once it has logged that it is listening. */
export async function startStore(mode) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, STORE_MODE: mode, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${mode} store did not start in time`)), 10000);
    let err = '';
    child.stdout.on('data', d => {
      if (d.toString().includes('demo store')) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on('data', d => { err += d.toString(); });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`${mode} store exited with ${code}: ${err}`));
    });
  });

  const origin = `http://localhost:${port}`;
  return {
    origin,
    port,
    get: (p, init) => fetch(origin + p, init),
    json: async (p, init) => (await fetch(origin + p, init)).json(),
    text: async (p, init) => (await fetch(origin + p, init)).text(),
    stop: () => child.kill(),
  };
}

// --- robots.txt -------------------------------------------------------------

/** Turns a robots path pattern into a regex, honouring `*` and a trailing `$`. */
function patternToRe(pattern) {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + (anchored ? '$' : ''));
}

/**
 * Minimal robots.txt evaluation: pick the group whose User-agent matches (falling back to
 * `*`), then apply the longest matching rule, with Allow winning ties. Enough for the
 * `robots_allows_agents` readiness check.
 */
export function robotsAllows(robotsTxt, ua, pathWithQuery) {
  const groups = [];
  let current = null;
  for (const raw of robotsTxt.split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!current || current.rules.length) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
    } else if ((field === 'allow' || field === 'disallow') && current) {
      current.rules.push({ allow: field === 'allow', pattern: value });
    }
  }

  const lower = ua.toLowerCase();
  const named = groups.find(g => g.agents.some(a => a !== '*' && lower.includes(a)));
  const star = groups.find(g => g.agents.includes('*'));
  const group = named ?? star;
  if (!group) return true;

  let best = null;
  for (const rule of group.rules) {
    if (!rule.pattern) continue;
    if (!patternToRe(rule.pattern).test(pathWithQuery)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

// --- JSON-LD ----------------------------------------------------------------

export function parseJsonLdNodes(html) {
  const nodes = [];
  const re = /<script[^>]*type\s*=\s*["'][^"']*ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { nodes.push(JSON.parse(m[1])); } catch { /* skip, as the spec's safeJson would */ }
  }
  return nodes;
}

const typesOf = n => [].concat(n?.['@type'] ?? []).map(t => String(t).replace(/^https?:\/\/schema\.org\//, ''));

/** Does this page carry a Product (or ProductGroup) with a usable price? */
export function hasProductWithPrice(html) {
  for (const node of parseJsonLdNodes(html)) {
    const types = typesOf(node);
    if (!types.includes('Product') && !types.includes('ProductGroup')) continue;
    const candidates = [node, ...[].concat(node.hasVariant ?? [])];
    for (const c of candidates) {
      for (const offer of [].concat(c.offers ?? [])) {
        const price = Number.parseFloat(offer?.price);
        if (Number.isFinite(price) && price > 0 && offer?.priceCurrency) return true;
      }
    }
  }
  return false;
}

/** Product URLs listed in the sitemap index's child sitemaps. */
export async function sitemapProductUrls(store) {
  const index = await store.text('/sitemap_index.xml');
  const children = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  const productChild = children.find(u => /product/i.test(u));
  if (!productChild) return [];
  const body = await (await fetch(productChild)).text();
  return [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
}
