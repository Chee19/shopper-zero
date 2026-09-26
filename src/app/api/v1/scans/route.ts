import { z } from "zod";
import { CreateScanInputSchema } from "@/contracts";
import { AppError, isAppError } from "@/shared/errors";
import { errorResponse, json, parseJsonBody, preflight, route } from "@/shared/http";
import { rateLimit } from "@/features/catalog/ratelimit";
import { startScan } from "@/features/scan";

// runScan runs inside after(), which lives within this route's maxDuration.
export const maxDuration = 300;
export const OPTIONS = preflight;

const ScanBody = z.strictObject(CreateScanInputSchema.shape);

export const POST = route("scans.create", async (req, _ctx, { requestId }) => {
  const { url, mode } = await parseJsonBody(req, ScanBody);
  try {
    // Per-IP, shared with MCP scan_store/index_store (5 launches per 10 min).
    if (!rateLimit(req, "expensive")) throw new AppError("rate_limited", "Too many scans from this address; retry in a few minutes.", { retry_after: 120 });
    const { reused, ...body } = await startScan(url, { mode });
    return json(body, { status: reused ? 200 : 202, requestId, headers: { Location: body.status_url } });
  } catch (err) {
    // route() has no hook for extra error headers.
    if (!isAppError(err) || err.code !== "rate_limited") throw err;
    const res = errorResponse(err, requestId);
    res.headers.set("Retry-After", String((err.details as { retry_after?: number } | undefined)?.retry_after ?? 30));
    return res;
  }
});
