import { z } from "zod";
import { AppError } from "@/lib/errors";
import { json, preflight, route } from "@/lib/http";
import { getScanReport } from "@/lib/scan";

export const OPTIONS = preflight;

export const GET = route("scans.get", async (_req, ctx: RouteContext<"/api/v1/scans/[id]">, { requestId }) => {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new AppError("validation_error", "scan id must be a uuid");
  const scan = await getScanReport(id);
  if (!scan) throw new AppError("not_found", "Scan not found");
  return json(scan, { requestId });
});
