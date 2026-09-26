// src/lib/formats/openapi.ts  (WS3; pure)
// Hand-written OpenAPI 3.1 for the public REST API (spec 03 §6.8). Keep it under 30 operations (GPT Actions limit).

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonBody = (schema: object) => ({ content: { "application/json": { schema } } });
const ok = (description: string, schema: object) => ({ description, ...jsonBody(schema) });
const err = (description: string) => ({ description, ...jsonBody(ref("Error")) });
const q = (name: string, schema: object, description: string, extra: object = {}) => ({
  name,
  in: "query",
  required: false,
  description,
  schema,
  ...extra,
});
const pathParam = (name: string, description: string) => ({
  name,
  in: "path",
  required: true,
  description,
  schema: { type: "string" },
});

const STR = { type: "string" };
const INT = { type: "integer" };
const BOOL = { type: "boolean" };
const NULLABLE_STR = { type: ["string", "null"] };
const ISO = { type: "string", format: "date-time" };
const OBJ = { type: "object", additionalProperties: true };

const schemas = (checkoutLive: boolean) => ({
  Money: {
    type: "object",
    required: ["amount", "currency"],
    properties: {
      amount: { type: "integer", description: "Integer minor units (2500 = $25.00 USD)" },
      currency: { type: "string", pattern: "^[A-Z]{3}$" },
    },
  },
  PriceRange: { type: "object", properties: { min: ref("Money"), max: ref("Money") } },
  Message: {
    type: "object",
    required: ["type", "code", "content"],
    properties: { type: { enum: ["info", "warning", "error"] }, code: STR, content: STR },
  },
  UcpVariant: {
    type: "object",
    required: ["id", "title", "price", "availability"],
    properties: {
      id: { type: "string", format: "uuid" },
      sku: STR,
      barcodes: { type: "array", items: { type: "object", properties: { type: STR, value: STR } } },
      title: STR,
      price: ref("Money"),
      list_price: ref("Money"),
      availability: { type: "object", properties: { available: BOOL } },
      options: { type: "array", items: { type: "object", properties: { name: STR, label: STR } } },
      media: { type: "array", items: OBJ },
      url: STR,
      checkout_url: { type: "string", description: "Merchant add-to-cart or product link for human handoff" },
      _shoperzero: OBJ,
    },
  },
  UcpProduct: {
    type: "object",
    required: ["id", "title", "price_range", "variants"],
    properties: {
      id: { type: "string", format: "uuid" },
      handle: STR,
      title: STR,
      description: { type: "object", properties: { plain: STR, html: STR } },
      url: STR,
      categories: { type: "array", items: { type: "object", properties: { value: STR, taxonomy: STR } } },
      price_range: ref("PriceRange"),
      list_price_range: ref("PriceRange"),
      media: { type: "array", items: OBJ },
      options: { type: "array", items: OBJ },
      variants: { type: "array", items: ref("UcpVariant") },
      tags: { type: "array", items: STR },
      _shoperzero: { ...OBJ, description: "store, brand, availability, checkout_methods, seq, products_json_url" },
    },
  },
  SearchResponse: {
    type: "object",
    required: ["ucp", "products", "pagination", "messages"],
    properties: {
      ucp: OBJ,
      products: { type: "array", items: ref("UcpProduct") },
      pagination: {
        type: "object",
        properties: { cursor: NULLABLE_STR, has_next_page: BOOL, total_count: INT },
      },
      messages: { type: "array", items: ref("Message") },
    },
  },
  ProductResponse: {
    type: "object",
    required: ["product"],
    properties: {
      ucp: OBJ,
      product: ref("UcpProduct"),
      verification: {
        type: "object",
        properties: {
          verified_at: ISO,
          ok: BOOL,
          changed_variant_ids: { type: "array", items: STR },
          errors: { type: "array", items: STR },
        },
      },
      messages: { type: "array", items: ref("Message") },
    },
  },
  Store: {
    type: "object",
    required: ["id", "slug", "domain", "platform", "status"],
    properties: {
      id: { type: "string", format: "uuid" },
      slug: STR,
      domain: STR,
      base_url: STR,
      name: NULLABLE_STR,
      platform: STR,
      currency: NULLABLE_STR,
      status: { enum: ["pending", "crawling", "indexed", "failed", "blocked"] },
      product_count: INT,
      checkout_connector: STR,
      best_method: { type: ["string", "null"], enum: ["api", "dom", "computer_use", "none", null] },
      last_crawled_at: { type: ["string", "null"], format: "date-time" },
      urls: OBJ,
      readiness: OBJ,
    },
  },
  StoreSummary: {
    type: "object",
    properties: {
      id: STR,
      slug: STR,
      domain: STR,
      name: NULLABLE_STR,
      platform: STR,
      status: STR,
      product_count: INT,
      checkout_connector: STR,
      grade_before: NULLABLE_STR,
      grade_after: NULLABLE_STR,
      best_method: NULLABLE_STR,
      urls: OBJ,
    },
  },
  StoreDetail: {
    allOf: [
      ref("Store"),
      {
        type: "object",
        properties: {
          agent_checkout: BOOL,
          latest_crawl_run: { oneOf: [ref("CrawlRun"), { type: "null" }] },
          scan: {
            type: ["object", "null"],
            properties: { grade: STR, best_method: STR, report_url: STR, scanned_at: ISO },
          },
        },
      },
    ],
  },
  CrawlRun: {
    type: "object",
    properties: {
      id: STR,
      store_id: STR,
      status: { enum: ["queued", "running", "succeeded", "failed"] },
      products_found: INT,
      pages_fetched: INT,
      pages_failed: INT,
      log: { type: "array", items: OBJ },
      error: NULLABLE_STR,
      started_at: { type: ["string", "null"] },
      finished_at: { type: ["string", "null"] },
    },
  },
  ScanReport: {
    type: "object",
    description: "Agent-readiness scan (summary level; probes carry per-method signals and cost estimates).",
    properties: {
      id: STR,
      store_id: STR,
      url: STR,
      status: { enum: ["queued", "running", "done", "failed"] },
      best_method: { enum: ["api", "dom", "computer_use", "none"] },
      score: INT,
      grade: { enum: ["A", "B", "C", "D", "F"] },
      probes: { type: "array", items: OBJ },
      recommendations: { type: "array", items: STR },
    },
  },
  Error: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message"],
        properties: { code: STR, message: STR, details: {}, request_id: STR },
      },
    },
  },
  ...(checkoutLive
    ? {
        CheckoutSession: {
          type: "object",
          description: "UCP-style checkout session; status is one of incomplete, requires_escalation, ready_for_complete, completed, canceled.",
          properties: { id: STR, status: STR, line_items: { type: "array", items: OBJ }, totals: { type: "array", items: OBJ }, continue_url: STR, payment: OBJ, messages: { type: "array", items: ref("Message") } },
          additionalProperties: true,
        },
      }
    : {}),
});

