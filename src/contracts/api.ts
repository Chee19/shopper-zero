// REST error envelope + codes. Every non-2xx JSON response from /api/** uses ApiErrorBody.
export const API_ERROR_STATUS = {
  bad_request: 400,          // malformed JSON, bad query string
  validation_error: 400,     // zod failure; details = z.flattenError(err)
  unauthorized: 401,
  forbidden: 403,            // opted-out store, demo wallet disabled
  not_found: 404,
  conflict: 409,             // unique violation (e.g. duplicate store slug race)
  invalid_state: 409,        // checkout transition not allowed from current state
  idempotency_conflict: 409, // same Idempotency-Key, different body
  gone: 410,                 // checkout expired
  unprocessable: 422,        // semantically invalid (e.g. variants from two stores in one checkout)
  rate_limited: 429,
  internal: 500,
  not_implemented: 501,      // stubbed service not landed yet
  upstream_error: 502,       // merchant store / Stripe returned an error
  upstream_blocked: 502,     // merchant bot-protection (403/challenge); store marked blocked
  upstream_timeout: 504,
  mock_disabled: 503,
  busy: 503,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;          // human readable, safe to show to agents (no secrets, no PII)
    details?: unknown;        // e.g. zod flattened errors, {state, allowed}
    request_id?: string;      // echoes the Request-Id response header
  };
}
