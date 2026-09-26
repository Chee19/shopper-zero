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

/** <meta name="shoperzero-verify" content="<token>"> on https://<host>/. Only the stored host is fetched (SSRF guard). */
export async function checkMeta(host: string, token: string): Promise<CheckResult> {
  const res = await fetch(`https://${host}/`, {
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": flags.crawlerUserAgent(), Accept: "text/html" },
  }).catch(() => null);
  if (!res?.ok) {
    return { method: "meta_tag", ok: false, observed: [], hint: `Couldn't fetch https://${host}/ (${res?.status ?? "network error"}).` };
  }
  const $ = cheerio.load((await res.text()).slice(0, 512_000));
  const observed = $(`meta[name="${META_NAME}"]`).map((_, el) => $(el).attr("content") ?? "").get();
  return observed.includes(token)
    ? { method: "meta_tag", ok: true, observed }
    : { method: "meta_tag", ok: false, observed, hint: `Add <meta name="${META_NAME}" content="${token}"> inside <head> of https://${host}/.` };
}