function checkoutPaths() {
  const session = ok("Checkout session", ref("CheckoutSession"));
  const id = pathParam("id", "Checkout id");
  return {
    "/api/v1/checkouts": {
      post: {
        operationId: "createCheckout",
        summary: "Create a checkout for variants from one store",
        parameters: [{ name: "Idempotency-Key", in: "header", required: false, schema: STR }],
        requestBody: { required: true, ...jsonBody({ ...OBJ, description: "line_items [{variant_id, quantity}], buyer, fulfillment" }) },
        responses: { "201": session, "400": err("Invalid input"), "404": err("Unknown variant") },
      },
    },
    "/api/v1/checkouts/{id}": {
      get: { operationId: "getCheckout", parameters: [id], responses: { "200": session, "404": err("Not found") } },
      put: {
        operationId: "updateCheckout",
        parameters: [id],
        requestBody: { required: true, ...jsonBody({ ...OBJ, description: "buyer, fulfillment address, shipping option" }) },
        responses: { "200": session, "404": err("Not found"), "409": err("Invalid state") },
      },
    },
    "/api/v1/checkouts/{id}/complete": {
      post: {
        operationId: "completeCheckout",
        summary: "Pay and place the order. Only after the buyer approves the exact total.",
        parameters: [id, { name: "Idempotency-Key", in: "header", required: false, schema: STR }],
        requestBody: { required: true, ...jsonBody({ ...OBJ, description: "payment.instruments[0]: {handler_id, credential}" }) },
        responses: { "200": session, "409": err("Invalid state"), "410": err("Expired") },
      },
    },
    "/api/v1/checkouts/{id}/cancel": {
      post: { operationId: "cancelCheckout", parameters: [id], responses: { "200": session, "409": err("Invalid state") } },
    },
    "/api/v1/orders/{id}": {
      get: { operationId: "getOrder", parameters: [pathParam("id", "Order id")], responses: { "200": ok("Order", OBJ), "404": err("Not found") } },
    },
  };
}

