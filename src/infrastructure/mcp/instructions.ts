// src/lib/mcp/instructions.ts  (WS3): returned to clients on initialize.
export const MCP_INSTRUCTIONS = `ShoperZero indexes online stores that are not on Shopify (WooCommerce, Magento, BigCommerce, Squarespace, Salesforce Commerce Cloud, custom) and exposes them with the same tool names as Shopify's UCP catalog MCP.
Flow: list_stores or search_catalog -> get_product (verify: true before quoting a final price) -> create_checkout -> update_checkout (address, shipping) -> complete_checkout.
Store not listed? scan_store checks how agents can reach it; index_store adds its catalog (poll get_scan / get_crawl_status).
Prices are integers in ISO 4217 minor units with a currency code: {"amount": 2500, "currency": "USD"} is $25.00. Put price limits in filters.price, not in the query.
If a checkout returns status "requires_escalation", give the buyer continue_url; it opens the merchant's own cart or product page.
Never call complete_checkout until the buyer has explicitly approved the exact total in this conversation.`;
