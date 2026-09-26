// src/features/crawl/index.ts  → WS2 (replace bodies, keep names + types)
// STUB created by WS1 at T+30. Owned by WS2 from then on: replace bodies, keep signatures.
import "server-only";
import type { ComputeReadinessFn, CrawlStoreFn, StartStoreCrawlFn, VerifyOfferFn } from "@/contracts";
import { AppError } from "@/shared/errors";

const notYet = (what: string) => new AppError("not_implemented", `${what} is not implemented yet`);

export const startStoreCrawl: StartStoreCrawlFn = async () => { throw notYet("startStoreCrawl"); };
export const crawlStore: CrawlStoreFn = async () => { throw notYet("crawlStore"); };
export const verifyOffer: VerifyOfferFn = async () => { throw notYet("verifyOffer"); };
export const computeReadiness: ComputeReadinessFn = async () => { throw notYet("computeReadiness"); };
