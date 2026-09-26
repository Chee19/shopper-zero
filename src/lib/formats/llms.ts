// src/lib/formats/llms.ts  (WS3; pure)
// llms.txt templates (spec 03 §6.5). A line is omitted when its value is unknown.
import type { IndexedProduct, Platform, Store, StoreSummary } from "@/lib/contracts";
import { UCP_VERSION } from "@/lib/contracts";
import { formatMoney } from "@/lib/money";
import type { ScanInfo } from "@/lib/agent/scan-info";
import { mdInline } from "./text";

export const PLATFORM_LABELS: Record<Platform, string> = {
  woocommerce: "WooCommerce",
  magento: "Magento",
  bigcommerce: "BigCommerce",
  squarespace: "Squarespace",
  sfcc: "Salesforce Commerce Cloud",
  prestashop: "PrestaShop",
  wix: "Wix",
  shopify: "Shopify",
  custom: "Custom",
  unknown: "Unknown platform",
};

export const platformLabel = (p: Platform) => PLATFORM_LABELS[p] ?? PLATFORM_LABELS.unknown;

const ROOT_STORE_LIMIT = 200;
export const STORE_LLMS_PRODUCTS = 25;

export interface RootLlmsInput {
  base: string;
  stats: { stores: number; products: number };
  now: string;
  stores: StoreSummary[];
  checkoutLive: boolean;
  agentCheckout: (s: StoreSummary) => boolean;
}

export function renderRootLlmsTxt({ base, stats, now, stores, checkoutLive, agentCheckout }: RootLlmsInput): string {
  const checkoutFlowSuffix = checkoutLive
    ? `; stores with agent checkout return "ready_for_complete", others return "requires_escalation" with a merchant link.`
    : "; checkout currently hands off to the merchant's site through continue_url.";

  const storeLines = stores
    .filter((s) => s.status === "indexed" && !s.opted_out)
    .sort((a, b) => b.product_count - a.product_count)
    .slice(0, ROOT_STORE_LIMIT)
    .map((s) => {
      const checkoutLabel = agentCheckout(s) ? "agent checkout" : "checkout via merchant site";
      const scanSuffix = s.grade_before
        ? ` · scan grade ${s.grade_before}${s.best_method ? ` (best access: ${s.best_method})` : ""}`
        : "";
      return `- [${mdInline(s.name ?? "") || mdInline(s.domain)}](${base}/s/${s.slug}/llms.txt): ${s.domain} · ${platformLabel(s.platform)} · ${s.product_count} products · ${checkoutLabel}${scanSuffix}`;
    });

  return `# ShoperZero

> ShoperZero makes online stores that are not on Shopify readable and buyable by AI agents. It indexes WooCommerce, Magento, BigCommerce, Squarespace, Salesforce Commerce Cloud and custom stores, and serves each one through the interfaces Shopify stores expose: a Shopify-compatible products.json, a UCP profile, an MCP server with Shopify's UCP tool names, and an ACP product feed.

Index: ${stats.stores} stores, ${stats.products} products. Generated ${now}.

## For AI agents

- MCP endpoint (Streamable HTTP, no auth): \`${base}/api/mcp\`. Call \`tools/list\` for the tools and their schemas.
- UCP profile: \`GET ${base}/.well-known/ucp\` (UCP version ${UCP_VERSION}).
- REST API: \`GET ${base}/api/v1/search?q={query}\` (OpenAPI at ${base}/openapi.json).
- Every store also has its own llms.txt, products.json, product feed and UCP profile (links below).
- Store missing? \`scan_store\` checks how agents can reach it (API, page structure, or computer use) and grades it; \`index_store\` adds its catalog here.

### Typical agent flow

1. Find products: \`search_catalog\` (all stores, or one store via \`catalog.store\`). Use \`list_stores\` to see stores.
2. Confirm: \`get_product\` with \`verify: true\` re-checks the live price and stock on the merchant's site.
3. Buy: \`create_checkout\` with variant ids${checkoutFlowSuffix}
4. Pay: \`complete_checkout\`, only after the buyer approves the exact total.

### Rules

- Prices are integers in ISO 4217 minor units: {"amount": 2500, "currency": "USD"} is $25.00.
- Never complete a checkout without the buyer's explicit approval of the final total.
- If a checkout returns \`requires_escalation\`, send the buyer to \`continue_url\` on the merchant's site.
- Index data can be hours old; check \`updated_at\`, or use \`verify: true\`.
- Back off on HTTP 429.

## Stores

${storeLines.join("\n")}${storeLines.length ? "\n\n" : ""}## Docs

- [OpenAPI](${base}/openapi.json): REST read API for search, products and stores
- [UCP profile](${base}/.well-known/ucp): capabilities, services and payment handlers
- [Agent card](${base}/.well-known/agent-card.json): discovery card

## Optional

- [Universal Commerce Protocol](https://ucp.dev): the protocol our MCP tools follow
- [llms.txt](https://llmstxt.org): the format of this file
`;
}

