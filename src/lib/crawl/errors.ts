import "server-only";
import type { ApiErrorCode, Offer, Platform } from "@/lib/contracts";
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

export type OfferVerificationReason =
  | "variant_not_found" | "opted_out" | "blocked" | "unreachable" | "product_gone" | "variant_gone" | "no_price";

// verify.ts throws this; lastKnown is the DB row's offer so callers can fall back on a failed re-check.
export class OfferVerificationError extends AppError {
  constructor(
    readonly reason: OfferVerificationReason,
    readonly lastKnown: Offer | null,
    code: ApiErrorCode,
    message: string,
  ) {
    super(code, message);
    this.name = "OfferVerificationError";
  }
}
