// src/lib/crawl/mcp-tools.ts: WS2 registers index_store, get_crawl_status, scan_store, get_scan here.
import "server-only";
import {
  GetCrawlStatusInputSchema, GetScanInputSchema, IndexStoreInputSchema, ScanStoreInputSchema, type ScanReport,
} from "@/lib/contracts";
import { startStoreCrawl } from "@/lib/crawl";
import { getCrawlRun, getStoreById } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { toolError, toolResult } from "@/lib/mcp/result";
import type { ToolRegistrar } from "@/lib/mcp/types";
import { getScanReport, startScan } from "@/lib/scan";

// Descriptions are verbatim from spec 02 §8 / 03 §4.5-4.6.
const INDEX_STORE_DESC = `Ask ShoperZero to index a store that list_stores does not return, by its homepage URL. Any platform works; Shopify stores are passed through.
This starts an asynchronous crawl and returns immediately with the store record and a crawl_run_id. Poll get_crawl_status every 5-10 seconds until status is "succeeded" or "failed" (typically 30-120 seconds, up to about 150 products), then search it with search_catalog using store.slug.
Crawls respect the merchant's robots.txt. Stores behind bot protection finish with store status "blocked"; tell the buyer to use the merchant's site directly.`;

const GET_CRAWL_STATUS_DESC = `Check the progress of a crawl started by index_store. Returns status (queued, running, succeeded, failed), products found so far, pages fetched, any error, and the store's current status. When done is true and the store status is "indexed", search it with search_catalog using store.slug.`;

const SCAN_STORE_DESC = `Check how well an AI agent can use a store, by its homepage URL. ShoperZero tries three access methods in order and stops at the first that works: api (UCP/MCP/products.json or a platform API), dom (reading page structure and following add-to-cart), computer_use (a vision model clicking a real browser; never goes past the cart and never pays).
Returns immediately with scan_id; poll get_scan every 5-10 seconds. The result has an Agent Readiness Score (0-100, grade A-F), per-method capabilities, estimated seconds and USD per agent task, and recommendations.`;

const GET_SCAN_DESC = `Get the result of scan_store: status (queued, running, done, failed), per-method probes with capabilities, the best method, score and grade, the projected grade after ShoperZero indexes the store, and recommendations. Call index_store to make the store agent-ready.`;

export const registerCrawlTools: ToolRegistrar = (server) => {
  server.registerTool("index_store", {
    title: "Index a new store", description: INDEX_STORE_DESC, inputSchema: IndexStoreInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (args) => {
    try {
      const r = await startStoreCrawl(args.url);
      const out = { store: r.store, crawl_run_id: r.crawl_run.id, status: r.crawl_run.status, reused: r.reused, cached: r.cached };
      const summary = out.cached && out.store.status === "indexed"
        ? `Already indexed recently. Search it now: search_catalog with catalog.store = "${out.store.slug}".`
        : "Call get_crawl_status with crawl_run_id every 5-10 s.";
      return toolResult(out, summary);
    } catch (err) { return toolError(err, "index_store"); }
  });

  server.registerTool("get_crawl_status", {
    title: "Crawl progress", description: GET_CRAWL_STATUS_DESC, inputSchema: GetCrawlStatusInputSchema,
    annotations: { readOnlyHint: true },
  }, async (args) => {
    try {
      const run = await getCrawlRun(args.crawl_run_id);
      if (!run) throw new AppError("not_found", "Crawl run not found");
      const store = await getStoreById(run.store_id);
      const slug = store?.slug ?? run.store_id;
      const summary = run.status === "succeeded"
        ? `Search it: search_catalog with catalog.store = "${slug}".`
        : run.status === "failed"
          ? `Crawl failed: ${run.error ?? "unknown error"}. The store may block automated access.`
          : "Still crawling. Check again in 5-10 seconds.";
      return toolResult(run, summary);
    } catch (err) { return toolError(err, "get_crawl_status"); }
  });

  server.registerTool("scan_store", {
    title: "Scan a store's agent readiness", description: SCAN_STORE_DESC, inputSchema: ScanStoreInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (args) => {
    try {
      const r = await startScan(args.url, { mode: args.mode });
      const out = { scan_id: r.scan_id, store_id: r.store_id, status_url: r.status_url, report_url: r.report_url };
      return toolResult(out, `Scan started. Call get_scan with scan_id every 5-10 s (typically 10-120 s). Human report: ${out.report_url}`);
    } catch (err) { return toolError(err, "scan_store"); }
  });

  server.registerTool("get_scan", {
    title: "Scan result", description: GET_SCAN_DESC, inputSchema: GetScanInputSchema,
    annotations: { readOnlyHint: true },
  }, async (args) => {
    try {
      // Explicit annotation: keeps downstream typing sound while getScanReport's export is still landing.
      const report: ScanReport | null = await getScanReport(args.scan_id);
      if (!report) throw new AppError("not_found", "Scan not found");
      const summary = report.status === "done"
        ? `Grade ${report.grade} (${report.score}/100), best method ${report.best_method}. ${report.recommendations[0] ?? ""}`
        : (() => {
          const probe = report.probes.find((p) => p.status === "running") ?? report.probes[report.probes.length - 1];
          return `Scanning (${probe.method} ${probe.status})…`;
        })();
      return toolResult(report, summary);
    } catch (err) { return toolError(err, "get_scan"); }
  });
};
