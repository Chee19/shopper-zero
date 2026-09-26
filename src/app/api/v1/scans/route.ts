import { z } from "zod";
import { CreateScanInputSchema } from "@/contracts";
import { isAppError } from "@/shared/errors";
import { errorResponse, json, parseJsonBody, preflight, route } from "@/shared/http";
import { startScan } from "@/features/scan";

// runScan runs inside after(), which lives within this route's maxDuration.
export const maxDuration = 300;
export const OPTIONS = preflight;

const ScanBody = z.strictObject(CreateScanInputSchema.shape);

export const POST = route("scans.create", async (req, _ctx, { requestId }) => {
  const { url, mode } = await parseJsonBody(req, ScanBody);
  try {
    const { reused, ...body } = await startScan(url, { mode });
    return json(body, { status: reused ? 200 : 202, requestId, headers: { Location: body.status_url } });
  } catch (err) {
    // route() has no hook for extra error headers.
    if (!isAppError(err) || err.code !== "rate_limited") throw err;
    const res = errorResponse(err, requestId);
    res.headers.set("Retry-After", "30");
    return res;
  }
});
