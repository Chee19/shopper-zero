import "server-only";
import robotsParser from "robots-parser";
import { log } from "@/shared/log";
import { ROBOTS_TOKEN, type Fetcher } from "./fetch";

export interface RobotsInfo {
  url: string; status: number;
  isAllowed(url: string, ua?: string): boolean;
  crawlDelaySec: number | null;
  sitemaps: string[];
  contentSignal: Record<string, "yes" | "no"> | null;
  blocksUs: null | "robots" | "content_signal" | "challenge";
}

// RFC 9309: 4xx = allow all, 5xx/unreachable = disallow all. Also sets fetcher.robots.
export async function loadRobots(fetcher: Fetcher, origin: string): Promise<RobotsInfo> {
  const url = `${origin}/robots.txt`;
  const res = await fetcher.get(url, { kind: "text", skipRobots: true });
  const base = { url, status: res.status, crawlDelaySec: null, sitemaps: [], contentSignal: null };
  let info: RobotsInfo;
  if (res.ok) {
    info = parseRobots(url, res.status, res.body, origin);
  } else if (res.blocked === "challenge") {
    info = { ...base, isAllowed: () => false, blocksUs: "challenge" };
  } else if ((res.status >= 400 && res.status < 500) || res.blocked === "forbidden") {
    info = { ...base, isAllowed: () => true, blocksUs: null };
  } else {
    log.warn("crawl.robots.unreachable", { url, status: res.status, blocked: res.blocked, msg: "robots.txt unreachable (RFC 9309: treat as disallow)" });
    info = { ...base, isAllowed: () => false, blocksUs: "robots" };
  }
  fetcher.robots = info;
  return info;
}

export function parseRobots(url: string, status: number, body: string, origin: string): RobotsInfo {
  const parser = robotsParser(url, body);
  // robots-parser returns undefined for other hosts (CDN sitemaps); those aren't governed by this file.
  const isAllowed = (u: string, ua: string = ROBOTS_TOKEN) => parser.isAllowed(u, ua) !== false;
  const contentSignal = parseContentSignal(body);
  const sitemaps = parser.getSitemaps().flatMap((s) => (URL.canParse(s, url) ? [new URL(s, url).href] : []));
  const blocksUs = contentSignal?.["ai-input"] === "no" ? "content_signal" : !isAllowed(`${origin}/`) ? "robots" : null;
  return { url, status, isAllowed, crawlDelaySec: parser.getCrawlDelay(ROBOTS_TOKEN) ?? null, sitemaps, contentSignal, blocksUs };
}

// contentsignals.org lines, which robots-parser ignores: the ShoperZeroBot group wins, else "*".
function parseContentSignal(body: string): Record<string, "yes" | "no"> | null {
  const groups: { agents: string[]; signals: Record<string, "yes" | "no"> }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const m = /^\s*([\w-]+)\s*:\s*(.*?)\s*$/.exec(raw.replace(/#.*/, ""));
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], signals: {} }));
      current.agents.push(m[2].toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key !== "content-signal" || !current) continue;
    for (const pair of m[2].split(",")) {
      const [k, v] = pair.split("=").map((s) => s.trim().toLowerCase());
      if (k && (v === "yes" || v === "no")) current.signals[k] = v;
    }
  }
  const token = ROBOTS_TOKEN.toLowerCase();
  const group = groups.find((g) => g.agents.includes(token)) ?? groups.find((g) => g.agents.includes("*"));
  return group && Object.keys(group.signals).length ? group.signals : null;
}
