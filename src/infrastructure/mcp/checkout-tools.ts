import type { McpServer } from "@modelcontextprotocol/server";
import type { CheckoutService } from "@/features/checkout/contracts";
import { registerCheckoutTools as register } from "@/features/checkout/mcp-tools";
import { checkoutService } from "@/features/checkout";
export function registerCheckoutTools(server: McpServer, service: CheckoutService = checkoutService) {
  return register(server, service);
}
