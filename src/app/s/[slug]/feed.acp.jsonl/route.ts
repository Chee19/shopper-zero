import { ACP_VERSION, type IndexedProduct } from "@/lib/contracts";
import { storeCache, ucpLinkHeader } from "@/lib/agent/http";
import { logHit } from "@/lib/agent/log";
import { agentStoreBySlug, textNotFound } from "@/lib/agent/stores";
import { listStoreProducts } from "@/lib/db";
import { toAcpRows, toJsonl } from "@/lib/formats/acp";
import { preflight, route, text } from "@/lib/http";
import { log } from "@/lib/log";

const PAGE = 250;
const MAX_ROWS = 10_000;

// ACP / OpenAI product feed: one JSON line per variant (spec 03 §6.3). Built in memory (MVP catalogs are small).
export const GET = route("s.feed", async (req, ctx: RouteContext<"/s/[slug]/feed.acp.jsonl">, { requestId }) => {
  const { slug } = await ctx.params;
  const store = await agentStoreBySlug(slug);
  if (!store) return textNotFound();

  const products: IndexedProduct[] = [];
  let variants = 0;
  for (let page = 1; variants < MAX_ROWS; page++) {
    const { products: batch, total } = await listStoreProducts(store.id, { limit: PAGE, page });
    products.push(...batch);
    variants += batch.reduce((n, p) => n + p.variants.length, 0);
    if (batch.length < PAGE || page * PAGE >= total) break;
  }
  const { rows, skipped } = toAcpRows(products, store);
  if (skipped > 0) log.warn("feed.rows.skipped", { store_id: store.id, skipped, request_id: requestId });

  const download = new URL(req.url).searchParams.get("download") === "1";
  const headers: Record<string, string> = {
    "X-ACP-Feed-Version": ACP_VERSION,
    "Cache-Control": storeCache(store),
    Link: ucpLinkHeader(store.urls.ucp),
    "Request-Id": requestId,
  };
  if (download) headers["Content-Disposition"] = `attachment; filename="${store.slug}.acp.jsonl"`;
  logHit("feed", { tool: download ? "download" : "view", storeId: store.id, req });
  return text(
    toJsonl(rows.slice(0, MAX_ROWS)),
    download ? "application/x-ndjson" : "text/plain; charset=utf-8",
    { headers },
  );
});

export const OPTIONS = preflight;
