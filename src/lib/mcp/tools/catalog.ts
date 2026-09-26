// src/lib/mcp/tools/catalog.ts  (WS3): list_stores, search_catalog, lookup_catalog, get_product.
// structuredContent === the REST twin's JSON body (B7). No outputSchema (00 §4.5). No logging here:
// instrumentServer logs every tool call once.
import "server-only";
import {
  GetProductInputSchema,
  ListStoresInputSchema,
  LookupCatalogInputSchema,
  SearchCatalogInputSchema,
} from "@/lib/contracts";
import { lookupCatalog, productDetail, productSummary } from "@/lib/agent/product";
import { catalogSearch, searchSummary } from "@/lib/agent/search";
import { listStores } from "@/lib/db";
import { toolError, toolResult } from "@/lib/mcp/result";
import type { ToolRegistrar } from "@/lib/mcp/types";
import { DESCRIPTIONS } from "./catalog-descriptions";

/** `?store=` on the MCP URL scopes catalog tools to one store (per-store UCP profiles advertise it). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const defaultStoreOf = (sdkCtx: any): string | null => {
  const url: string | undefined = sdkCtx?.http?.req?.url;
  if (!url) return null;
  try {
    return new URL(url).searchParams.get("store")?.trim() || null;
  } catch {
    return null;
  }
};

export const registerCatalogTools: ToolRegistrar = (server) => {
  server.registerTool(
    "list_stores",
    {
      title: "List stores",
      description: DESCRIPTIONS.list_stores,
      inputSchema: ListStoresInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const stores = await listStores({
          query: args.query,
          platform: args.platform,
          has_checkout: args.has_checkout,
          limit: args.limit ?? 20,
        });
        return toolResult({ stores }, `${stores.length} ${stores.length === 1 ? "store" : "stores"}.`);
      } catch (err) {
        return toolError(err, "list_stores");
      }
    },
  );

  server.registerTool(
    "search_catalog",
    {
      title: "Search products",
      description: DESCRIPTIONS.search_catalog,
      inputSchema: SearchCatalogInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (args, sdkCtx) => {
      try {
        const { body, store } = await catalogSearch(args.catalog, { defaultStore: defaultStoreOf(sdkCtx) });
        return toolResult(body, searchSummary(body, args.catalog, store));
      } catch (err) {
        return toolError(err, "search_catalog");
      }
    },
  );

  server.registerTool(
    "lookup_catalog",
    {
      title: "Look up products",
      description: DESCRIPTIONS.lookup_catalog,
      inputSchema: LookupCatalogInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const body = await lookupCatalog(args.catalog.ids);
        const miss = body.not_found.length ? `; ${body.not_found.length} not found` : "";
        return toolResult(body, `Found ${body.products.length} products${miss}.`);
      } catch (err) {
        return toolError(err, "lookup_catalog");
      }
    },
  );

  server.registerTool(
    "get_product",
    {
      title: "Get product",
      description: DESCRIPTIONS.get_product,
      inputSchema: GetProductInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const { body } = await productDetail(args.catalog.id, {
          verify: args.catalog.verify,
          selected: args.catalog.selected,
        });
        return toolResult(body, productSummary(body));
      } catch (err) {
        return toolError(err, "get_product");
      }
    },
  );
};
