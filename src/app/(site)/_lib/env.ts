import "server-only";
import { flags } from "@/lib/env";

export { UI_MOCK } from "@/components/lib/flags";
export { appUrl } from "@/lib/env";

export const crawlerUserAgent = () => flags.crawlerUserAgent();
