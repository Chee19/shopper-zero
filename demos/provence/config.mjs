// Shared configuration and derived identity for the Lumière de Provence demo store.
//
// See docs/superpowers/specs/2026-09-26-provence-spec-conformance-design.md §4.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND, PRODUCTS } from './catalog.mjs';

export const MODE = process.env.STORE_MODE === 'after' ? 'after' : 'before';
export const BEFORE = MODE === 'before';
export const PORT = Number(process.env.PORT || (BEFORE ? 4001 : 4002));
export const ORIGIN = `http://localhost:${PORT}`;
export const DW = `/on/demandware.store/${BRAND.siteId}/${BRAND.locale}`;
export const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

// The catalogue carries no timestamps. Shopify-shaped output needs them, so every
// created_at / updated_at / published_at is this fixed instant: ISO with milliseconds
// (spec 00 §4.3). Fixed output is what makes the conformance tests meaningful.
export const STORE_EPOCH = '2026-09-26T10:00:00.000Z';

// Self-declared AI agents and automation clients. The "before" store's CDN rule
// turns all of these away from checkout; the "after" store lets them through.
export const AGENT_UA = /bot|agent|headless|python|curl|wget|httpx|node-fetch|undici|axios|playwright|puppeteer|selenium|shopperzero|gpt|claude|anthropic|openai|perplexity/i;

// --- synthetic numeric ids -------------------------------------------------
// Shopify shapes need integers; our catalogue is keyed by slug and SKU. These are
// stable for a given catalogue order, which is all the spec asks for.

const productSeqById = new Map(PRODUCTS.map((p, i) => [p.id, i + 1]));

/** 1-based position of a product in the catalogue. */
export const productSeq = p => productSeqById.get(p.id);

/** Unique per variant across the whole catalogue: productSeq * 100 + index + 1. */
export const variantSeq = (p, i) => productSeq(p) * 100 + i + 1;

/** Spec 03 §6.1's formula: p.seq * 1000 + (i + 1). */
export const imageId = (p, i) => productSeq(p) * 1000 + i + 1;

/** The one image we have per product, hotlinked as the spec requires (never re-hosted). */
export const productImages = p => [{ url: `${ORIGIN}/static/og/${p.id}.svg`, alt: p.name }];

/** Derived, since the catalogue has no tags field. */
export const productTags = p => [p.category, ...(p.bestseller ? ['bestseller'] : [])];
