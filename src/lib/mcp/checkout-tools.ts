import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CheckoutService } from "../checkout/contracts";
import { registerCheckoutTools as register } from "../checkout/mcp-tools";
import { checkoutService } from "../checkout";
export function registerCheckoutTools(server: McpServer, service: CheckoutService = checkoutService) {
  return register(server, service);
}
