import "server-only";
import type { Platform, PlatformAdapter } from "@/lib/contracts";
import { woocommerce } from "./woocommerce";

// magento, squarespace, sfcc and shopify land with M5.
export const adapters: Partial<Record<Platform, PlatformAdapter>> = { woocommerce };
