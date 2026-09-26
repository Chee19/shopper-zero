// src/lib/scan/index.ts  → WS2 (replace bodies, keep names + types)
// STUB created by WS1 at T+30. Owned by WS2 from then on: replace bodies, keep signatures.
import "server-only";
import type { RunScanFn, StartScanFn } from "@/lib/contracts";
import { AppError } from "@/lib/errors";

const notYet = (what: string) => new AppError("not_implemented", `${what} is not implemented yet`);

export const startScan: StartScanFn = async () => { throw notYet("startScan"); };
export const runScan: RunScanFn = async () => { throw notYet("runScan"); };