export interface StoreLlmsInput {
  base: string;
  store: Store;
  /** First products by seq (at most STORE_LLMS_PRODUCTS are listed). */
  products: IndexedProduct[];
  agentCheckout: boolean;
  scan: ScanInfo | null;
}

export function renderStoreLlmsTxt({ base, store, products, agentCheckout, scan }: StoreLlmsInput): string {
  const s = store;
  const name = mdInline(s.name ?? "") || mdInline(s.domain);
  const label = platformLabel(s.platform);
  const storeCheckoutLine = agentCheckout
    ? `Agents can buy headlessly through ShoperZero. create_checkout returns "ready_for_complete"; pay with a Stripe Shared Payment Token or x402 USDC (see payment.handlers).`
    : `Headless checkout is not available. create_checkout returns "requires_escalation" with continue_url, a prefilled cart or product page on the merchant's site where the buyer finishes.`;

  const statusLines = [`Index status: ${s.status}${s.claimed ? " (verified by the merchant)" : ""}`];
  if (s.status === "failed" || s.status === "blocked") {
    statusLines.push(`Note: the last crawl did not complete (${s.status}); data may be partial.`);
  }
  if (scan) {
    statusLines.push(
      `Agent readiness scan: grade ${scan.grade} on its own (best access method: ${scan.best_method}); via ShoperZero: grade ${s.readiness.after?.grade ?? "A"}. Report: ${scan.report_url}`,
    );
  }

  const listed = products.slice(0, STORE_LLMS_PRODUCTS);
  const firstHandle = listed[0]?.handle;
  const productLines = listed.map((p) => {
    const { min, max } = p.price_range;
    const range = max.amount > min.amount ? `${formatMoney(min)}–${formatMoney(max)}` : formatMoney(min);
    return `- [${mdInline(p.title) || p.handle}](${base}/s/${s.slug}/products/${p.handle}.json): ${range} · ${p.available ? "in stock" : "out of stock"}`;
  });
  if (s.product_count > STORE_LLMS_PRODUCTS) {
    productLines.push(`- Full list: [${s.product_count} products](${base}/s/${s.slug}/products.json?limit=250)`);
  }

  const catalogLines = [
    `- [products.json](${base}/s/${s.slug}/products.json): Shopify-compatible product list (\`?limit=\` up to 250, \`?page=\`)`,
    ...(firstHandle
      ? [`- [Product JSON](${base}/s/${s.slug}/products/${firstHandle}.json): one product in Shopify's shape; replace the handle`]
      : []),
    `- [ACP product feed](${base}/s/${s.slug}/feed.acp.jsonl): one JSON line per variant (OpenAI/ACP feed format)`,
  ];

  const productsSection = productLines.length ? `## Products\n\n${productLines.join("\n")}\n\n` : "";

  return `# ${name}

> Agent-readable index of ${s.base_url}, a ${label} store, maintained by ShoperZero. ${s.product_count} products${s.currency ? `, prices in ${s.currency}` : ""}. Last crawled ${s.last_crawled_at ?? "not yet"}.

Source store: ${s.base_url}
${statusLines.join("\n")}
Checkout: ${storeCheckoutLine}

## For AI agents

- MCP endpoint scoped to this store (Streamable HTTP, no auth): \`${base}/api/mcp?store=${s.slug}\`. Tools: \`search_catalog\`, \`lookup_catalog\`, \`get_product\`, \`create_checkout\`, \`update_checkout\`, \`get_checkout\`, \`complete_checkout\`, \`cancel_checkout\`, \`get_order\`.
- UCP profile: \`GET ${base}/s/${s.slug}/.well-known/ucp\`
- REST search: \`GET ${base}/api/v1/search?store=${s.slug}&q={query}\`

### Typical agent flow

1. \`search_catalog\` with \`catalog.store = "${s.slug}"\` (automatic on the store-scoped MCP endpoint).
2. \`get_product\` with \`verify: true\` to confirm the live price and stock.
3. \`create_checkout\` with the chosen variant id and quantity.
4. \`complete_checkout\` only after the buyer explicitly approves the total.

Prices are integers in ISO 4217 minor units: {"amount": 2500, "currency": "USD"} is $25.00.

## Catalog data

${catalogLines.join("\n")}

${productsSection}## Optional

- [Merchant site](${s.base_url})
- [Store page](${s.urls.page}): human view on ShoperZero
- [All ShoperZero stores](${base}/llms.txt)
`;
}
