import "server-only";
import type { Platform } from "@/lib/contracts";
import { AppError } from "@/lib/errors";

// The pipeline falls back to sitemap + JSON-LD on any AdapterError.
export class AdapterError extends AppError {
  constructor(
    readonly reason: "unavailable" | "no_currency",
    readonly platform: Platform,
    readonly httpStatus = 0,
  ) {
    super("upstream_error", `${platform} adapter ${reason} (${httpStatus})`);
    this.name = "AdapterError";
  }
}
