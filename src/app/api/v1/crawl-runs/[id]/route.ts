import { z } from "zod";
import { route, json, preflight } from "@/shared/http";
import { getCrawlRunView } from "@/features/crawl";
import { AppError } from "@/shared/errors";

export const OPTIONS = preflight;

export const GET = route("crawl_runs.get", async (_req, ctx: RouteContext<"/api/v1/crawl-runs/[id]">, { requestId }) => {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new AppError("validation_error", "crawl run id must be a uuid");
  const run = await getCrawlRunView(id);
  if (!run) throw new AppError("not_found", "Crawl run not found");
  return json(run, { requestId }); // body = CrawlRun (00) plus done/store, incl. log; stale runs read as failed
});
