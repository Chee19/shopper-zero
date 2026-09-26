import "server-only";
import { MCP_PATH } from "@/lib/formats/ucp";
import { appUrl, flags } from "@/lib/env";

export { UI_MOCK } from "@/components/lib/flags";
export { appUrl } from "@/lib/env";

export const crawlerUserAgent = () => flags.crawlerUserAgent();

/** The composed agent MCP server (catalog + crawl + checkout) that WS3 advertises in UCP, llms.txt and the agent card. */
export const agentMcpUrl = () => `${appUrl()}${MCP_PATH}`;
