import "server-only";
import type { Platform, PlatformAdapter } from "@/contracts";
import { magento } from "./magento";
import { sfcc } from "./sfcc";
import { shopify } from "./shopify";
import { squarespace } from "./squarespace";
import { woocommerce } from "./woocommerce";

export const adapters: Partial<Record<Platform, PlatformAdapter>> = { woocommerce, magento, squarespace, sfcc, shopify };
