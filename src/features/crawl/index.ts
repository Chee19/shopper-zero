import "server-only";
import type { CrawlStoreFn } from "@/contracts";
import { crawlStore as crawlStoreWithOpts } from "./run";

export { computeReadiness } from "@/features/readiness";
export { adapters } from "./adapters";
export { OfferVerificationError } from "./errors";
export { startStoreCrawl } from "./start";
export { verifyOffer, verifyOfferDetailed } from "./verify";
export { getCrawlRunView, type CrawlRunView } from "./view";

// Exported with the contract type, while startStoreCrawl imports ./run directly to pass preferred.
export const crawlStore: CrawlStoreFn = crawlStoreWithOpts;
