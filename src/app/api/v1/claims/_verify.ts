import "server-only";
import { Resolver } from "node:dns/promises";
import * as cheerio from "cheerio";
import { META_NAME, TXT_PREFIX, dnsHosts, primaryTxtHost, type CheckResult } from "@/components/claim/types";
import { flags } from "@/lib/env";

/** DNS TXT at _shoperzero.<host> (apex and the bare domain also accepted) must equal "shoperzero-verify=<token>". */
export async function checkDns(host: string, token: string): Promise<CheckResult> {
  const r = new Resolver({ timeout: 3000, tries: 2 });
  r.setServers(["1.1.1.1", "8.8.8.8"]); // public resolvers see new records sooner
  const observed: string[] = [];
  for (const h of dnsHosts(host)) {
    try {
      for (const chunks of await r.resolveTxt(h)) {
        const v = chunks.join(""); // one record can arrive split into chunks
        if (v.startsWith(TXT_PREFIX)) observed.push(`${h}: ${v}`);
        if (v === TXT_PREFIX + token) return { method: "dns_txt", ok: true, observed };
      }
    } catch {
      // ENOTFOUND / ENODATA / timeout: try the next host
    }
  }
  return {
    method: "dns_txt", ok: false, observed,
    hint: `Add a TXT record at ${primaryTxtHost(host)} with value ${TXT_PREFIX}${token}. DNS can take a few minutes.`,
  };
}

const sameSite = (a: string, b: string) => a.replace(/^www\./, "") === b.replace(/^www\./, "");

/**
 * Fetches https://<host>/ following at most 3 redirects by hand, and only to https on the same site (www/apex), so a
 * store can't bounce the verifier to another host or an internal address (SSRF guard, spec 05 §7.5).
 */
async function fetchHome(host: string): Promise<{ res: Response | null; reason?: string }> {
  let url = new URL(`https://${host}/`);
  for (let hop = 0; hop <= 3; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": flags.crawlerUserAgent(), Accept: "text/html" },
    }).catch(() => null);
    if (!res) return { res: null, reason: "network error" };
    if (res.status < 300 || res.status >= 400) return { res };
    const location = res.headers.get("location");
    if (!location) return { res };
    const next = new URL(location, url);
    if (next.protocol !== "https:" || !sameSite(next.hostname, host)) {
      return { res: null, reason: `redirects off-site to ${next.protocol}//${next.hostname}` };
    }
    url = next;
  }
  return { res: null, reason: "too many redirects" };
}

/** <meta name="shoperzero-verify" content="<token>"> on https://<host>/. Only the stored host (or its www/apex) is fetched. */
export async function checkMeta(host: string, token: string): Promise<CheckResult> {
  const { res, reason } = await fetchHome(host);
  if (!res?.ok) {
    return { method: "meta_tag", ok: false, observed: [], hint: `Couldn't fetch https://${host}/ (${reason ?? res?.status ?? "network error"}).` };
  }
  const $ = cheerio.load((await res.text()).slice(0, 512_000));
  const observed = $(`meta[name="${META_NAME}"]`).map((_, el) => $(el).attr("content") ?? "").get();
  return observed.includes(token)
    ? { method: "meta_tag", ok: true, observed }
    : { method: "meta_tag", ok: false, observed, hint: `Add <meta name="${META_NAME}" content="${token}"> inside <head> of https://${host}/.` };
}
