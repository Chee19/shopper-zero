// src/shared/errors.ts  (isomorphic)
// Isomorphic. Throw AppError anywhere; route/tool wrappers turn it into the envelope.
import { z } from "zod";
import { API_ERROR_STATUS, type ApiErrorCode } from "@/contracts";

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: unknown;
  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
  get status(): number {
    return API_ERROR_STATUS[this.code];
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

type PgLikeError = { code: string; message: string; details?: string | null };
function isPgLikeError(e: unknown): e is PgLikeError {
  return typeof e === "object" && e !== null && typeof (e as PgLikeError).code === "string"
    && typeof (e as PgLikeError).message === "string";
}

/** Maps anything thrown to an AppError. Unknown errors become "internal" (message hidden). */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof z.ZodError) return new AppError("validation_error", "Invalid input", z.flattenError(e));
  if (isPgLikeError(e)) {
    if (e.code === "23505") return new AppError("conflict", "Already exists", { detail: e.details ?? null });
    if (e.code === "PGRST116") return new AppError("not_found", "Not found");
    if (e.code === "22P02") return new AppError("validation_error", "Malformed identifier");
    if (e.code === "23514") return new AppError("validation_error", "Value not allowed", { detail: e.message });
  }
  return new AppError("internal", "Internal error");
}
