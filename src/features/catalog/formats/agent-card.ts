// src/lib/formats/agent-card.ts  (WS3; pure)
// A2A-style discovery card (spec 03 §6.7). We do not run an A2A server; the card points at the MCP endpoint.
import { MCP_PATH } from "@/features/catalog/formats/ucp";

export function buildAgentCard(base: string) {
  return {
    name: "ShoperZero",
    description:
      "Product search and checkout across stores that are not on Shopify (WooCommerce, Magento, BigCommerce, Squarespace, custom). Speaks MCP with Shopify's UCP tool names at the interface URL below; it is not an A2A task server. See the UCP profile at /.well-known/ucp and /llms.txt.",
    version: "0.1.0",
    provider: { organization: "ShoperZero", url: base },
    documentationUrl: `${base}/llms.txt`,
    supportedInterfaces: [{ url: `${base}${MCP_PATH}`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
    url: `${base}${MCP_PATH}`,
    preferredTransport: "JSONRPC",
    protocolVersion: "0.3.0",
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["application/json", "text/plain"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "search_products",
        name: "Search products",
        description: "Search the cross-store catalog (MCP tool search_catalog).",
        tags: ["shopping", "catalog", "ucp"],
        examples: ["find a black hoodie under $50"],
      },
      {
        id: "product_detail",
        name: "Product detail",
        description: "Variants, live price and stock (MCP tool get_product).",
        tags: ["shopping", "catalog"],
      },
      {
        id: "checkout",
        name: "Checkout",
        description:
          "Create and complete a checkout paid by Stripe test payments, or hand off to the merchant (MCP tools create_checkout, complete_checkout).",
        tags: ["shopping", "checkout", "payments"],
      },
    ],
  };
}