export function buildOpenApi(base: string, opts: { checkoutLive: boolean }) {
  return {
    openapi: "3.1.0",
    info: {
      title: "ShoperZero API",
      version: "0.1.0",
      description: "Read API for the ShoperZero cross-store product index. Prices are integer minor units.",
    },
    servers: [{ url: base }],
    paths: {
      "/api/v1/search": {
        get: {
          operationId: "searchProducts",
          summary: "Search products across indexed stores (keywords only; put price limits in min/max)",
          parameters: [
            q("q", STR, "Keywords, e.g. 'black hoodie'"),
            q("store", STR, "Store slug, domain or id"),
            q("min", INT, "Minimum price, integer minor units (2500 = $25.00)"),
            q("max", INT, "Maximum price, integer minor units"),
            q("available", { enum: ["true", "false", "any"] }, "Default true (in stock only)"),
            q("brand", { type: "array", items: STR }, "Repeatable or comma-separated", { explode: true }),
            q("category", { type: "array", items: STR }, "Repeatable or comma-separated", { explode: true }),
            q("currency", STR, "ISO 4217; narrows the price filter"),
            q("limit", { type: "integer", minimum: 1, maximum: 50 }, "Default 10"),
            q("cursor", STR, "pagination.cursor from the previous response"),
          ],
          responses: {
            "200": ok("Search results", ref("SearchResponse")),
            "400": err("Bad query or cursor"),
            "404": err("Unknown store"),
            "429": err("Rate limited"),
          },
        },
      },
      "/api/v1/products/{id}": {
        get: {
          operationId: "getProduct",
          summary: "Product detail with every variant",
          parameters: [
            pathParam("id", "Product id, variant id, or '{store_slug}:{product_seq}'"),
            q("verify", { enum: ["1", "true"] }, "Re-check live price and stock on the merchant site (slower)"),
            q("format", { enum: ["ucp", "indexed"] }, "Default ucp"),
            q("selected", { type: "array", items: STR }, "Repeatable 'Name:Label', e.g. Size:M", { explode: true }),
          ],
          responses: { "200": ok("Product", ref("ProductResponse")), "404": err("Not found") },
        },
      },
      "/api/v1/stores": {
        get: {
          operationId: "listStores",
          parameters: [
            q("query", STR, "Matches store name or domain"),
            q("platform", STR, "e.g. woocommerce"),
            q("has_checkout", BOOL, "Only stores with headless checkout"),
            q("limit", { type: "integer", minimum: 1, maximum: 50 }, "Default 20"),
          ],
          responses: {
            "200": ok("Stores", { type: "object", properties: { stores: { type: "array", items: ref("StoreSummary") } } }),
          },
        },
        post: {
          operationId: "indexStore",
          summary: "Index (crawl) a store",
          requestBody: {
            required: true,
            ...jsonBody({
              type: "object",
              properties: { url: STR, store_id: STR, force: BOOL },
              description: "Either url or store_id",
            }),
          },
          responses: {
            "200": ok("Cached index", OBJ),
            "202": ok("Crawl started: { store, crawl_run_id, status, reused, cached }", OBJ),
            "400": err("Invalid input"),
            "422": err("Store reachable by computer use only"),
          },
        },
      },
      "/api/v1/stores/{slug}": {
        get: {
          operationId: "getStore",
          parameters: [pathParam("slug", "Store slug, domain or id")],
          responses: { "200": ok("Store", ref("StoreDetail")), "403": err("Store opted out"), "404": err("Not found") },
        },
      },
      "/api/v1/crawl-runs/{id}": {
        get: {
          operationId: "getCrawlRun",
          parameters: [pathParam("id", "Crawl run id")],
          responses: { "200": ok("Crawl run", ref("CrawlRun")), "404": err("Not found") },
        },
      },
      "/api/v1/scans": {
        post: {
          operationId: "scanStore",
          summary: "Scan how AI agents can reach a store (api → dom → computer_use) and grade it",
          requestBody: {
            required: true,
            ...jsonBody({ type: "object", required: ["url"], properties: { url: STR, mode: { enum: ["cascade", "full"] } } }),
          },
          responses: {
            "202": ok("Scan started", {
              type: "object",
              properties: { scan_id: STR, store_id: STR, status_url: STR, report_url: STR },
            }),
            "400": err("Invalid input"),
            "429": err("Too many scans"),
          },
        },
      },
      "/api/v1/scans/{id}": {
        get: {
          operationId: "getScan",
          parameters: [pathParam("id", "Scan id")],
          responses: { "200": ok("Scan report", ref("ScanReport")), "404": err("Not found") },
        },
      },
      "/s/{slug}/products.json": {
        get: {
          operationId: "listStoreProductsShopify",
          summary: "Shopify-compatible product list for one store",
          parameters: [
            pathParam("slug", "Store slug"),
            q("limit", { type: "integer", minimum: 1, maximum: 250 }, "Default 30"),
            q("page", { type: "integer", minimum: 1 }, "1-based"),
          ],
          responses: {
            "200": ok("Products in Shopify's products.json shape", {
              type: "object",
              properties: { products: { type: "array", items: OBJ } },
            }),
            "404": { description: 'Unknown store: {"errors":"Not Found"}' },
          },
        },
      },
      ...(opts.checkoutLive ? checkoutPaths() : {}),
    },
    components: { schemas: schemas(opts.checkoutLive) },
  };
}
