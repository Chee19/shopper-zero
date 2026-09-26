// src/lib/agent/cursor.ts  (WS3; pure): opaque search cursor = base64url of {"o":<offset>} (00 §4.4).
import { AppError } from "@/lib/errors";

export const MAX_OFFSET = 1000;

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
}

/** Absent → 0. Anything we did not produce → bad_request. */
export function decodeCursor(cursor: string | undefined | null): number {
  if (!cursor) return 0;
  try {
    const o = (JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { o?: unknown }).o;
    if (typeof o === "number" && Number.isInteger(o) && o >= 0 && o <= MAX_OFFSET) return o;
  } catch {
    // fall through
  }
  throw new AppError("bad_request", "Invalid cursor; repeat the search without it.");
}
